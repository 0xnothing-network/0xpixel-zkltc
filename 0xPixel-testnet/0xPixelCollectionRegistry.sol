// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IZeroxPixelOwnership {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/// @title 0xPixel Collection Registry
/// @notice Lets 0xPixel owners group tokens into user-curated collections without
///         transferring or locking the NFTs.
contract ZeroxPixelCollectionRegistry {
    uint256 public constant MAX_NAME_LENGTH = 80;
    uint256 public constant MAX_METADATA_URI_LENGTH = 2048;
    uint256 public constant MAX_TOKENS_PER_TX = 100;

    IZeroxPixelOwnership public immutable pixelCollection;
    uint256 public collectionCount;

    struct Collection {
        address owner;
        string name;
        string metadataURI;
        uint64 createdAt;
        uint64 updatedAt;
        uint256[] tokenIds;
    }

    mapping(uint256 => Collection) private _collections;
    mapping(uint256 => uint256) public collectionOfToken;
    mapping(uint256 => uint256) private _tokenIndexPlusOne;

    uint256[] private _collectionIds;
    mapping(address => uint256[]) private _ownerCollectionIds;

    event CollectionCreated(uint256 indexed collectionId, address indexed owner, string name, string metadataURI);
    event CollectionMetadataUpdated(uint256 indexed collectionId, string name, string metadataURI);
    event TokenAdded(uint256 indexed collectionId, uint256 indexed tokenId, address indexed addedBy);
    event TokenRemoved(uint256 indexed collectionId, uint256 indexed tokenId, address indexed removedBy);

    modifier collectionExists(uint256 collectionId) {
        require(_collections[collectionId].owner != address(0), "Collection not found");
        _;
    }

    modifier onlyCollectionOwner(uint256 collectionId) {
        require(_collections[collectionId].owner == msg.sender, "Not collection owner");
        _;
    }

    constructor(address pixelCollectionAddress) {
        require(pixelCollectionAddress != address(0) && pixelCollectionAddress.code.length > 0, "Invalid 0xPixel");
        pixelCollection = IZeroxPixelOwnership(pixelCollectionAddress);
    }

    /// @notice Creates a collection from 0xPixel tokens currently owned by the caller.
    function createCollection(string calldata name, string calldata metadataURI, uint256[] calldata tokenIds)
        external
        returns (uint256 collectionId)
    {
        _validateMetadata(name, metadataURI);
        _validateTokenBatch(tokenIds);

        collectionId = ++collectionCount;

        Collection storage collection = _collections[collectionId];
        collection.owner = msg.sender;
        collection.name = name;
        collection.metadataURI = metadataURI;
        collection.createdAt = uint64(block.timestamp);
        collection.updatedAt = uint64(block.timestamp);

        _collectionIds.push(collectionId);
        _ownerCollectionIds[msg.sender].push(collectionId);

        emit CollectionCreated(collectionId, msg.sender, name, metadataURI);

        for (uint256 i = 0; i < tokenIds.length;) {
            _addToken(collectionId, tokenIds[i], msg.sender);
            unchecked {
                ++i;
            }
        }
    }

    /// @notice Adds caller-owned 0xPixel tokens to a collection owned by the caller.
    function addTokens(uint256 collectionId, uint256[] calldata tokenIds)
        external
        collectionExists(collectionId)
        onlyCollectionOwner(collectionId)
    {
        _validateTokenBatch(tokenIds);

        for (uint256 i = 0; i < tokenIds.length;) {
            _addToken(collectionId, tokenIds[i], msg.sender);
            unchecked {
                ++i;
            }
        }

        _collections[collectionId].updatedAt = uint64(block.timestamp);
    }

    /// @notice Removes tokens from a caller-owned collection.
    /// @dev The caller does not need to still own the tokens in order to curate their collection.
    function removeTokens(uint256 collectionId, uint256[] calldata tokenIds)
        external
        collectionExists(collectionId)
        onlyCollectionOwner(collectionId)
    {
        _validateTokenBatch(tokenIds);

        for (uint256 i = 0; i < tokenIds.length;) {
            _removeToken(collectionId, tokenIds[i], msg.sender);
            unchecked {
                ++i;
            }
        }

        _collections[collectionId].updatedAt = uint64(block.timestamp);
    }

    /// @notice Lets the current NFT owner remove their token from any registry collection.
    function detachToken(uint256 tokenId) external {
        require(tokenId != 0, "Invalid token");

        uint256 collectionId = collectionOfToken[tokenId];
        require(collectionId != 0, "Token not in collection");
        require(pixelCollection.ownerOf(tokenId) == msg.sender, "Not token owner");

        _removeToken(collectionId, tokenId, msg.sender);
        _collections[collectionId].updatedAt = uint64(block.timestamp);
    }

    function updateCollectionMetadata(uint256 collectionId, string calldata name, string calldata metadataURI)
        external
        collectionExists(collectionId)
        onlyCollectionOwner(collectionId)
    {
        _validateMetadata(name, metadataURI);

        Collection storage collection = _collections[collectionId];
        collection.name = name;
        collection.metadataURI = metadataURI;
        collection.updatedAt = uint64(block.timestamp);

        emit CollectionMetadataUpdated(collectionId, name, metadataURI);
    }

    function getCollection(uint256 collectionId)
        external
        view
        collectionExists(collectionId)
        returns (
            address owner,
            string memory name,
            string memory metadataURI,
            uint64 createdAt,
            uint64 updatedAt,
            uint256 tokenCount
        )
    {
        Collection storage collection = _collections[collectionId];
        return (
            collection.owner,
            collection.name,
            collection.metadataURI,
            collection.createdAt,
            collection.updatedAt,
            collection.tokenIds.length
        );
    }

    function collectionIdAt(uint256 index) external view returns (uint256) {
        require(index < _collectionIds.length, "Index out of bounds");
        return _collectionIds[index];
    }

    function collectionTokenCount(uint256 collectionId) external view collectionExists(collectionId) returns (uint256) {
        return _collections[collectionId].tokenIds.length;
    }

    function collectionTokenByIndex(uint256 collectionId, uint256 index)
        external
        view
        collectionExists(collectionId)
        returns (uint256)
    {
        uint256[] storage tokenIds = _collections[collectionId].tokenIds;
        require(index < tokenIds.length, "Index out of bounds");
        return tokenIds[index];
    }

    function getCollectionTokenIds(uint256 collectionId, uint256 offset, uint256 limit)
        external
        view
        collectionExists(collectionId)
        returns (uint256[] memory)
    {
        return _slice(_collections[collectionId].tokenIds, offset, limit);
    }

    function ownerCollectionCount(address owner) external view returns (uint256) {
        return _ownerCollectionIds[owner].length;
    }

    function ownerCollectionIdAt(address owner, uint256 index) external view returns (uint256) {
        uint256[] storage collectionIds = _ownerCollectionIds[owner];
        require(index < collectionIds.length, "Index out of bounds");
        return collectionIds[index];
    }

    function getOwnerCollectionIds(address owner, uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory)
    {
        return _slice(_ownerCollectionIds[owner], offset, limit);
    }

    function _addToken(uint256 collectionId, uint256 tokenId, address addedBy) internal {
        require(tokenId != 0, "Invalid token");
        require(collectionOfToken[tokenId] == 0, "Token already assigned");
        require(pixelCollection.ownerOf(tokenId) == addedBy, "Not token owner");

        uint256[] storage tokenIds = _collections[collectionId].tokenIds;
        tokenIds.push(tokenId);
        collectionOfToken[tokenId] = collectionId;
        _tokenIndexPlusOne[tokenId] = tokenIds.length;

        emit TokenAdded(collectionId, tokenId, addedBy);
    }

    function _removeToken(uint256 collectionId, uint256 tokenId, address removedBy) internal {
        require(collectionOfToken[tokenId] == collectionId, "Token not in collection");

        uint256[] storage tokenIds = _collections[collectionId].tokenIds;
        uint256 index = _tokenIndexPlusOne[tokenId] - 1;
        uint256 lastIndex = tokenIds.length - 1;

        if (index != lastIndex) {
            uint256 lastTokenId = tokenIds[lastIndex];
            tokenIds[index] = lastTokenId;
            _tokenIndexPlusOne[lastTokenId] = index + 1;
        }

        tokenIds.pop();
        delete collectionOfToken[tokenId];
        delete _tokenIndexPlusOne[tokenId];

        emit TokenRemoved(collectionId, tokenId, removedBy);
    }

    function _validateMetadata(string calldata name, string calldata metadataURI) internal pure {
        uint256 nameLength = bytes(name).length;
        require(nameLength != 0, "Empty name");
        require(nameLength <= MAX_NAME_LENGTH, "Name too long");
        require(bytes(metadataURI).length <= MAX_METADATA_URI_LENGTH, "Metadata URI too long");
    }

    function _validateTokenBatch(uint256[] calldata tokenIds) internal pure {
        require(tokenIds.length != 0, "No tokens");
        require(tokenIds.length <= MAX_TOKENS_PER_TX, "Too many tokens");
    }

    function _slice(uint256[] storage values, uint256 offset, uint256 limit)
        internal
        view
        returns (uint256[] memory result)
    {
        require(offset <= values.length, "Offset out of bounds");

        uint256 remaining = values.length - offset;
        uint256 length = limit < remaining ? limit : remaining;
        result = new uint256[](length);

        for (uint256 i = 0; i < length;) {
            result[i] = values[offset + i];
            unchecked {
                ++i;
            }
        }
    }
}
