// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract ZeroxPixel is ERC721, ReentrancyGuard {
    uint256 private _tokenIds;
    address payable public immutable devWallet;

    uint256 public constant MAX_GRID = 64;

    struct PixelArt {
        string name;
        uint256 gridSize;
        string pixelData;
        address creator;
        uint256 mintedAt;
        bytes32 artworkHash;
    }

    mapping(uint256 => PixelArt) public tokenData;
    mapping(address => uint256[]) public userTokens;
    mapping(bytes32 => uint256) public artworkRegistry;
    mapping(uint256 => uint256) public userTokenIndex;

    event Minted(address indexed creator, uint256 indexed tokenId, string name);

    constructor(address payable _devWallet) ERC721("0xPixel", "0xP") {
        require(_devWallet != address(0), "Zero dev wallet");
        devWallet = _devWallet;
    }

    receive() external payable {}

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
        return super._update(to, tokenId, auth);
    }

    function mint(string calldata name, uint256 grid, string calldata px)
        external nonReentrant returns (uint256)
    {
        require(bytes(name).length != 0 && bytes(name).length <= 32, "Invalid name");
        require(grid == 8 || grid == 16 || grid == 32 || grid == 64, "Invalid grid (max 64)");
        require(bytes(px).length != 0 && bytes(px).length <= 100000, "Invalid px");

        bytes32 h = keccak256(abi.encodePacked(px, grid));
        require(artworkRegistry[h] == 0, "Artwork exists");

        _tokenIds++;
        uint256 id = _tokenIds;

        _safeMint(msg.sender, id);

        tokenData[id].name = name;
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

    function tokenURI(uint256 id) public view override returns (string memory) {
        require(_ownerOf(id) != address(0), "Token not exist");

        PixelArt storage art = tokenData[id];
        string memory svg = _generateSVG(art.pixelData, art.gridSize);
        string memory svgBase64 = Base64.encode(bytes(svg));
        string memory gridStr = Strings.toString(art.gridSize);
        string memory creatorStr = Strings.toHexString(uint160(art.creator), 20);

        string memory json = string(abi.encodePacked(
            '{"name":"', art.name,
            '","image":"data:image/svg+xml;base64,', svgBase64,
            '","attributes":[',
            '{"trait_type":"Grid Size","value":"', gridStr, '"}',
            ',{"trait_type":"Creator","value":"', creatorStr, '"}',
            ']}'
        ));

        return string(abi.encodePacked("data:application/json;base64,", Base64.encode(bytes(json))));
    }

    // ==================== SVG GENERATION ====================

    function _generateSVG(string memory pixelData, uint256 gridSize) internal pure returns (string memory) {
        bytes memory data = bytes(pixelData);
        uint256 len = data.length;

        bool isPacked = _isHexString(data);
        uint256 rectCount = _countRects(data, len, isPacked);

        if (rectCount == 0) {
            return _emptySVG(gridSize);
        }

        bytes[] memory parts = new bytes[](rectCount + 2);
        parts[0] = _svgHeader(gridSize);

        uint256 idx = 1;

        if (isPacked) {
            idx = _buildPackedRects(parts, idx, data, len);
        } else {
            idx = _buildTextRects(parts, idx, data, len);
        }

        parts[idx] = bytes("</svg>");
        return string(_join(parts, idx + 1));
    }

    function _emptySVG(uint256 gridSize) internal pure returns (string memory) {
        return string(abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" width="', _toString(gridSize),
            '" height="', _toString(gridSize),
            '" viewBox="0 0 ', _toString(gridSize), ' ', _toString(gridSize),
            '" shape-rendering="crispEdges"></svg>'
        ));
    }

    function _svgHeader(uint256 gridSize) internal pure returns (bytes memory) {
        return abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" width="', _toString(gridSize),
            '" height="', _toString(gridSize),
            '" viewBox="0 0 ', _toString(gridSize), ' ', _toString(gridSize),
            '" shape-rendering="crispEdges">'
        );
    }

    function _buildTextRects(bytes[] memory parts, uint256 startIdx, bytes memory data, uint256 len)
        internal pure returns (uint256)
    {
        uint256 i = 0;
        uint256 idx = startIdx;

        while (i < len) {
            while (i < len && uint8(data[i]) != 91) { unchecked { ++i; } }
            if (i >= len) break;
            unchecked { ++i; }

            uint256 x = 0;
            while (i < len && uint8(data[i]) != 44) {
                x = x * 10 + (uint8(data[i]) - 48);
                unchecked { ++i; }
            }
            if (i >= len) break;
            unchecked { ++i; }

            uint256 y = 0;
            while (i < len && uint8(data[i]) != 93) {
                y = y * 10 + (uint8(data[i]) - 48);
                unchecked { ++i; }
            }
            if (i >= len) break;
            unchecked { i += 2; }

            if (i + 7 > len) break;

            bytes memory color = new bytes(7);
            for (uint256 j = 0; j < 7; j++) {
                color[j] = data[i + j];
            }

            parts[idx++] = abi.encodePacked(
                '<rect x="', _toString(x),
                '" y="', _toString(y),
                '" width="1" height="1" fill="', string(color), '"/>'
            );

            unchecked { i += 7; }
            if (i < len && uint8(data[i]) == 32) { unchecked { ++i; } }
        }
        return idx;
    }

    function _buildPackedRects(bytes[] memory parts, uint256 startIdx, bytes memory data, uint256 len)
        internal pure returns (uint256)
    {
        uint256 start = (len >= 2 && uint8(data[0]) == 48 && uint8(data[1]) == 120) ? 2 : 0;
        uint256 i = start;
        uint256 idx = startIdx;

        while (i + 12 <= len) {
            uint256 x = _hexByte(data, i);
            uint256 y = _hexByte(data, i + 2);
            uint256 count = _hexByte(data, i + 4);
            uint256 r = _hexByte(data, i + 6);
            uint256 g = _hexByte(data, i + 8);
            uint256 b = _hexByte(data, i + 10);

            bytes memory color = new bytes(7);
            color[0] = '#';
            color[1] = _nibbleToHex(r >> 4);
            color[2] = _nibbleToHex(r & 0x0f);
            color[3] = _nibbleToHex(g >> 4);
            color[4] = _nibbleToHex(g & 0x0f);
            color[5] = _nibbleToHex(b >> 4);
            color[6] = _nibbleToHex(b & 0x0f);

            parts[idx++] = abi.encodePacked(
                '<rect x="', _toString(x),
                '" y="', _toString(y),
                '" width="', _toString(count),
                '" height="1" fill="', string(color), '"/>'
            );

            unchecked { i += 12; }
        }
        return idx;
    }

    function _isHexString(bytes memory data) internal pure returns (bool) {
        uint256 len = data.length;
        if (len == 0) return false;
        if (len >= 2 && uint8(data[0]) == 48 && uint8(data[1]) == 120) return true;

        unchecked {
            for (uint256 k = 0; k < len; k++) {
                uint8 c = uint8(data[k]);
                bool valid = (c >= 48 && c <= 57) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70);
                if (!valid) return false;
            }
        }
        return true;
    }

    function _countRects(bytes memory data, uint256 len, bool isPacked) internal pure returns (uint256) {
        if (isPacked) {
            uint256 start = (len >= 2 && uint8(data[0]) == 48 && uint8(data[1]) == 120) ? 2 : 0;
            return (len - start) / 12;
        }
        uint256 count = 0;
        unchecked {
            for (uint256 k = 0; k < len; k++) {
                if (uint8(data[k]) == 91) ++count;
            }
        }
        return count;
    }

    function _hexByte(bytes memory data, uint256 i) internal pure returns (uint256) {
        return (_hexToVal(uint8(data[i])) << 4) | _hexToVal(uint8(data[i + 1]));
    }

    function _hexToVal(uint8 c) internal pure returns (uint256) {
        if (c >= 48 && c <= 57) return c - 48;
        if (c >= 97 && c <= 102) return c - 87;
        if (c >= 65 && c <= 70) return c - 55;
        return 0;
    }

    function _nibbleToHex(uint256 n) internal pure returns (bytes1) {
        if (n < 10) return bytes1(uint8(48 + n));
        return bytes1(uint8(87 + n));
    }

    function _join(bytes[] memory parts, uint256 count) internal pure returns (bytes memory) {
        uint256 total = 0;
        unchecked {
            for (uint256 k = 0; k < count; k++) {
                total += parts[k].length;
            }
        }
        bytes memory result = new bytes(total);
        uint256 ptr = 0;
        for (uint256 k = 0; k < count; k++) {
            bytes memory p = parts[k];
            for (uint256 j = 0; j < p.length; j++) {
                result[ptr++] = p[j];
            }
        }
        return result;
    }

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        unchecked {
            while (temp != 0) { digits++; temp /= 10; }
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            unchecked { digits--; }
            buffer[digits] = bytes1(uint8(48 + value % 10));
            value /= 10;
        }
        return string(buffer);
    }

    function transferNFT(address to, uint256 id) external nonReentrant {
        require(to != address(0), "Zero address");
        require(msg.sender == _ownerOf(id), "Not owner");
        _transfer(msg.sender, to, id);
    }

    function _safeSend(address payable to, uint256 amt) internal {
        (bool ok, ) = to.call{value: amt}("");
        require(ok, "Send failed");
    }
}