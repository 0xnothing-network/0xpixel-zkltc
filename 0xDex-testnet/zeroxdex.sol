// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IZeroDexERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IRewardManager {
    function addReward(uint256 amount) external;
    function updateUserLocked(address user, uint256 newLocked) external;
    function pokeReward() external;
    function userNUSDLocked(address user) external view returns (uint256);
    function dex() external view returns (address);
    function NUSD() external view returns (address);
}

contract ZeroDex {
    address public immutable NUSD;
    address public immutable NATIVE;
    address public owner;
    IRewardManager public rewardManager;

    uint256 public swapFee = 10;
    uint256 public constant CREATOR_LOCK_PERIOD = 30 days;

    struct Pool {
        address token0;
        address token1;
        uint256 reserve0;
        uint256 reserve1;
        uint256 totalLP;
        uint256 volume24h;
        uint256 totalVolume;
        uint256 lastVolumeReset;
        uint256 createdAt;
    }

    mapping(bytes32 => Pool) public pools;
    mapping(bytes32 => mapping(address => uint256)) public userLP;
    mapping(bytes32 => mapping(address => uint256)) public userNUSDLockedByPool;
    mapping(bytes32 => address) public poolCreator;
    mapping(bytes32 => uint256) public creatorUnlockTime;
    bytes32[] public allPools;
    mapping(bytes32 => bool) public poolExists;
    mapping(address => uint256) public collectedFees;

    uint256 private _locked = 1;

    event LiquidityAdded(address indexed user, bytes32 indexed pairId, uint256 amount0, uint256 amount1, uint256 lpMinted);
    event LiquidityRemoved(address indexed user, bytes32 indexed pairId, uint256 lpBurned, uint256 amount0, uint256 amount1);
    event Swapped(address indexed user, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, uint256 fee);
    event PoolCreated(bytes32 indexed pairId, address token0, address token1, address creator);
    event FeeUpdated(uint256 oldFee, uint256 newFee);
    event RewardManagerSet(address indexed rewardManager);
    event FeeCollected(address indexed token, uint256 amount);
    event FeeWithdrawn(address indexed token, address indexed to, uint256 amount);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier nonReentrant() {
        require(_locked != 2, "Reentrancy");
        _locked = 2;
        _;
        _locked = 1;
    }

    constructor(address _nusd, address _native) {
        require(_nusd != address(0) && _native != address(0), "Zero address");
        require(_nusd != _native, "NUSD=NATIVE");
        NUSD = _nusd;
        NATIVE = _native;
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function setRewardManager(address _rewardManager) external onlyOwner {
        require(address(rewardManager) == address(0), "RewardManager already set");
        require(_rewardManager != address(0), "Zero address");
        IRewardManager manager = IRewardManager(_rewardManager);
        require(manager.dex() == address(this), "Wrong dex");
        require(manager.NUSD() == NUSD, "Wrong NUSD");
        rewardManager = manager;
        emit RewardManagerSet(_rewardManager);
    }

    function setSwapFee(uint256 newFee) external onlyOwner {
        require(newFee <= 500, "Max fee 5%");
        uint256 oldFee = swapFee;
        swapFee = newFee;
        emit FeeUpdated(oldFee, newFee);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function withdrawCollectedFees(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        require(to != address(0), "Zero address");
        require(amount > 0, "amount=0");

        uint256 available = collectedFees[token];
        require(available >= amount, "Insufficient fees");
        collectedFees[token] = available - amount;

        _transferTo(token, to, amount);
        emit FeeWithdrawn(token, to, amount);
    }

    // ==================== PERMISSIONLESS POOL ====================
    function createPool(address tokenA, address tokenB) external {
        bytes32 pairId = getPairId(tokenA, tokenB);
        require(!poolExists[pairId], "Pool already exists");

        _createPool(tokenA, tokenB, pairId);
        creatorUnlockTime[pairId] = block.timestamp + CREATOR_LOCK_PERIOD;
    }

    function getPairId(address tokenA, address tokenB) public pure returns (bytes32) {
        require(tokenA != address(0) && tokenB != address(0), "Zero address");
        require(tokenA != tokenB, "same token");
        (address t0, address t1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return keccak256(abi.encodePacked(t0, t1));
    }

    function _createPool(address tokenA, address tokenB, bytes32 pairId) internal {
        require(tokenA != address(0) && tokenB != address(0), "Zero address");
        require(tokenA != tokenB, "same token");

        address token0 = tokenA < tokenB ? tokenA : tokenB;
        address token1 = tokenA < tokenB ? tokenB : tokenA;

        pools[pairId].token0 = token0;
        pools[pairId].token1 = token1;
        pools[pairId].createdAt = block.timestamp;
        poolExists[pairId] = true;
        allPools.push(pairId);
        poolCreator[pairId] = msg.sender;

        emit PoolCreated(pairId, token0, token1, msg.sender);
    }

    // ==================== LIQUIDITY ====================

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountA,
        uint256 amountB
    ) external payable nonReentrant returns (uint256 lpMinted) {
        require(amountA > 0 && amountB > 0, "amounts=0");
        uint256 nativeAmount = 0;
        if (tokenA == NATIVE) nativeAmount += amountA;
        if (tokenB == NATIVE) nativeAmount += amountB;
        require(msg.value == nativeAmount, "Native mismatch");

        bytes32 pairId = getPairId(tokenA, tokenB);
        if (!poolExists[pairId]) {
            _createPool(tokenA, tokenB, pairId);
            creatorUnlockTime[pairId] = block.timestamp + CREATOR_LOCK_PERIOD;
        }

        Pool storage pool = pools[pairId];
        bool isBasePool = (pool.token0 == NUSD || pool.token1 == NUSD);

        (uint256 amount0, uint256 amount1) = tokenA == pool.token0 ? (amountA, amountB) : (amountB, amountA);

        if (isBasePool && address(rewardManager) != address(0)) {
            rewardManager.pokeReward();
        }

        if (pool.totalLP == 0) {
            poolCreator[pairId] = msg.sender;
            creatorUnlockTime[pairId] = block.timestamp + CREATOR_LOCK_PERIOD;
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

        unchecked {
            pool.reserve0 += amount0;
            pool.reserve1 += amount1;
            pool.totalLP += lpMinted;
        }

        userLP[pairId][msg.sender] += lpMinted;

        if (isBasePool) {
            uint256 nusdAmt = pool.token0 == NUSD ? amount0 : amount1;
            userNUSDLockedByPool[pairId][msg.sender] += nusdAmt;

            if (address(rewardManager) != address(0)) {
                uint256 prevLocked = rewardManager.userNUSDLocked(msg.sender);
                rewardManager.updateUserLocked(msg.sender, prevLocked + nusdAmt);
            }
        }

        emit LiquidityAdded(msg.sender, pairId, amount0, amount1, lpMinted);
        return lpMinted;
    }

    function removeLiquidity(bytes32 pairId, uint256 lpAmount) external nonReentrant {
        require(lpAmount > 0, "LP > 0");

        if (msg.sender == poolCreator[pairId]) {
            require(block.timestamp >= creatorUnlockTime[pairId], "Creator in lock period");
        }

        Pool storage pool = pools[pairId];
        uint256 userLpBefore = userLP[pairId][msg.sender];
        require(userLpBefore >= lpAmount, "Insufficient LP");

        uint256 amount0 = (lpAmount * pool.reserve0) / pool.totalLP;
        uint256 amount1 = (lpAmount * pool.reserve1) / pool.totalLP;
        require(amount0 > 0 && amount1 > 0, "amounts=0");

        bool isBasePool = (pool.token0 == NUSD || pool.token1 == NUSD);
        uint256 lockedToRemove = 0;
        if (isBasePool) {
            uint256 poolLocked = userNUSDLockedByPool[pairId][msg.sender];
            lockedToRemove = lpAmount == userLpBefore ? poolLocked : (poolLocked * lpAmount) / userLpBefore;
        }

        if (isBasePool && address(rewardManager) != address(0)) {
            rewardManager.pokeReward();
        }

        unchecked {
            pool.reserve0 -= amount0;
            pool.reserve1 -= amount1;
            pool.totalLP -= lpAmount;
        }

        userLP[pairId][msg.sender] -= lpAmount;

        if (isBasePool) {
            uint256 poolLocked = userNUSDLockedByPool[pairId][msg.sender];
            userNUSDLockedByPool[pairId][msg.sender] = poolLocked >= lockedToRemove ? poolLocked - lockedToRemove : 0;

            if (address(rewardManager) != address(0)) {
                uint256 currentLocked = rewardManager.userNUSDLocked(msg.sender);
                uint256 newLocked = currentLocked >= lockedToRemove ? currentLocked - lockedToRemove : 0;
                rewardManager.updateUserLocked(msg.sender, newLocked);
            }
        }

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
    ) external payable nonReentrant returns (uint256 amountOut) {
        require(amountIn > 0, "amountIn=0");
        require(tokenIn != tokenOut, "same token");
        require(tokenIn == NATIVE ? msg.value == amountIn : msg.value == 0, "Native mismatch");

        bytes32 pairId = getPairId(tokenIn, tokenOut);
        require(poolExists[pairId], "Pool does not exist");

        Pool storage pool = pools[pairId];
        uint256 reserveIn = tokenIn == pool.token0 ? pool.reserve0 : pool.reserve1;
        uint256 reserveOut = tokenIn == pool.token0 ? pool.reserve1 : pool.reserve0;

        require(reserveIn > 0 && reserveOut > 0, "Empty reserves");

        uint256 fee = (amountIn * swapFee) / 10000;
        uint256 amountInAfterFee = amountIn - fee;
        amountOut = (amountInAfterFee * reserveOut) / (reserveIn + amountInAfterFee);

        require(amountOut > 0, "amountOut=0");
        require(amountOut < reserveOut, "Insufficient liquidity");
        require(amountOut >= minAmountOut, "Slippage too high");
        uint256 volumeNUSD = _getVolumeInNUSD(tokenIn, tokenOut, amountIn, pool);

        _transferIn(tokenIn, amountIn);
        _transferOut(tokenOut, amountOut);

        unchecked {
            if (tokenIn == pool.token0) {
                pool.reserve0 = reserveIn + amountInAfterFee;
                pool.reserve1 = reserveOut - amountOut;
            } else {
                pool.reserve1 = reserveIn + amountInAfterFee;
                pool.reserve0 = reserveOut - amountOut;
            }
        }

        _updateVolume(pairId, volumeNUSD);

        if (fee > 0 && address(rewardManager) != address(0) && tokenIn == NUSD) {
            _transferTo(NUSD, address(rewardManager), fee);
            rewardManager.addReward(fee);
            rewardManager.pokeReward();
        } else if (fee > 0) {
            collectedFees[tokenIn] += fee;
            emit FeeCollected(tokenIn, fee);
        }

        emit Swapped(msg.sender, tokenIn, tokenOut, amountIn, amountOut, fee);
        return amountOut;
    }

    // ==================== MULTICALL ====================

    function multicall(bytes[] calldata data) external payable returns (bytes[] memory results) {
        require(msg.value == 0, "No multicall value");

        results = new bytes[](data.length);
        for (uint256 i = 0; i < data.length; i++) {
            (bool success, bytes memory result) = address(this).delegatecall(data[i]);
            require(success, "Multicall failed");
            results[i] = result;
        }
        return results;
    }

    // ==================== VIEW ====================

    function getPoolPriceInfo(bytes32 pairId)
        external view returns (uint256 price, uint256 reserve0, uint256 reserve1, uint256 totalLP)
    {
        Pool storage pool = pools[pairId];
        if (pool.reserve0 > 0 && pool.reserve1 > 0) {
            price = (pool.reserve0 * 1e18) / pool.reserve1;
        }
        return (price, pool.reserve0, pool.reserve1, pool.totalLP);
    }

    function getAllPools() external view returns (bytes32[] memory) {
        return allPools;
    }

    // ==================== INTERNAL ====================

    function _getVolumeInNUSD(address tokenIn, address tokenOut, uint256 amountIn, Pool storage pool)
        internal view returns (uint256)
    {
        if (tokenIn == NUSD) return amountIn;
        if (tokenOut == NUSD) {
            uint256 reserveTokenIn = tokenIn == pool.token0 ? pool.reserve0 : pool.reserve1;
            uint256 reserveNUSD = tokenOut == pool.token0 ? pool.reserve0 : pool.reserve1;
            if (reserveTokenIn > 0) {
                return (amountIn * reserveNUSD) / reserveTokenIn;
            }
        }
        return 0;
    }

    function _updateVolume(bytes32 pairId, uint256 amount) internal {
        Pool storage pool = pools[pairId];
        if (block.timestamp > pool.lastVolumeReset + 1 days) {
            pool.volume24h = amount;
            pool.lastVolumeReset = block.timestamp;
        } else {
            pool.volume24h += amount;
        }
        pool.totalVolume += amount;
    }

    function _transferIn(address token, uint256 amount) internal {
        if (token == NATIVE) {
            require(msg.value == amount, "Native mismatch");
        } else {
            uint256 balanceBefore = IZeroDexERC20(token).balanceOf(address(this));
            require(IZeroDexERC20(token).transferFrom(msg.sender, address(this), amount), "Transfer failed");
            uint256 received = IZeroDexERC20(token).balanceOf(address(this)) - balanceBefore;
            require(received == amount, "Fee token unsupported");
        }
    }

    function _transferOut(address token, uint256 amount) internal {
        _transferTo(token, msg.sender, amount);
    }

    function _transferTo(address token, address to, uint256 amount) internal {
        require(to != address(0), "Zero address");

        if (token == NATIVE) {
            (bool success, ) = payable(to).call{value: amount}("");
            require(success, "Native transfer failed");
        } else {
            require(IZeroDexERC20(token).transfer(to, amount), "Transfer failed");
        }
    }

    function _sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y; uint256 x = y / 2 + 1;
            while (x < z) { z = x; x = (y / x + x) / 2; }
        } else if (y != 0) { z = 1; }
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    receive() external payable {}
}
