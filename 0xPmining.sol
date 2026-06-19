// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract PMining is Ownable, ReentrancyGuard {

    IERC20 public immutable NToken;
    IERC721 public immutable NFTContract;
    address public devWallet;

    uint256 public constant FIRST_MACHINE_PRICE = 1 * 1e18;
    uint256 public constant NORMAL_MACHINE_PRICE = 1000 * 1e18;

    mapping(uint8 => uint256) public levelProduction;
    mapping(uint8 => uint256) public levelUpgradeCost;

    mapping(uint256 => address) public rigOwner;
    mapping(uint256 => uint8) public rigLevel;
    mapping(uint256 => bool) public isRigDeposited;
    mapping(uint256 => uint256) public lastRigClaimTime;

    mapping(address => uint256) public userRigCount;
    uint256 public totalRewardPool;

    mapping(address => uint256[]) private userMachines;

    event RigDeposited(uint256 indexed nftId);
    event RigBought(address indexed buyer, uint256 indexed nftId, uint256 pricePaid);
    event RigUpgraded(uint256 indexed nftId, uint8 newLevel);
    event RigClaimed(address indexed user, uint256 indexed nftId, uint256 amount);
    event RewardPoolDeposited(uint256 amount);

    constructor(address _nToken, address _nftContract, address _devWallet) Ownable(msg.sender) {
        NToken = IERC20(_nToken);
        NFTContract = IERC721(_nftContract);
        devWallet = _devWallet;
        _initLevels();
    }

    function _initLevels() internal {
        levelProduction[1] = 24 * 1e18;
        levelProduction[2] = 100 * 1e18;
        levelProduction[3] = 300 * 1e18;

        levelUpgradeCost[2] = 500 * 1e18;
        levelUpgradeCost[3] = 9000 * 1e18;
    }

    function depositRig(uint256 nftId) external onlyOwner {
        require(NFTContract.ownerOf(nftId) == msg.sender, "Not owner of NFT");
        require(!isRigDeposited[nftId], "Already deposited");

        NFTContract.transferFrom(msg.sender, address(this), nftId);
        isRigDeposited[nftId] = true;
        rigLevel[nftId] = 1;

        emit RigDeposited(nftId);
    }

    function depositRewardPool(uint256 amount) external onlyOwner {
        require(amount > 0, "Amount must be > 0");
        NToken.transferFrom(msg.sender, address(this), amount);
        totalRewardPool += amount;
        emit RewardPoolDeposited(amount);
    }

    function buyRig(uint256 nftId) external nonReentrant {
        require(isRigDeposited[nftId], "Rig not available");
        require(rigOwner[nftId] == address(0), "Rig already sold");
        require(NFTContract.ownerOf(nftId) == address(this), "Rig not in contract");

        bool isFirst = (userRigCount[msg.sender] == 0);
        uint256 price = isFirst ? FIRST_MACHINE_PRICE : NORMAL_MACHINE_PRICE;

        if (price > 0) {
            require(NToken.balanceOf(msg.sender) >= price, "Not enough N");
            NToken.transferFrom(msg.sender, devWallet, price);
        }

        rigOwner[nftId] = msg.sender;
        userRigCount[msg.sender] += 1;
        userMachines[msg.sender].push(nftId);

        emit RigBought(msg.sender, nftId, price);
    }

    function upgradeRig(uint256 nftId) external nonReentrant {
        require(rigOwner[nftId] == msg.sender, "Not your rig");
        uint8 currentLevel = rigLevel[nftId];
        require(currentLevel < 3, "Max level reached");

        uint8 nextLevel = currentLevel + 1;
        uint256 cost = levelUpgradeCost[nextLevel];
        require(cost > 0, "Cannot upgrade to this level");

        require(NToken.balanceOf(msg.sender) >= cost, "Not enough N");
        NToken.transferFrom(msg.sender, devWallet, cost);

        rigLevel[nftId] = nextLevel;
        emit RigUpgraded(nftId, nextLevel);
    }

    function claimRig(uint256 nftId) external nonReentrant {
        require(rigOwner[nftId] == msg.sender, "Not your rig");
        require(isRigDeposited[nftId], "Rig not active");

        uint256 lastClaim = lastRigClaimTime[nftId];
        require(block.timestamp >= lastClaim + 1 days, "Can only claim once per 24h");

        uint8 level = rigLevel[nftId];
        uint256 reward = levelProduction[level];
        require(reward > 0, "No reward");
        require(totalRewardPool >= reward, "Not enough reward in pool");

        lastRigClaimTime[nftId] = block.timestamp;
        totalRewardPool -= reward;
        NToken.transfer(msg.sender, reward);

        emit RigClaimed(msg.sender, nftId, reward);
    }

    function claimAllRigs() external nonReentrant {
        uint256[] memory machines = userMachines[msg.sender];
        require(machines.length > 0, "No machines");

        uint256 totalClaimed = 0;

        for (uint256 i = 0; i < machines.length; i++) {
            uint256 nftId = machines[i];
            if (rigOwner[nftId] == msg.sender && isRigDeposited[nftId]) {
                uint256 lastClaim = lastRigClaimTime[nftId];
                if (block.timestamp >= lastClaim + 1 days) {
                    uint8 level = rigLevel[nftId];
                    uint256 reward = levelProduction[level];

                    if (reward > 0 && totalRewardPool >= reward) {
                        lastRigClaimTime[nftId] = block.timestamp;
                        totalRewardPool -= reward;
                        totalClaimed += reward;
                        emit RigClaimed(msg.sender, nftId, reward);
                    }
                }
            }
        }

        require(totalClaimed > 0, "No rewards to claim");
        NToken.transfer(msg.sender, totalClaimed);
    }

    function getUserMachines(address user) external view returns (uint256[] memory) {
        return userMachines[user];
    }

    function getRigInfo(uint256 nftId) external view returns (
        address owner,
        uint8 level,
        uint256 dailyProduction,
        uint256 nextClaimTime
    ) {
        return (
            rigOwner[nftId],
            rigLevel[nftId],
            levelProduction[rigLevel[nftId]],
            lastRigClaimTime[nftId] + 1 days
        );
    }

    function withdrawDevFees() external onlyOwner {
        uint256 balance = NToken.balanceOf(address(this));
        require(balance > 0, "No balance");
        NToken.transfer(devWallet, balance);
    }
}