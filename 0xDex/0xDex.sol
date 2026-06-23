// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract ZeroXDex {
    address public immutable NUSD;
    address public immutable NATIVE;
    address public owner;

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

    uint256 public totalRewardPool;
    uint256 public totalNUSDLocked;
    uint256 public accRewardPerNUSD;

    mapping(address => uint256) public userNUSDLocked;
    mapping(address => uint256) public userRewardDebt;

    address[] public allPools;
    mapping(bytes32 => bool) public poolExists;

    event LiquidityAdded(
        address indexed user,
        bytes32 indexed pairId,
        uint256 amount0,
        uint256 amount1,
        uint256 lpMinted
    );
    event LiquidityRemoved(
        address indexed user,
        bytes32 indexed pairId,
        uint256 lpBurned,
        uint256 amount0,
        uint256 amount1
    );
    event Swapped(
        address indexed user,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 fee
    );
    event RewardClaimed(address indexed user, uint256 amount);
    event PoolCreated(bytes32 indexed pairId, address token0, address token1);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _nusd, address _native) {
        NUSD = _nusd;
        NATIVE = _native;
        owner = msg.sender;
    }

    function getPairId(address tokenA, address tokenB) public pure returns (bytes32) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return keccak256(abi.encodePacked(token0, token1));
    }

    // ==================== LIQUIDITY ====================

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountA,
        uint256 amountB
    ) external payable returns (uint256 lpMinted) {
        bytes32 pairId = getPairId(tokenA, tokenB);

        if (!poolExists[pairId]) {
            // === ĐÃ SỬA: Ai cũng có thể tạo pool mới ===
            address token0 = tokenA < tokenB ? tokenA : tokenB;
            address token1 = tokenA < tokenB ? tokenB : tokenA;

            pools[pairId].token0 = token0;
            pools[pairId].token1 = token1;
            poolExists[pairId] = true;
            allPools.push(token0);
            poolCreator[pairId] = msg.sender;

            emit PoolCreated(pairId, token0, token1);
        }

        Pool storage pool = pools[pairId];
        bool isBasePool = (tokenA == NUSD || tokenB == NUSD);

        (uint256 amount0, uint256 amount1) = tokenA == pool.token0
            ? (amountA, amountB)
            : (amountB, amountA);

        if (pool.totalLP == 0) {
            lpMinted = sqrt(amount0 * amount1);
        } else {
            lpMinted = min(
                (amount0 * pool.totalLP) / pool.reserve0,
                (amount1 * pool.totalLP) / pool.reserve1
            );
        }
        require(lpMinted > 0, "Insufficient LP minted");

        _transferIn(pool.token0, amount0);
        _transferIn(pool.token1, amount1);

        pool.reserve0 += amount0;
        pool.reserve1 += amount1;
        pool.totalLP += lpMinted;
        userLP[pairId][msg.sender] += lpMinted;

        if (isBasePool) {
            uint256 nusdAmount = pool.token0 == NUSD ? amount0 : amount1;
            userNUSDLocked[msg.sender] += nusdAmount;
            totalNUSDLocked += nusdAmount;
        }

        _updateReward();

        emit LiquidityAdded(msg.sender, pairId, amount0, amount1, lpMinted);
        return lpMinted;
    }

    function removeLiquidity(bytes32 pairId, uint256 lpAmount) external {
        require(lpAmount > 0, "LP amount must be > 0");
        require(msg.sender != poolCreator[pairId], "Pool creator cannot remove liquidity");

        Pool storage pool = pools[pairId];
        require(userLP[pairId][msg.sender] >= lpAmount, "Insufficient LP");

        _updateReward();

        uint256 amount0 = (lpAmount * pool.reserve0) / pool.totalLP;
        uint256 amount1 = (lpAmount * pool.reserve1) / pool.totalLP;

        bool isBasePool = (pool.token0 == NUSD || pool.token1 == NUSD);
        if (isBasePool) {
            uint256 nusdAmount = pool.token0 == NUSD ? amount0 : amount1;
            userNUSDLocked[msg.sender] = userNUSDLocked[msg.sender] >= nusdAmount
                ? userNUSDLocked[msg.sender] - nusdAmount
                : 0;

            totalNUSDLocked = totalNUSDLocked >= nusdAmount
                ? totalNUSDLocked - nusdAmount
                : 0;
        }

        pool.reserve0 -= amount0;
        pool.reserve1 -= amount1;
        pool.totalLP -= lpAmount;
        userLP[pairId][msg.sender] -= lpAmount;

        _transferOut(pool.token0, amount0);
        _transferOut(pool.token1, amount1);

        emit LiquidityRemoved(msg.sender, pairId, lpAmount, amount0, amount1);
    }

    // ==================== SWAP ====================

    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) external payable returns (uint256 amountOut) {
        bytes32 pairId = getPairId(tokenIn, tokenOut);
        require(poolExists[pairId], "Pool does not exist");

        Pool storage pool = pools[pairId];

        if (tokenIn != NUSD && tokenOut != NUSD) {
            bytes32 base0 = getPairId(NUSD, tokenIn);
            bytes32 base1 = getPairId(NUSD, tokenOut);
            require(poolExists[base0] && poolExists[base1], "Base pool required");
        }

        (uint256 reserveIn, uint256 reserveOut) = tokenIn == pool.token0
            ? (pool.reserve0, pool.reserve1)
            : (pool.reserve1, pool.reserve0);

        uint256 fee = (amountIn * 100) / 10000;
        uint256 amountInAfterFee = amountIn - fee;

        amountOut = (amountInAfterFee * reserveOut) / (reserveIn + amountInAfterFee);
        require(amountOut >= minAmountOut, "Slippage too high");

        _transferIn(tokenIn, amountIn);
        _transferOut(tokenOut, amountOut);

        if (tokenIn == pool.token0) {
            pool.reserve0 += amountInAfterFee;
            pool.reserve1 -= amountOut;
        } else {
            pool.reserve1 += amountInAfterFee;
            pool.reserve0 -= amountOut;
        }

        uint256 volumeInNUSD = _getVolumeInNUSD(tokenIn, tokenOut, amountIn, pool);
        _updateVolume(pairId, volumeInNUSD);

        totalRewardPool += fee;
        _updateReward();

        emit Swapped(msg.sender, tokenIn, tokenOut, amountIn, amountOut, fee);
        return amountOut;
    }

    function _getVolumeInNUSD(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        Pool storage pool
    ) internal view returns (uint256) {
        if (tokenIn == NUSD) {
            return amountIn;
        } else if (tokenOut == NUSD) {
            if (pool.reserve0 > 0 && pool.reserve1 > 0) {
                return (amountIn * pool.reserve1) / pool.reserve0;
            }
            return amountIn;
        } else {
            return 0;
        }
    }

    // ==================== REWARD ====================

    function claimReward() external {
        _updateReward();

        uint256 pending = _calculatePendingReward(msg.sender);
        require(pending > 0, "No reward");

        userRewardDebt[msg.sender] += pending;

        IERC20(NUSD).transfer(msg.sender, pending);
        emit RewardClaimed(msg.sender, pending);
    }

    function _calculatePendingReward(address user) internal view returns (uint256) {
        if (totalNUSDLocked == 0 || userNUSDLocked[user] == 0) return 0;
        uint256 totalReward = (userNUSDLocked[user] * accRewardPerNUSD) / 1e18;
        if (totalReward <= userRewardDebt[user]) return 0;
        return totalReward - userRewardDebt[user];
    }

    function _updateReward() internal {
        if (totalRewardPool > 0 && totalNUSDLocked > 0) {
            accRewardPerNUSD += (totalRewardPool * 1e18) / totalNUSDLocked;
            totalRewardPool = 0;
        }
    }

    // ==================== VIEW FUNCTIONS ====================

    function getAllPools() external view returns (address[] memory) {
        return allPools;
    }

    function getUserPendingReward(address user) external view returns (uint256) {
        return _calculatePendingReward(user);
    }

    function getPoolInfo(bytes32 pairId)
        external
        view
        returns (
            address token0,
            address token1,
            uint256 reserve0,
            uint256 reserve1,
            uint256 totalLP,
            uint256 volume24h,
            uint256 totalVolume
        )
    {
        Pool storage pool = pools[pairId];
        return (
            pool.token0,
            pool.token1,
            pool.reserve0,
            pool.reserve1,
            pool.totalLP,
            pool.volume24h,
            pool.totalVolume
        );
    }

    // ==================== INTERNAL ====================

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
            IERC20(token).transfer(msg.sender, amount);
        }
    }

    function _updateVolume(bytes32 pairId, uint256 amountInNUSD) internal {
        Pool storage pool = pools[pairId];
        if (block.timestamp > pool.lastVolumeReset + 1 days) {
            pool.volume24h = 0;
            pool.lastVolumeReset = block.timestamp;
        }
        pool.volume24h += amountInNUSD;
        pool.totalVolume += amountInNUSD;
    }

    function sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }

    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    receive() external payable {}
}