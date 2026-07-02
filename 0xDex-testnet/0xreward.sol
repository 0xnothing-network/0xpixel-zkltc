// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IRewardERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
}

contract RewardManager {
    address public immutable dex;
    address public immutable NUSD;

    uint256 public totalRewardPool;
    uint256 public totalNUSDLocked;
    uint256 public accRewardPerNUSD;
    uint256 private constant ACC_SCALE = 1e18;

    mapping(address => uint256) public userNUSDLocked;
    mapping(address => uint256) public userRewardDebt;
    mapping(address => uint256) public userAccruedReward;

    event RewardClaimed(address indexed user, uint256 amount);
    event RewardAdded(uint256 amount);
    event UserLockedUpdated(address indexed user, uint256 newLocked);
    event TotalLockedUpdated(uint256 newTotalLocked);

    modifier onlyDex() {
        require(msg.sender == dex, "Only ZeroDex");
        _;
    }

    constructor(address _dex, address _nusd) {
        require(_dex != address(0) && _nusd != address(0), "Zero address");
        dex = _dex;
        NUSD = _nusd;
    }

    function addReward(uint256 amount) external onlyDex {
        require(amount > 0, "amount=0");
        totalRewardPool += amount;
        emit RewardAdded(amount);
    }

    function updateUserLocked(address user, uint256 newLocked) external onlyDex {
        require(user != address(0), "Zero user");

        _pokeReward();
        _settleUser(user);

        uint256 oldLocked = userNUSDLocked[user];
        if (newLocked > oldLocked) {
            totalNUSDLocked += newLocked - oldLocked;
        } else if (oldLocked > newLocked) {
            totalNUSDLocked -= oldLocked - newLocked;
        }

        userNUSDLocked[user] = newLocked;
        userRewardDebt[user] = (newLocked * accRewardPerNUSD) / ACC_SCALE;

        emit UserLockedUpdated(user, newLocked);
        emit TotalLockedUpdated(totalNUSDLocked);
    }

    function pokeReward() public {
        _pokeReward();
    }

    function claimReward() external {
        _pokeReward();
        _settleUser(msg.sender);

        uint256 pending = userAccruedReward[msg.sender];
        require(pending > 0, "No reward");

        userAccruedReward[msg.sender] = 0;
        require(IRewardERC20(NUSD).transfer(msg.sender, pending), "Transfer failed");

        emit RewardClaimed(msg.sender, pending);
    }

    function getUserPendingReward(address user) external view returns (uint256) {
        uint256 locked = userNUSDLocked[user];
        uint256 acc = accRewardPerNUSD;

        if (totalRewardPool > 0 && totalNUSDLocked > 0) {
            uint256 rewardPerNUSD = (totalRewardPool * ACC_SCALE) / totalNUSDLocked;
            acc += rewardPerNUSD;
        }

        uint256 cumulative = (locked * acc) / ACC_SCALE;
        uint256 debt = userRewardDebt[user];
        uint256 pending = userAccruedReward[user];

        if (cumulative > debt) {
            pending += cumulative - debt;
        }

        return pending;
    }

    function _pokeReward() internal {
        if (totalRewardPool > 0 && totalNUSDLocked > 0) {
            uint256 rewardPerNUSD = (totalRewardPool * ACC_SCALE) / totalNUSDLocked;
            if (rewardPerNUSD > 0) {
                accRewardPerNUSD += rewardPerNUSD;
                totalRewardPool = 0;
            }
        }
    }

    function _settleUser(address user) internal {
        uint256 locked = userNUSDLocked[user];
        uint256 cumulative = (locked * accRewardPerNUSD) / ACC_SCALE;
        uint256 debt = userRewardDebt[user];

        if (cumulative > debt) {
            userAccruedReward[user] += cumulative - debt;
        }

        userRewardDebt[user] = cumulative;
    }
}
