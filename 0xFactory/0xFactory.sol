// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";

contract CustomToken is ERC20, Ownable {
    string private _tokenName;
    string private _tokenSymbol;

    constructor() ERC20("", "") Ownable(msg.sender) {}

    function initialize(
        string memory _name,
        string memory _symbol,
        uint256 totalSupply,
        address devWallet
    ) external {
        require(totalSupply > 0, "Invalid total supply");
        _tokenName = _name;
        _tokenSymbol = _symbol;
        _mint(devWallet, totalSupply * 10 ** decimals());
    }

    function name() public view override returns (string memory) {
        return _tokenName;
    }

    function symbol() public view override returns (string memory) {
        return _tokenSymbol;
    }

    function renounceOwnership() public override onlyOwner {
        super.renounceOwnership();
    }
}

contract TokenFactory is Ownable {
    using Clones for address;

    event TokenCreated(
        address indexed tokenAddress,
        address indexed creator,
        string name,
        string symbol,
        uint256 totalSupply,
        address devWallet
    );

    address public immutable tokenImplementation;

    address[] public allTokens;
    mapping(address => address[]) public tokensByCreator;

    constructor() Ownable(msg.sender) {
        tokenImplementation = address(new CustomToken());
    }

    function createToken(
        string memory name,
        string memory symbol,
        uint256 totalSupply,
        address devWallet
    ) external returns (address tokenAddress) {
        require(bytes(name).length > 0, "Name is required");
        require(bytes(symbol).length > 0, "Symbol is required");
        require(totalSupply > 0, "Total supply must be greater than 0");
        require(devWallet != address(0), "Invalid dev wallet");

        tokenAddress = tokenImplementation.clone();

        CustomToken(tokenAddress).initialize(name, symbol, totalSupply, devWallet);

        allTokens.push(tokenAddress);
        tokensByCreator[msg.sender].push(tokenAddress);

        emit TokenCreated(
            tokenAddress,
            msg.sender,
            name,
            symbol,
            totalSupply,
            devWallet
        );

        return tokenAddress;
    }

    function getTokensByCreator(address creator) external view returns (address[] memory) {
        return tokensByCreator[creator];
    }

    function getAllTokens() external view returns (address[] memory) {
        return allTokens;
    }

    function totalTokensCreated() external view returns (uint256) {
        return allTokens.length;
    }
}