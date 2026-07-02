// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title ZeroDex — AMM + LP farming on LitVM LiteForge
/// @notice Fork of a constant-product AMM (x*y=k) with a Synthetix-style reward distribution.
contract ZeroDex {
    address public immutable NUSD;
    address public immutable NATIVE;
    address public owner;

    /// @dev Fee in basis-points denominator (10000 = 100%). 10 = 0.1%.
    uint256 public swapFee = 10;

    // -----------------------------------------------------------------
    // Pool storage
    // -----------------------------------------------------------------
    struct Pool {
        address token0;
        address token1;
        uint256 reserve0;
        uint256 reserve1;
        uint256 totalLP;
        uint256 volume24h;
        uint256 totalVolume;
        uint256 lastVolumeReset;
    }

    mapping(bytes32 => Pool) public pools;
    mapping(bytes32 => mapping(address => uint256)) public userLP;
    mapping(bytes32 => address) public poolCreator;
    bytes32[] public allPools;
    mapping(bytes32 => bool) public poolExists;

    // -----------------------------------------------------------------
    // Reward distribution (Synthetix-style, lazy update)
    // -----------------------------------------------------------------
    uint256 public totalRewardPool;          // undistributed reward (in NUSD wei)
    uint256 public totalNUSDLocked;          // sum of NUSD locked across all base pools
    uint256 public accRewardPerNUSD;         // cumulative reward per 1 wei NUSD, scaled by 1e18
    uint256 private constant ACC_SCALE = 1e18;

    mapping(address => uint256) public userNUSDLocked; // user -> NUSD wei locked
    mapping(address => uint256) public userRewardDebt; // user -> snapshot of (locked * acc)

    // -----------------------------------------------------------------
    // Reentrancy guard (custom — keeps storage layout independent of OZ)
    // -----------------------------------------------------------------
    uint256 private _locked = 1; // 1 = unlocked, 2 = locked

    // -----------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------
    event LiquidityAdded(address indexed user, bytes32 indexed pairId, uint256 amount0, uint256 amount1, uint256 lpMinted);
    event LiquidityRemoved(address indexed user, bytes32 indexed pairId, uint256 lpBurned, uint256 amount0, uint256 amount1);
    event Swapped(address indexed user, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, uint256 fee);
    event RewardClaimed(address indexed user, uint256 amount);
    event PoolCreated(bytes32 indexed pairId, address token0, address token1);
    event FeeUpdated(uint256 oldFee, uint256 newFee);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // -----------------------------------------------------------------
    // Modifiers
    // -----------------------------------------------------------------
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier nonReentrant() {
        require(_locked != 2, "ReentrancyGuard: reentrant call");
        _locked = 2;
        _;
        _locked = 1;
    }

    constructor(address _nusd, address _native) {
        require(_nusd != address(0) && _native != address(0), "Zero address");
        NUSD = _nusd;
        NATIVE = _native;
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // -----------------------------------------------------------------
    // Owner
    // -----------------------------------------------------------------
    function setSwapFee(uint256 newFee) external onlyOwner {
        require(newFee <= 500, "Max fee 5%");
        uint256 oldFee = swapFee;
        swapFee = newFee;
        emit FeeUpdated(oldFee, newFee);
    }

    /// @notice Inject NUSD into the reward pool (anyone can fund; owner typically tops up).
    function fundRewardPool(uint256 amount) external {
        require(amount > 0, "amount=0");
        require(IERC20(NUSD).transferFrom(msg.sender, address(this), amount), "Transfer failed");
        totalRewardPool += amount;
    }

    // -----------------------------------------------------------------
    // Pair helpers
    // -----------------------------------------------------------------
    function getPairId(address tokenA, address tokenB) public pure returns (bytes32) {
        (address t0, address t1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return keccak256(abi.encodePacked(t0, t1));
    }

    function _createPool(address tokenA, address tokenB, bytes32 pairId) internal {
        address token0 = tokenA < tokenB ? tokenA : tokenB;
        address token1 = tokenA < tokenB ? tokenB : tokenA;

        Pool storage pool = pools[pairId];
        pool.token0 = token0;
        pool.token1 = token1;
        poolExists[pairId] = true;
        allPools.push(pairId);
        poolCreator[pairId] = msg.sender;

        emit PoolCreated(pairId, token0, token1);
    }

    // -----------------------------------------------------------------
    // Liquidity
    // -----------------------------------------------------------------
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountA,
        uint256 amountB
    ) external payable nonReentrant returns (uint256 lpMinted) {
        require(amountA > 0 && amountB > 0, "amounts=0");

        bytes32 pairId = getPairId(tokenA, tokenB);
        if (!poolExists[pairId]) {
            _createPool(tokenA, tokenB, pairId);
        }

        Pool storage pool = pools[pairId];
        bool isBasePool = (tokenA == NUSD || tokenB == NUSD);

        (uint256 amount0, uint256 amount1) = tokenA == pool.token0
            ? (amountA, amountB)
            : (amountB, amountA);

        // Settle pending reward BEFORE mutating the user's locked balance so the snapshot
        // reflects the previous state. (Also benefits the user pro-rata.)
        _updateReward();

        if (pool.totalLP == 0) {
            lpMinted = _sqrt(amount0 * amount1);
        } else {
            lpMinted = _min(
                (amount0 * pool.totalLP) / pool.reserve0,
                (amount1 * pool.totalLP) / pool.reserve1
            );
        }
        require(lpMinted > 0, "LP minted = 0");

        _transferIn(pool.token0, amount0);
        _transferIn(pool.token1, amount1);

        // Cache user LP delta for the reward snapshot
        uint256 prevLocked = userNUSDLocked[msg.sender];

        unchecked {
            pool.reserve0 += amount0;
            pool.reserve1 += amount1;
            pool.totalLP += lpMinted;
        }
        userLP[pairId][msg.sender] += lpMinted;

        if (isBasePool) {
            uint256 nusdAmt = pool.token0 == NUSD ? amount0 : amount1;
            userNUSDLocked[msg.sender] = prevLocked + nusdAmt;
            totalNUSDLocked += nusdAmt;
        } else {
            userNUSDLocked[msg.sender] = prevLocked; // unchanged
        }
        // Re-snapshot reward debt so previously-accrued but unclaimed reward is preserved.
        userRewardDebt[msg.sender] = userNUSDLocked[msg.sender] * accRewardPerNUSD / ACC_SCALE;

        emit LiquidityAdded(msg.sender, pairId, amount0, amount1, lpMinted);
        return lpMinted;
    }

    function removeLiquidity(bytes32 pairId, uint256 lpAmount) external nonReentrant {
        require(lpAmount > 0, "LP > 0");
        require(msg.sender != poolCreator[pairId], "Creator cannot remove LP");

        Pool storage pool = pools[pairId];
        require(userLP[pairId][msg.sender] >= lpAmount, "Insufficient LP");

        uint256 amount0 = (lpAmount * pool.reserve0) / pool.totalLP;
        uint256 amount1 = (lpAmount * pool.reserve1) / pool.totalLP;
        require(amount0 > 0 && amount1 > 0, "amounts=0");

        bool isBasePool = (pool.token0 == NUSD || pool.token1 == NUSD);
        uint256 nusdAmt = isBasePool
            ? (pool.token0 == NUSD ? amount0 : amount1)
            : 0;

        // Settle reward with current locked balance, then mutate.
        _updateReward();
        uint256 prevLocked = userNUSDLocked[msg.sender];

        unchecked {
            pool.reserve0 -= amount0;
            pool.reserve1 -= amount1;
            pool.totalLP -= lpAmount;
        }
        userLP[pairId][msg.sender] -= lpAmount;

        if (isBasePool) {
            userNUSDLocked[msg.sender] = prevLocked >= nusdAmt ? prevLocked - nusdAmt : 0;
            totalNUSDLocked = totalNUSDLocked >= nusdAmt ? totalNUSDLocked - nusdAmt : 0;
        }
        // Re-snapshot reward debt so user keeps credit for already-accrued reward on the
        // portion of NUSD they still hold (if any).
        userRewardDebt[msg.sender] = userNUSDLocked[msg.sender] * accRewardPerNUSD / ACC_SCALE;

        _transferOut(pool.token0, amount0);
        _transferOut(pool.token1, amount1);

        emit LiquidityRemoved(msg.sender, pairId, lpAmount, amount0, amount1);
    }

    // -----------------------------------------------------------------
    // Swap
    // -----------------------------------------------------------------
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) external payable nonReentrant returns (uint256 amountOut) {
        require(amountIn > 0, "amountIn=0");
        require(tokenIn != tokenOut, "same token");
        require(msg.value == 0 || tokenIn == NATIVE, "Bad msg.value");

        bytes32 pairId = getPairId(tokenIn, tokenOut);
        require(poolExists[pairId], "Pool does not exist");

        Pool storage pool = pools[pairId];

        // Cache reserves (SLOAD once)
        uint256 reserveIn;
        uint256 reserveOut;
        if (tokenIn == pool.token0) {
            reserveIn  = pool.reserve0;
            reserveOut = pool.reserve1;
        } else {
            reserveIn  = pool.reserve1;
            reserveOut = pool.reserve0;
        }
        require(reserveIn > 0 && reserveOut > 0, "Empty reserves");

        uint256 fee = (amountIn * swapFee) / 10000;
        uint256 amountInAfterFee = amountIn - fee;

        amountOut = (amountInAfterFee * reserveOut) / (reserveIn + amountInAfterFee);
        require(amountOut >= minAmountOut, "Slippage too high");
        require(amountOut < reserveOut, "Insufficient liquidity");

        _transferIn(tokenIn, amountIn);
        _transferOut(tokenOut, amountOut);

        unchecked {
            uint256 newReserveIn  = reserveIn  + amountInAfterFee;
            uint256 newReserveOut = reserveOut - amountOut;
            if (tokenIn == pool.token0) {
                pool.reserve0 = newReserveIn;
                pool.reserve1 = newReserveOut;
            } else {
                pool.reserve1 = newReserveIn;
                pool.reserve0 = newReserveOut;
            }
        }

        // Volume + reward accounting
        uint256 volumeNUSD = _getVolumeInNUSD(tokenIn, tokenOut, amountIn, pool);
        _updateVolume(pairId, volumeNUSD);
        totalRewardPool += fee;

        emit Swapped(msg.sender, tokenIn, tokenOut, amountIn, amountOut, fee);
        return amountOut;
    }

    // -----------------------------------------------------------------
    // Reward
    // -----------------------------------------------------------------
    /// @notice Claim all pending NUSD reward for the caller.
    function claimReward() external nonReentrant {
        _updateReward();

        uint256 locked = userNUSDLocked[msg.sender];
        uint256 cumulative = (locked * accRewardPerNUSD) / ACC_SCALE;
        uint256 debt = userRewardDebt[msg.sender];
        uint256 pending = cumulative > debt ? cumulative - debt : 0;
        require(pending > 0, "No reward");
        require(IERC20(NUSD).transfer(msg.sender, pending), "Transfer failed");

        // Reset debt to current snapshot — user starts a new earning period on remaining locked NUSD.
        userRewardDebt[msg.sender] = cumulative;
        emit RewardClaimed(msg.sender, pending);
    }

    /// @dev Move any pending reward into the per-NUSD accumulator.
    function _updateReward() internal {
        if (totalRewardPool > 0 && totalNUSDLocked > 0) {
            accRewardPerNUSD += (totalRewardPool * ACC_SCALE) / totalNUSDLocked;
            totalRewardPool = 0;
        }
    }

    function getUserPendingReward(address user) external view returns (uint256) {
        // Use the same formula as claimReward, but read-only.
        uint256 locked = userNUSDLocked[user];
        if (locked == 0) return 0;

        // Pending undistributed reward (would be settled on next interaction)
        uint256 acc = accRewardPerNUSD;
        if (totalRewardPool > 0 && totalNUSDLocked > 0) {
            acc += (totalRewardPool * ACC_SCALE) / totalNUSDLocked;
        }
        uint256 cumulative = (locked * acc) / ACC_SCALE;
        uint256 debt = userRewardDebt[user];
        return cumulative > debt ? cumulative - debt : 0;
    }

    // -----------------------------------------------------------------
    // Price views (Chart)
    // -----------------------------------------------------------------
    /// @notice Spot price of pool.token0 quoted in pool.token1, scaled by 1e18.
    function getSpotPrice(bytes32 pairId) external view returns (uint256 price) {
        Pool storage pool = pools[pairId];
        if (pool.reserve0 == 0 || pool.reserve1 == 0) return 0;
        price = (pool.reserve0 * 1e18) / pool.reserve1;
    }

    /// @notice Price of `tokenIn` quoted in `tokenOut`, scaled by 1e18.
    function getPrice(address tokenIn, address tokenOut) external view returns (uint256 price) {
        bytes32 pairId = getPairId(tokenIn, tokenOut);
        Pool storage pool = pools[pairId];
        if (pool.reserve0 == 0 || pool.reserve1 == 0) return 0;

        if (tokenIn == pool.token0) {
            price = (pool.reserve0 * 1e18) / pool.reserve1;
        } else {
            price = (pool.reserve1 * 1e18) / pool.reserve0;
        }
    }

    /// @notice Bundle of price + reserves + totalLP for chart/UI.
    function getPoolPriceInfo(bytes32 pairId)
        external
        view
        returns (uint256 price, uint256 reserve0, uint256 reserve1, uint256 totalLP)
    {
        Pool storage pool = pools[pairId];
        if (pool.reserve0 > 0 && pool.reserve1 > 0) {
            price = (pool.reserve0 * 1e18) / pool.reserve1;
        }
        return (price, pool.reserve0, pool.reserve1, pool.totalLP);
    }

    // -----------------------------------------------------------------
    // Pools enumeration
    // -----------------------------------------------------------------
    function getAllPools() external view returns (bytes32[] memory) {
        return allPools;
    }

    function totalPools() external view returns (uint256) {
        return allPools.length;
    }

    // -----------------------------------------------------------------
    // Internal math helpers
    // -----------------------------------------------------------------
    function _getVolumeInNUSD(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        Pool storage pool
    ) internal view returns (uint256) {
        if (tokenIn == NUSD) return amountIn;
        if (tokenOut == NUSD && pool.reserve0 > 0) {
            return (amountIn * pool.reserve1) / pool.reserve0;
        }
        return 0;
    }

    function _updateVolume(bytes32 pairId, uint256 amount) internal {
        Pool storage pool = pools[pairId];
        uint256 last = pool.lastVolumeReset;
        if (block.timestamp > last + 1 days) {
            pool.volume24h = 0;
            pool.lastVolumeReset = block.timestamp;
        }
        // Reset is a fresh start; only add the new amount (not leftover from previous window)
        // when the window just rolled over.
        if (last != 0 && block.timestamp > last + 1 days) {
            pool.volume24h = amount;
        } else {
            pool.volume24h += amount;
        }
        pool.totalVolume += amount;
    }

    function _transferIn(address token, uint256 amount) internal {
        if (token == NATIVE) {
            require(msg.value == amount, "Native mismatch");
        } else {
            require(IERC20(token).transferFrom(msg.sender, address(this), amount), "Transfer failed");
        }
    }

    function _transferOut(address token, uint256 amount) internal {
        if (token == NATIVE) {
            (bool success, ) = payable(msg.sender).call{value: amount}("");
            require(success, "Native transfer failed");
        } else {
            require(IERC20(token).transfer(msg.sender, amount), "Transfer failed");
        }
    }

    function _sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) { z = x; x = (y / x + x) / 2; }
        } else if (y != 0) { z = 1; }
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    receive() external payable {}
}
