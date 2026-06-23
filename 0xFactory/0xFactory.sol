// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";

/**
 * @title CustomToken
 * @dev Token implementation used as a template for cloning.
 * Supports setting name and symbol after deployment via initialize().
 */
contract CustomToken is ERC20, Ownable {
    string private _tokenName;
    string private _tokenSymbol;

    constructor() ERC20("", "") Ownable(msg.sender) {}

    /**
     * @dev Initializes the token with name, symbol and mints supply to devWallet.
     * Can only be called once after cloning.
     */
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

    /// @dev Override name() to return the stored token name
    function name() public view override returns (string memory) {
        return _tokenName;
    }

    /// @dev Override symbol() to return the stored token symbol
    function symbol() public view override returns (string memory) {
        return _tokenSymbol;
    }

    function renounceOwnership() public override onlyOwner {
        super.renounceOwnership();
    }
}

/**
 * @title TokenFactory
 * @dev A gas-efficient factory for creating custom ERC20 tokens using the Clone pattern.
 * Prevents duplicate token names and symbols.
 */
contract TokenFactory is Ownable {
    using Clones for address;

    /// @dev Emitted when a new token is successfully created
    event TokenCreated(
        address indexed tokenAddress,
        address indexed creator,
        string name,
        string symbol,
        uint256 totalSupply,
        address devWallet
    );

    /// @dev The implementation contract used as a template for cloning
    address public immutable tokenImplementation;

    /// @dev Array of all tokens created through this factory
    address[] public allTokens;

    /// @dev Mapping from creator address to their created tokens
    mapping(address => address[]) public tokensByCreator;

    /// @dev Track used token names and symbols (using hash for gas efficiency)
    mapping(bytes32 => bool) private _usedNames;
    mapping(bytes32 => bool) private _usedSymbols;

    constructor() Ownable(msg.sender) {
        tokenImplementation = address(new CustomToken());
    }

    /**
     * @dev Creates a new custom ERC20 token using the Clone pattern (very gas efficient).
     * @param name Name of the new token
     * @param symbol Symbol of the new token
     * @param totalSupply Total supply (without decimals)
     * @param devWallet Address that will receive the entire token supply
     */
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

        // Check for duplicate name and symbol
        bytes32 nameHash = keccak256(abi.encodePacked(name));
        bytes32 symbolHash = keccak256(abi.encodePacked(symbol));

        require(!_usedNames[nameHash], "Token name already exists");
        require(!_usedSymbols[symbolHash], "Token symbol already exists");

        // Mark name and symbol as used
        _usedNames[nameHash] = true;
        _usedSymbols[symbolHash] = true;

        // Clone the implementation contract (gas efficient)
        tokenAddress = tokenImplementation.clone();

        // Initialize the cloned token
        CustomToken(tokenAddress).initialize(name, symbol, totalSupply, devWallet);

        // Record the created token
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

    /// @dev Returns all tokens created by a specific creator
    function getTokensByCreator(address creator) external view returns (address[] memory) {
        return tokensByCreator[creator];
    }

    /// @dev Returns all tokens created through this factory
    function getAllTokens() external view returns (address[] memory) {
        return allTokens;
    }

    /// @dev Returns the total number of tokens created
    function totalTokensCreated() external view returns (uint256) {
        return allTokens.length;
    }
}