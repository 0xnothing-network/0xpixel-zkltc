// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

/* ============================================================================
 *  0xPixel — on-chain pixel-art NFT marketplace
 *  ----------------------------------------------------------
 *  Deployed target: LitVM (Arbitrum Orbit, EVM = Shanghai, chain id 4441).
 *  No code changes are required for LitVM specifically — the contract is plain
 *  Solidity that compiles to standard EVM bytecode. We avoid `blockhash` for
 *  randomness (LitVM docs warn that `blockhash` is not cryptographically
 *  secure) and we use `block.timestamp` only for human-readable mint dates,
 *  which is acceptable per LitVM's EVM-differences page.
 * ========================================================================== */

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

contract ZeroxPixel is ERC721, IERC2981, ReentrancyGuard {
    /* ---------------------------------------------------------------------
     *  Storage
     * ------------------------------------------------------------------- */

    uint256 private _tokenIds;
    address payable public immutable devWallet;

    struct PixelArt {
        string name;
        string description;
        uint256 gridSize;
        string pixelData;
        uint256 price;
        address creator;
        uint256 mintedAt;
        bytes32 artworkHash;
        uint256 score;
    }

    mapping(uint256 => PixelArt) public tokenData;
    mapping(address => uint256[]) public userTokens;
    mapping(bytes32 => uint256) public artworkRegistry;
    mapping(uint256 => bool) public isTokenListed;
    uint256[] public listedTokens;
    mapping(uint256 => uint256) public listedIndex;
    mapping(uint256 => uint256) public userTokenIndex;
    mapping(address => uint256) public pendingWithdrawals;

    /* ---------------------------------------------------------------------
     *  Events
     * ------------------------------------------------------------------- */

    event Minted(address indexed creator, uint256 indexed tokenId, string name);
    event Listed(uint256 indexed tokenId, uint256 price);
    event Delisted(uint256 indexed tokenId);
    event Sold(uint256 indexed tokenId, address indexed buyer, address indexed seller, uint256 price);
    event Withdrawn(address indexed user, uint256 amount);

    /* ---------------------------------------------------------------------
     *  Constructor
     * ------------------------------------------------------------------- */

    constructor(address payable _devWallet) ERC721("0xPixel", "0xP") {
        require(_devWallet != address(0), "Zero dev wallet");
        devWallet = _devWallet;
    }

    receive() external payable {}

    /* ---------------------------------------------------------------------
     *  ERC-165 / ERC-2981
     * ------------------------------------------------------------------- */

    function supportsInterface(bytes4 id) public view override(ERC721, IERC165) returns (bool) {
        return id == type(IERC2981).interfaceId || super.supportsInterface(id);
    }

    function royaltyInfo(uint256 tokenId, uint256 salePrice) external view returns (address, uint256) {
        require(_ownerOf(tokenId) != address(0), "Token not exist");
        return (tokenData[tokenId].creator, (salePrice * 25) / 1000);
    }

    /* ---------------------------------------------------------------------
     *  Withdrawals
     * ------------------------------------------------------------------- */

    function withdrawPending() external nonReentrant {
        uint256 amt = pendingWithdrawals[msg.sender];
        require(amt != 0, "No pending");
        delete pendingWithdrawals[msg.sender];
        _safeSend(payable(msg.sender), amt);
        emit Withdrawn(msg.sender, amt);
    }

    /* ---------------------------------------------------------------------
     *  Transfer hook — keeps `userTokens` / `listedTokens` in sync and
     *  delists a token automatically when it is moved.
     * ------------------------------------------------------------------- */

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0)) {
            uint256 idx = userTokenIndex[tokenId];
            uint256[] storage fromTokens = userTokens[from];
            uint256 last = fromTokens[fromTokens.length - 1];
            fromTokens[idx] = last;
            userTokenIndex[last] = idx;
            fromTokens.pop();
            delete userTokenIndex[tokenId];
        }
        if (to != address(0)) {
            userTokens[to].push(tokenId);
            userTokenIndex[tokenId] = userTokens[to].length - 1;
        }
        if (from != address(0) && isTokenListed[tokenId]) {
            delete tokenData[tokenId].price;
            delete isTokenListed[tokenId];
            _rmListed(tokenId);
        }
        return super._update(to, tokenId, auth);
    }

    /* ---------------------------------------------------------------------
     *  Minting
     * ------------------------------------------------------------------- */

    function mint(string calldata name, string calldata desc, uint256 grid, string calldata px)
        external
        nonReentrant
        returns (uint256)
    {
        require(bytes(name).length != 0 && bytes(name).length <= 32, "Invalid name");
        require(bytes(desc).length <= 256, "Desc too long");
        require(grid == 8 || grid == 16 || grid == 32 || grid == 64 || grid == 128, "Invalid grid");
        require(bytes(px).length != 0 && bytes(px).length <= 1_200_000, "Invalid px");

        bytes32 h = keccak256(abi.encodePacked(px, grid));
        require(artworkRegistry[h] == 0, "Artwork exists");

        _tokenIds++;
        uint256 id = _tokenIds;
        _safeMint(msg.sender, id);

        tokenData[id].name = name;
        tokenData[id].description = desc;
        tokenData[id].gridSize = grid;
        tokenData[id].pixelData = px;
        tokenData[id].creator = msg.sender;
        tokenData[id].mintedAt = block.timestamp;
        tokenData[id].artworkHash = h;

        artworkRegistry[h] = id;
        emit Minted(msg.sender, id, name);
        return id;
    }

    function checkOriginal(string calldata px, uint256 grid) external view returns (bool) {
        return artworkRegistry[keccak256(abi.encodePacked(px, grid))] == 0;
    }

    function getCreator(string calldata px, uint256 grid) external view returns (address) {
        bytes32 h = keccak256(abi.encodePacked(px, grid));
        uint256 id = artworkRegistry[h];
        return id == 0 ? address(0) : tokenData[id].creator;
    }

    /* ---------------------------------------------------------------------
     *  Marketplace
     * ------------------------------------------------------------------- */

    function listForSale(uint256 id, uint256 price) external nonReentrant {
        require(_ownerOf(id) == msg.sender, "Not owner");
        require(price != 0, "Zero price");
        require(!isTokenListed[id], "Already listed");
        require(price <= 1000 ether, "Price too high");

        tokenData[id].price = price;
        isTokenListed[id] = true;
        listedTokens.push(id);
        listedIndex[id] = listedTokens.length - 1;
        emit Listed(id, price);
    }

    function delist(uint256 id) external nonReentrant {
        require(_ownerOf(id) == msg.sender, "Not owner");
        require(isTokenListed[id], "Not listed");

        delete tokenData[id].price;
        delete isTokenListed[id];
        _rmListed(tokenId: id);
        emit Delisted(id);
    }

    function buyNFT(uint256 id) external payable nonReentrant {
        require(isTokenListed[id], "Not listed");
        require(msg.value >= tokenData[id].price, "Insufficient payment");
        require(msg.sender != _ownerOf(id), "Cannot buy own");

        address seller = _ownerOf(id);
        address origCreator = tokenData[id].creator;
        uint256 price = tokenData[id].price;

        uint256 devFee = (price * 25) / 1000;
        uint256 sellerAmt = price - devFee;

        delete tokenData[id].price;
        delete isTokenListed[id];
        _rmListed(id);
        unchecked { ++tokenData[id].score; }

        _transfer(seller, msg.sender, id);

        if (seller != origCreator) {
            uint256 royalty = (price * 25) / 1000;
            sellerAmt -= royalty;
            pendingWithdrawals[origCreator] += royalty;
        }

        pendingWithdrawals[devWallet] += devFee;
        pendingWithdrawals[seller] += sellerAmt;

        if (msg.value > price) {
            _safeSend(payable(msg.sender), msg.value - price);
        }
        emit Sold(id, msg.sender, seller, price);
    }

    function getScore(uint256 id) external view returns (uint256) {
        return tokenData[id].score;
    }

    /* ---------------------------------------------------------------------
     *  On-chain SVG / tokenURI
     * ------------------------------------------------------------------- */

    function tokenURI(uint256 id) public view override returns (string memory) {
        require(_ownerOf(id) != address(0), "Token not exist");
        PixelArt storage art = tokenData[id];

        string memory svg = _generateSVG(art.pixelData, art.gridSize);
        string memory svgBase64 = Base64.encode(bytes(svg));

        string memory scoreStr = Strings.toString(art.score);
        string memory gridStr = Strings.toString(art.gridSize);
        string memory creatorStr = Strings.toHexString(uint160(art.creator), 20);

        string memory json = string(
            abi.encodePacked(
                '{"name":"',
                art.name,
                '","description":"',
                art.description,
                '","image":"data:image/svg+xml;base64,',
                svgBase64,
                '","attributes":[',
                '{"trait_type":"Grid Size","value":"',
                gridStr,
                '"}',
                ',{"trait_type":"Creator","value":"',
                creatorStr,
                '"}',
                ',{"trait_type":"Score","display_type":"number","value":',
                scoreStr,
                "}",
                "]}"
            )
        );

        return string(abi.encodePacked("data:application/json;base64,", Base64.encode(bytes(json))));
    }

    /**
     * @notice Generate SVG from pixelData format: `[x,y]=#RRGGBB [x,y]=#RRGGBB ...`
     */
    function _generateSVG(string memory pixelData, uint256 gridSize) internal pure returns (string memory) {
        bytes memory data = bytes(pixelData);
        uint256 len = data.length;

        bytes memory svg = abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" width="',
            _toString(gridSize),
            '" height="',
            _toString(gridSize),
            '" viewBox="0 0 ',
            _toString(gridSize),
            " ",
            _toString(gridSize),
            '" shape-rendering="crispEdges">'
        );

        uint256 i = 0;

        while (i < len) {
            // Find '['
            while (i < len && data[i] != "[") {
                unchecked { i++; }
            }
            if (i >= len) break;
            unchecked { i++; } // skip '['

            // Parse X
            uint256 x = 0;
            while (i < len && data[i] != ",") {
                x = x * 10 + (uint8(data[i]) - 48);
                unchecked { i++; }
            }
            if (i >= len) break;
            unchecked { i++; } // skip ','

            // Parse Y
            uint256 y = 0;
            while (i < len && data[i] != "]") {
                y = y * 10 + (uint8(data[i]) - 48);
                unchecked { i++; }
            }
            if (i >= len) break;
            unchecked { i += 2; } // skip ']=#'

            if (i + 6 >= len) break;

            // Read color (#RRGGBB)
            bytes memory color = new bytes(7);
            for (uint256 j = 0; j < 7; j++) {
                color[j] = data[i + j];
            }
            unchecked { i += 7; }

            // Optional space separator
            if (i < len && data[i] == " ") {
                unchecked { i++; }
            }

            // Emit <rect>
            svg = abi.encodePacked(
                svg,
                '<rect x="',
                _toString(x),
                '" y="',
                _toString(y),
                '" width="1" height="1" fill="',
                string(color),
                '"/>'
            );
        }

        svg = abi.encodePacked(svg, "</svg>");
        return string(svg);
    }

    // Gas-optimised uint -> string
    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits--;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    function transferNFT(address to, uint256 id) external nonReentrant {
        require(to != address(0), "Zero address");
        require(msg.sender == _ownerOf(id), "Not owner");
        require(!isTokenListed[id], "Listed");
        _transfer(msg.sender, to, id);
    }

    /* ---------------------------------------------------------------------
     *  Internal helpers
     * ------------------------------------------------------------------- */

    function _safeSend(address payable to, uint256 amt) internal {
        (bool ok,) = to.call{value: amt}("");
        require(ok, "Send failed");
    }

    function _rmListed(uint256 tokenId) internal {
        uint256 len = listedTokens.length;
        if (len == 0) return;
        uint256 idx = listedIndex[tokenId];
        uint256 last = listedTokens[len - 1];
        if (idx != len - 1) {
            listedTokens[idx] = last;
            listedIndex[last] = idx;
        }
        listedTokens.pop();
        delete listedIndex[tokenId];
    }
}
