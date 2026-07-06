// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Faucet {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title 0xPrediction NUSD Faucet
/// @notice Fund this contract with NUSD, then each wallet can claim 100 NUSD every 24 hours.
contract ZeroxPredictionNUSDFaucet {
    IERC20Faucet public immutable NUSD;

    address public owner;
    address public pendingOwner;

    uint256 public claimAmount = 100 ether;
    uint256 public cooldown = 1 days;
    bool public paused;

    uint256 private _locked = 1;

    mapping(address => uint256) public lastClaimAt;

    event Claimed(address indexed user, uint256 amount, uint256 nextClaimAt);
    event ClaimAmountUpdated(uint256 oldAmount, uint256 newAmount);
    event CooldownUpdated(uint256 oldCooldown, uint256 newCooldown);
    event Paused(bool paused);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event TokenRescued(address indexed token, address indexed to, uint256 amount);

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

    constructor(address nusd) {
        require(nusd != address(0), "Zero NUSD");
        NUSD = IERC20Faucet(nusd);
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function faucetBalance() external view returns (uint256) {
        return NUSD.balanceOf(address(this));
    }

    function nextClaimAt(address user) public view returns (uint256) {
        uint256 last = lastClaimAt[user];
        return last == 0 ? 0 : last + cooldown;
    }

    function canClaim(address user) public view returns (bool) {
        return !paused && block.timestamp >= nextClaimAt(user);
    }

    function timeUntilClaim(address user) external view returns (uint256) {
        uint256 next = nextClaimAt(user);
        return block.timestamp >= next ? 0 : next - block.timestamp;
    }

    function claim() external nonReentrant {
        require(!paused, "Paused");

        uint256 next = nextClaimAt(msg.sender);
        require(block.timestamp >= next, "Claim cooldown");
        require(NUSD.balanceOf(address(this)) >= claimAmount, "Faucet empty");

        lastClaimAt[msg.sender] = block.timestamp;
        require(NUSD.transfer(msg.sender, claimAmount), "Transfer failed");

        emit Claimed(msg.sender, claimAmount, block.timestamp + cooldown);
    }

    function setClaimAmount(uint256 newAmount) external onlyOwner {
        require(newAmount > 0, "amount=0");
        uint256 oldAmount = claimAmount;
        claimAmount = newAmount;
        emit ClaimAmountUpdated(oldAmount, newAmount);
    }

    function setCooldown(uint256 newCooldown) external onlyOwner {
        require(newCooldown >= 1 hours, "Cooldown too low");
        uint256 oldCooldown = cooldown;
        cooldown = newCooldown;
        emit CooldownUpdated(oldCooldown, newCooldown);
    }

    function setPaused(bool value) external onlyOwner {
        paused = value;
        emit Paused(value);
    }

    function rescueToken(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        require(token != address(0) && to != address(0), "Zero address");
        require(IERC20Faucet(token).transfer(to, amount), "Transfer failed");
        emit TokenRescued(token, to, amount);
    }

    function startOwnershipTransfer(address newOwner) external onlyOwner {
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
}
