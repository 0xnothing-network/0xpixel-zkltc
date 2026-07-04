// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Minimal {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IDIAAggregatorV3 {
    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
}

/// @title 0xPrediction
/// @notice Onchain UP/DOWN prediction rounds using DIA AggregatorV3 adapters and NUSD.
/// @dev Each asset can have only one pending round at a time. Predictions are open
///      for the first 10 minutes by default. Each round lasts a fixed 2 hours from
///      the contract start timestamp. Settlement uses
///      latestRoundData only and does not depend on DIA's heartbeat or historical getRoundData.
contract ZeroxPrediction {
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant DEFAULT_FEE_BPS = 50; // 0.5%
    uint32 public constant DEFAULT_HEARTBEAT = 2 hours; // Kept as "heartbeat" for ABI compatibility; used as round duration.
    uint32 public constant DEFAULT_BET_WINDOW = 10 minutes;
    uint32 public constant DEFAULT_STALE_CANCEL_DELAY = 2 hours; // Refund window only if the oracle feed becomes unreadable.
    uint256 public constant DEFAULT_SETTLE_LOOKBACK = 96; // ABI compatibility; ignored by latest-only DIA settlement.
    uint256 public constant DEFAULT_MIN_BET = 1 ether; // NUSD uses 18 decimals in the current deployment.

    enum Side {
        Up,
        Down
    }

    enum Outcome {
        Pending,
        Up,
        Down,
        Draw,
        Cancelled
    }

    struct AssetConfig {
        string symbol;
        address feed;
        uint32 heartbeat;
        uint32 betWindow;
        uint32 staleCancelDelay;
        uint256 minBet;
        uint256 maxBet;
        bool enabled;
        bool exists;
    }

    struct AssetInput {
        string symbol;
        address feed;
        uint32 heartbeat;
        uint32 betWindow;
        uint32 staleCancelDelay;
        uint256 minBet;
        uint256 maxBet;
        bool enabled;
    }

    struct Round {
        bytes32 assetId;
        string symbol;
        address feed;
        uint80 startOracleRoundId;
        uint80 endOracleRoundId;
        uint256 startPrice;
        uint256 endPrice;
        uint256 startTime;
        uint256 betDeadline;
        uint256 closeTime;
        uint256 staleCancelTime;
        uint256 minBet;
        uint256 maxBet;
        uint256 feeBps;
        uint256 upPool;
        uint256 downPool;
        uint256 feeAmount;
        Outcome outcome;
        bool settled;
        bool cancelled;
    }

    struct Position {
        uint256 upAmount;
        uint256 downAmount;
        bool claimed;
    }

    IERC20Minimal public immutable NUSD;

    address public owner;
    address public pendingOwner;
    address public feeReceiver;
    uint256 public feeBps = DEFAULT_FEE_BPS;
    uint256 public protocolFees;
    bool public paused;

    uint256 public roundCount;
    uint256 private _locked = 1;

    bytes32[] private _assetIds;

    mapping(bytes32 => AssetConfig) public assets;
    mapping(bytes32 => uint256) public latestRoundOfAsset;
    mapping(bytes32 => mapping(address => mapping(uint80 => uint256))) public roundOfOracleRound;
    mapping(uint256 => Round) private _rounds;
    mapping(uint256 => mapping(address => Position)) private _positions;

    event AssetUpdated(bytes32 indexed assetId, string symbol, address indexed feed, bool enabled);
    event RoundStarted(
        uint256 indexed roundId,
        bytes32 indexed assetId,
        string symbol,
        uint80 indexed oracleRoundId,
        uint256 startPrice,
        uint256 startTime,
        uint256 betDeadline,
        uint256 closeTime
    );
    event BetPlaced(
        uint256 indexed roundId,
        address indexed user,
        Side indexed side,
        uint256 amount,
        uint256 upPool,
        uint256 downPool
    );
    event RoundSettled(
        uint256 indexed roundId,
        Outcome indexed outcome,
        uint80 indexed endOracleRoundId,
        uint256 endPrice,
        uint256 feeAmount
    );
    event RoundCancelled(uint256 indexed roundId);
    event Claimed(uint256 indexed roundId, address indexed user, uint256 amount);
    event ProtocolFeesWithdrawn(address indexed receiver, uint256 amount);
    event FeeUpdated(uint256 oldFeeBps, uint256 newFeeBps);
    event FeeReceiverUpdated(address indexed oldReceiver, address indexed newReceiver);
    event Paused(bool paused);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
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

    modifier whenNotPaused() {
        require(!paused, "Paused");
        _;
    }

    constructor(address nusd, address initialFeeReceiver) {
        require(nusd != address(0), "Zero NUSD");
        NUSD = IERC20Minimal(nusd);
        owner = msg.sender;
        feeReceiver = initialFeeReceiver == address(0) ? msg.sender : initialFeeReceiver;

        _registerLitVMTestnetFeeds();

        emit OwnershipTransferred(address(0), msg.sender);
        emit FeeReceiverUpdated(address(0), feeReceiver);
    }

    function assetIdOf(string memory symbol) public pure returns (bytes32) {
        return keccak256(bytes(symbol));
    }

    function getAssetIds() external view returns (bytes32[] memory) {
        return _assetIds;
    }

    function getPosition(uint256 roundId, address user)
        external
        view
        returns (uint256 upAmount, uint256 downAmount, bool claimed)
    {
        Position storage position = _positions[roundId][user];
        return (position.upAmount, position.downAmount, position.claimed);
    }

    function getRoundCore(uint256 roundId)
        external
        view
        returns (
            bytes32 assetId,
            string memory symbol,
            address feed,
            uint80 startOracleRoundId,
            uint80 endOracleRoundId,
            uint256 startPrice,
            uint256 endPrice,
            Outcome outcome,
            bool settled,
            bool cancelled
        )
    {
        Round storage round = _existingRound(roundId);
        return (
            round.assetId,
            round.symbol,
            round.feed,
            round.startOracleRoundId,
            round.endOracleRoundId,
            round.startPrice,
            round.endPrice,
            round.outcome,
            round.settled,
            round.cancelled
        );
    }

    function getRoundTimes(uint256 roundId)
        external
        view
        returns (uint256 startTime, uint256 betDeadline, uint256 closeTime, uint256 staleCancelTime)
    {
        Round storage round = _existingRound(roundId);
        return (round.startTime, round.betDeadline, round.closeTime, round.staleCancelTime);
    }

    function getRoundPools(uint256 roundId)
        external
        view
        returns (
            uint256 upPool,
            uint256 downPool,
            uint256 feeAmount,
            uint256 feeBpsSnapshot,
            uint256 minBet,
            uint256 maxBet
        )
    {
        Round storage round = _existingRound(roundId);
        return (round.upPool, round.downPool, round.feeAmount, round.feeBps, round.minBet, round.maxBet);
    }

    function previewSettlementOracleRound(uint256 roundId, uint256 maxLookback)
        external
        view
        returns (uint80 oracleRoundId, uint256 price, uint256 updatedAt)
    {
        maxLookback;
        Round storage round = _existingRound(roundId);
        return _previewSettlement(round);
    }

    function getLatestPrice(string calldata symbol)
        external
        view
        returns (uint80 oracleRoundId, uint256 price, uint256 updatedAt)
    {
        AssetConfig storage asset = _enabledAsset(assetIdOf(symbol));
        return _readLatest(asset.feed);
    }

    function canBetNow(string calldata symbol)
        external
        view
        returns (
            bool canBet,
            uint80 oracleRoundId,
            uint256 price,
            uint256 updatedAt,
            uint256 betDeadline,
            uint256 closeTime
        )
    {
        bytes32 assetId = assetIdOf(symbol);
        AssetConfig storage asset = _enabledAsset(assetId);

        uint256 latestRoundId = latestRoundOfAsset[assetId];
        if (latestRoundId != 0) {
            Round storage latestRound = _rounds[latestRoundId];
            if (!latestRound.settled && !latestRound.cancelled) {
                canBet = block.timestamp <= latestRound.betDeadline;
                return (
                    canBet,
                    latestRound.startOracleRoundId,
                    latestRound.startPrice,
                    latestRound.startTime,
                    latestRound.betDeadline,
                    latestRound.closeTime
                );
            }
        }

        (oracleRoundId, price, updatedAt) = _readLatest(asset.feed);

        betDeadline = block.timestamp + asset.betWindow;
        closeTime = block.timestamp + asset.heartbeat;
        canBet = updatedAt <= block.timestamp;
    }

    function startRound(string calldata symbol) external onlyOwner whenNotPaused returns (uint256 roundId) {
        bytes32 assetId = assetIdOf(symbol);
        AssetConfig storage asset = _enabledAsset(assetId);
        (uint80 oracleRoundId, uint256 price, uint256 updatedAt) = _readLatest(asset.feed);
        return _startRoundFromOracle(assetId, asset, oracleRoundId, price, updatedAt);
    }

    function predict(string calldata symbol, Side side, uint256 amount)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 roundId)
    {
        require(amount > 0, "amount=0");
        require(uint8(side) <= uint8(Side.Down), "Invalid side");

        bytes32 assetId = assetIdOf(symbol);
        AssetConfig storage asset = _enabledAsset(assetId);
        (uint80 oracleRoundId, uint256 price, uint256 updatedAt) = _readLatest(asset.feed);

        roundId = _startRoundFromOracle(assetId, asset, oracleRoundId, price, updatedAt);
        Round storage round = _rounds[roundId];
        require(!round.settled && !round.cancelled, "Round closed");
        require(block.timestamp <= round.betDeadline, "Prediction window closed");
        require(amount >= round.minBet, "Amount below minimum");

        Position storage position = _positions[roundId][msg.sender];
        uint256 totalUserBet = position.upAmount + position.downAmount + amount;
        require(round.maxBet == 0 || totalUserBet <= round.maxBet, "Amount above maximum");

        _safeTransferFrom(address(NUSD), msg.sender, address(this), amount);

        if (side == Side.Up) {
            position.upAmount += amount;
            round.upPool += amount;
        } else {
            position.downAmount += amount;
            round.downPool += amount;
        }

        emit BetPlaced(roundId, msg.sender, side, amount, round.upPool, round.downPool);
    }

    /// @notice Settle using the current latest DIA oracle update.
    /// @dev endOracleRoundId must match latestRoundData().roundId. Historical getRoundData is not used.
    function settleRound(uint256 roundId, uint80 endOracleRoundId) external nonReentrant {
        Round storage round = _existingRound(roundId);
        (uint80 oracleRoundId, uint256 endPrice, uint256 updatedAt) = _previewSettlement(round);
        require(endOracleRoundId == oracleRoundId, "Use latest oracle round");
        _settleRoundFromLatest(roundId, round, oracleRoundId, endPrice, updatedAt);
    }

    /// @notice Settle after closeTime using the current DIA latestRoundData answer.
    function settleLatestRound(uint256 roundId) external nonReentrant {
        Round storage round = _existingRound(roundId);
        (uint80 oracleRoundId, uint256 endPrice, uint256 updatedAt) = _previewSettlement(round);
        _settleRoundFromLatest(roundId, round, oracleRoundId, endPrice, updatedAt);
    }

    function settleLatestRoundWithLookback(uint256 roundId, uint256 maxLookback) external nonReentrant {
        maxLookback;
        Round storage round = _existingRound(roundId);
        (uint80 oracleRoundId, uint256 endPrice, uint256 updatedAt) = _previewSettlement(round);
        _settleRoundFromLatest(roundId, round, oracleRoundId, endPrice, updatedAt);
    }

    function _settleRoundFromLatest(
        uint256 roundId,
        Round storage round,
        uint80 endOracleRoundId,
        uint256 endPrice,
        uint256 updatedAt
    ) internal {
        round.settled = true;
        round.endOracleRoundId = endOracleRoundId;
        round.endPrice = endPrice;

        if (round.upPool == 0 || round.downPool == 0 || endPrice == round.startPrice) {
            round.outcome = Outcome.Draw;
        } else if (endPrice > round.startPrice) {
            round.outcome = Outcome.Up;
            round.feeAmount = (round.downPool * round.feeBps) / BPS_DENOMINATOR;
        } else {
            round.outcome = Outcome.Down;
            round.feeAmount = (round.upPool * round.feeBps) / BPS_DENOMINATOR;
        }

        protocolFees += round.feeAmount;

        updatedAt;
        emit RoundSettled(roundId, round.outcome, endOracleRoundId, endPrice, round.feeAmount);
    }

    function cancelStaleRound(uint256 roundId) external nonReentrant {
        Round storage round = _existingRound(roundId);
        require(!round.settled && !round.cancelled, "Round closed");
        require(block.timestamp > round.staleCancelTime, "Too early");

        (bool ok, , , ) = _tryReadLatest(round.feed);
        require(!ok, "Settlement ready");

        round.cancelled = true;
        round.outcome = Outcome.Cancelled;

        emit RoundCancelled(roundId);
    }

    function claim(uint256 roundId) external nonReentrant returns (uint256 amount) {
        Round storage round = _existingRound(roundId);
        require(round.settled || round.cancelled, "Not finalized");

        Position storage position = _positions[roundId][msg.sender];
        require(!position.claimed, "Already claimed");

        amount = _claimable(round, position);
        require(amount > 0, "Nothing to claim");

        position.claimed = true;
        _safeTransfer(address(NUSD), msg.sender, amount);

        emit Claimed(roundId, msg.sender, amount);
    }

    function getClaimable(uint256 roundId, address user) external view returns (uint256) {
        Round storage round = _existingRound(roundId);
        Position storage position = _positions[roundId][user];
        if (!(round.settled || round.cancelled) || position.claimed) return 0;
        return _claimable(round, position);
    }

    function setAsset(AssetInput calldata input) external onlyOwner {
        _setAsset(input);
    }

    function setAssetDefault(string calldata symbol, address feed, bool enabled) external onlyOwner {
        _setDefaultAsset(symbol, feed, enabled);
    }

    function setPaused(bool newPaused) external onlyOwner {
        paused = newPaused;
        emit Paused(newPaused);
    }

    function setFeeBps(uint256 newFeeBps) external onlyOwner {
        require(newFeeBps <= 500, "Fee too high");
        uint256 oldFeeBps = feeBps;
        feeBps = newFeeBps;
        emit FeeUpdated(oldFeeBps, newFeeBps);
    }

    function setFeeReceiver(address newFeeReceiver) external onlyOwner {
        require(newFeeReceiver != address(0), "Zero receiver");
        address oldReceiver = feeReceiver;
        feeReceiver = newFeeReceiver;
        emit FeeReceiverUpdated(oldReceiver, newFeeReceiver);
    }

    function withdrawProtocolFees(uint256 amount) external nonReentrant {
        require(msg.sender == feeReceiver || msg.sender == owner, "Not authorized");
        require(amount > 0 && amount <= protocolFees, "Invalid amount");

        protocolFees -= amount;
        _safeTransfer(address(NUSD), feeReceiver, amount);

        emit ProtocolFeesWithdrawn(feeReceiver, amount);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero owner");
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "Not pending owner");
        address oldOwner = owner;
        owner = msg.sender;
        pendingOwner = address(0);
        emit OwnershipTransferred(oldOwner, msg.sender);
    }

    function _registerLitVMTestnetFeeds() internal {
        _setDefaultAsset("BTC/USD", 0x7d0445782E383223c7B4B660bb96b87213e9b605, true);
        _setDefaultAsset("ETH/USD", 0xc760B46beF9eD3F9A3d2b825164324D6703F0185, true);
        _setDefaultAsset("LTC/USD", 0x45dDa5d881BD2C917976CCfde74fFd6f6412da29, true);
        _setDefaultAsset("USDC/USD", 0x4f91a950ed73c8B6F28dFE460f9444ed8866894f, true);
        _setDefaultAsset("USDT/USD", 0xd7ff0A3DdE1FdC2137Ff4CaAde5396f009739645, true);
        _setDefaultAsset("XAU/USD", 0x519A391D8999F0A18E1E9A5649FEA3D942A1bDdF, true);
        _setDefaultAsset("XAG/USD", 0xfb49F5C1eFF83Cc392357Cb979a9432C90eE0eb7, true);
        _setDefaultAsset("WTI/USD", 0x9cee709Fc9Da87d958a468859b8C02d591b7245A, true);
        _setDefaultAsset("XBR/USD", 0x41bb23dD937C5733BF8c0826b9d99d89790c0cAF, true);
    }

    function _setDefaultAsset(string memory symbol, address feed, bool enabled) internal {
        AssetInput memory input;
        input.symbol = symbol;
        input.feed = feed;
        input.heartbeat = DEFAULT_HEARTBEAT;
        input.betWindow = DEFAULT_BET_WINDOW;
        input.staleCancelDelay = DEFAULT_STALE_CANCEL_DELAY;
        input.minBet = DEFAULT_MIN_BET;
        input.maxBet = 0;
        input.enabled = enabled;
        _setAsset(input);
    }

    function _setAsset(AssetInput memory input) internal {
        require(bytes(input.symbol).length != 0, "Empty symbol");
        require(input.feed != address(0), "Zero feed");
        require(input.heartbeat > 0, "Bad heartbeat");
        require(input.betWindow > 0 && input.betWindow < input.heartbeat, "Bad bet window");
        require(input.staleCancelDelay >= 5 minutes, "Bad stale delay");
        require(input.maxBet == 0 || input.maxBet >= input.minBet, "Bad max bet");

        bytes32 assetId = assetIdOf(input.symbol);
        AssetConfig storage asset = assets[assetId];
        if (!asset.exists) {
            asset.exists = true;
            _assetIds.push(assetId);
        }

        asset.symbol = input.symbol;
        asset.feed = input.feed;
        asset.heartbeat = input.heartbeat;
        asset.betWindow = input.betWindow;
        asset.staleCancelDelay = input.staleCancelDelay;
        asset.minBet = input.minBet;
        asset.maxBet = input.maxBet;
        asset.enabled = input.enabled;

        emit AssetUpdated(assetId, input.symbol, input.feed, input.enabled);
    }

    function _startRoundFromOracle(
        bytes32 assetId,
        AssetConfig storage asset,
        uint80 oracleRoundId,
        uint256 price,
        uint256 updatedAt
    ) internal returns (uint256 roundId) {
        require(updatedAt <= block.timestamp, "Oracle timestamp ahead");

        uint256 latestRoundId = latestRoundOfAsset[assetId];
        if (latestRoundId != 0) {
            Round storage activeRound = _rounds[latestRoundId];
            if (!activeRound.settled && !activeRound.cancelled) {
                require(block.timestamp <= activeRound.betDeadline, "Prediction window closed");
                return latestRoundId;
            }
        }

        unchecked {
            ++roundCount;
        }
        roundId = roundCount;

        uint256 startTime = block.timestamp;
        uint256 betDeadline = startTime + asset.betWindow;
        uint256 closeTime = startTime + asset.heartbeat;
        Round storage round = _rounds[roundId];
        round.assetId = assetId;
        round.symbol = asset.symbol;
        round.feed = asset.feed;
        round.startOracleRoundId = oracleRoundId;
        round.startPrice = price;
        round.startTime = startTime;
        round.betDeadline = betDeadline;
        round.closeTime = closeTime;
        round.staleCancelTime = closeTime + asset.staleCancelDelay;
        round.minBet = asset.minBet;
        round.maxBet = asset.maxBet;
        round.feeBps = feeBps;
        round.outcome = Outcome.Pending;

        if (roundOfOracleRound[assetId][asset.feed][oracleRoundId] == 0) {
            roundOfOracleRound[assetId][asset.feed][oracleRoundId] = roundId;
        }
        latestRoundOfAsset[assetId] = roundId;

        emit RoundStarted(
            roundId,
            assetId,
            asset.symbol,
            oracleRoundId,
            price,
            startTime,
            betDeadline,
            closeTime
        );
    }

    function _claimable(Round storage round, Position storage position) internal view returns (uint256) {
        uint256 totalStake = position.upAmount + position.downAmount;
        if (totalStake == 0) return 0;

        if (round.cancelled || round.outcome == Outcome.Draw) {
            return totalStake;
        }

        if (round.outcome == Outcome.Up) {
            if (position.upAmount == 0) return 0;
            uint256 losingPoolAfterFee = round.downPool - round.feeAmount;
            return position.upAmount + ((position.upAmount * losingPoolAfterFee) / round.upPool);
        }

        if (round.outcome == Outcome.Down) {
            if (position.downAmount == 0) return 0;
            uint256 losingPoolAfterFee = round.upPool - round.feeAmount;
            return position.downAmount + ((position.downAmount * losingPoolAfterFee) / round.downPool);
        }

        return 0;
    }

    function _enabledAsset(bytes32 assetId) internal view returns (AssetConfig storage asset) {
        asset = assets[assetId];
        require(asset.exists && asset.enabled, "Asset disabled");
    }

    function _existingRound(uint256 roundId) internal view returns (Round storage round) {
        round = _rounds[roundId];
        require(round.startTime != 0, "Round not found");
    }

    function _previewSettlement(Round storage round)
        internal
        view
        returns (uint80 oracleRoundId, uint256 price, uint256 updatedAt)
    {
        require(!round.settled && !round.cancelled, "Round closed");
        require(block.timestamp >= round.closeTime, "Round not closed");

        (oracleRoundId, price, updatedAt) = _readLatest(round.feed);
        updatedAt;
    }

    function _readLatest(address feed)
        internal
        view
        returns (uint80 oracleRoundId, uint256 price, uint256 updatedAt)
    {
        bool ok;
        (ok, oracleRoundId, price, updatedAt) = _tryReadLatest(feed);
        require(ok, "Bad oracle");
    }

    function _tryReadLatest(address feed)
        internal
        view
        returns (bool ok, uint80 oracleRoundId, uint256 price, uint256 updatedAt)
    {
        (bool success, bytes memory result) =
            feed.staticcall(abi.encodeWithSelector(IDIAAggregatorV3.latestRoundData.selector));
        if (!success || result.length < 160) return (false, 0, 0, 0);

        (uint80 roundId, int256 answer, , uint256 time, uint80 answeredInRound) =
            abi.decode(result, (uint80, int256, uint256, uint256, uint80));

        if (answer <= 0) return (false, 0, 0, 0);
        if (time == 0) return (false, 0, 0, 0);
        if (answeredInRound != 0 && answeredInRound < roundId) return (false, 0, 0, 0);

        return (true, roundId, uint256(answer), time);
    }
    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(IERC20Minimal.transfer.selector, to, amount));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "Transfer failed");
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool ok, bytes memory data) =
            token.call(abi.encodeWithSelector(IERC20Minimal.transferFrom.selector, from, to, amount));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "TransferFrom failed");
    }
}
