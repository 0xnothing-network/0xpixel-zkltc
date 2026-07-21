// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../0xPixelCollectionRegistry.sol";

contract MockZeroxPixelOwnership {
    mapping(uint256 => address) private _owners;

    function mint(address owner, uint256 tokenId) external {
        require(owner != address(0) && _owners[tokenId] == address(0), "Invalid mint");
        _owners[tokenId] = owner;
    }

    function transfer(uint256 tokenId, address newOwner) external {
        require(_owners[tokenId] != address(0) && newOwner != address(0), "Invalid transfer");
        _owners[tokenId] = newOwner;
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        address owner = _owners[tokenId];
        require(owner != address(0), "Token does not exist");
        return owner;
    }
}

contract RegistryActor {
    function createCollection(
        ZeroxPixelCollectionRegistry registry,
        string calldata name,
        string calldata metadataURI,
        uint256[] calldata tokenIds
    ) external returns (uint256) {
        return registry.createCollection(name, metadataURI, tokenIds);
    }

    function addTokens(ZeroxPixelCollectionRegistry registry, uint256 collectionId, uint256[] calldata tokenIds)
        external
    {
        registry.addTokens(collectionId, tokenIds);
    }

    function removeTokens(ZeroxPixelCollectionRegistry registry, uint256 collectionId, uint256[] calldata tokenIds)
        external
    {
        registry.removeTokens(collectionId, tokenIds);
    }

    function detachToken(ZeroxPixelCollectionRegistry registry, uint256 tokenId) external {
        registry.detachToken(tokenId);
    }

    function updateCollectionMetadata(
        ZeroxPixelCollectionRegistry registry,
        uint256 collectionId,
        string calldata name,
        string calldata metadataURI
    ) external {
        registry.updateCollectionMetadata(collectionId, name, metadataURI);
    }
}

contract ZeroxPixelCollectionRegistryTest {
    MockZeroxPixelOwnership private pixel;
    ZeroxPixelCollectionRegistry private registry;
    RegistryActor private alice;
    RegistryActor private bob;

    function setUp() public {
        pixel = new MockZeroxPixelOwnership();
        registry = new ZeroxPixelCollectionRegistry(address(pixel));
        alice = new RegistryActor();
        bob = new RegistryActor();
    }

    function testCreateAndEnumerateCollection() public {
        pixel.mint(address(alice), 1);
        pixel.mint(address(alice), 2);

        uint256[] memory tokenIds = _pair(1, 2);
        uint256 collectionId = alice.createCollection(registry, "Night City", "ipfs://night", tokenIds);

        _assertEq(collectionId, 1, "Wrong collection id");
        _assertEq(registry.collectionCount(), 1, "Wrong collection count");
        _assertEq(registry.collectionIdAt(0), 1, "Collection not enumerable");
        _assertEq(registry.ownerCollectionCount(address(alice)), 1, "Owner collection missing");
        _assertEq(registry.collectionOfToken(1), 1, "Token 1 not assigned");
        _assertEq(registry.collectionOfToken(2), 1, "Token 2 not assigned");

        (address owner, string memory name, string memory metadataURI,,, uint256 tokenCount) =
            registry.getCollection(collectionId);

        _assertEq(owner, address(alice), "Wrong collection owner");
        _assertEq(name, "Night City", "Wrong name");
        _assertEq(metadataURI, "ipfs://night", "Wrong metadata URI");
        _assertEq(tokenCount, 2, "Wrong token count");

        uint256[] memory storedTokens = registry.getCollectionTokenIds(collectionId, 0, 10);
        _assertEq(storedTokens.length, 2, "Wrong token page length");
        _assertEq(storedTokens[0], 1, "Wrong first token");
        _assertEq(storedTokens[1], 2, "Wrong second token");
    }

    function testRejectsInvalidCreationTokens() public {
        pixel.mint(address(alice), 1);
        pixel.mint(address(bob), 2);

        uint256[] memory noTokens = new uint256[](0);
        _assertFalse(_callCreate(alice, "Empty", "", noTokens), "Empty token list accepted");

        uint256[] memory zeroToken = _single(0);
        _assertFalse(_callCreate(alice, "Zero", "", zeroToken), "Zero token accepted");

        uint256[] memory duplicateTokens = _pair(1, 1);
        _assertFalse(_callCreate(alice, "Duplicate", "", duplicateTokens), "Duplicate token accepted");

        uint256[] memory unownedToken = _single(2);
        _assertFalse(_callCreate(alice, "Unowned", "", unownedToken), "Unowned token accepted");

        uint256[] memory validToken = _single(1);
        _assertFalse(_callCreate(alice, "", "", validToken), "Empty name accepted");

        _assertEq(registry.collectionCount(), 0, "Failed creation changed state");
    }

    function testTokenCannotBelongToMultipleCollections() public {
        pixel.mint(address(alice), 1);
        pixel.mint(address(alice), 2);

        alice.createCollection(registry, "First", "", _single(1));
        uint256 secondId = alice.createCollection(registry, "Second", "", _single(2));

        (bool ok,) = address(alice).call(abi.encodeCall(RegistryActor.addTokens, (registry, secondId, _single(1))));

        _assertFalse(ok, "Assigned token added twice");
        _assertEq(registry.collectionOfToken(1), 1, "Original assignment changed");
        _assertEq(registry.collectionTokenCount(secondId), 1, "Second collection changed");
    }

    function testCollectionOwnerCanManageTokensAndMetadata() public {
        pixel.mint(address(alice), 1);
        pixel.mint(address(alice), 2);

        uint256 collectionId = alice.createCollection(registry, "Original", "", _single(1));
        alice.addTokens(registry, collectionId, _single(2));
        alice.removeTokens(registry, collectionId, _single(1));
        alice.updateCollectionMetadata(registry, collectionId, "Updated", "ipfs://updated");

        _assertEq(registry.collectionOfToken(1), 0, "Removed token still assigned");
        _assertEq(registry.collectionOfToken(2), collectionId, "Added token missing");

        (, string memory name, string memory metadataURI,,, uint256 tokenCount) = registry.getCollection(collectionId);
        _assertEq(name, "Updated", "Name not updated");
        _assertEq(metadataURI, "ipfs://updated", "URI not updated");
        _assertEq(tokenCount, 1, "Wrong token count after remove");

        (bool ok,) = address(bob).call(abi.encodeCall(RegistryActor.removeTokens, (registry, collectionId, _single(2))));
        _assertFalse(ok, "Non-owner removed a token");
    }

    function testCurrentTokenOwnerCanDetachAfterTransfer() public {
        pixel.mint(address(alice), 1);
        uint256 collectionId = alice.createCollection(registry, "Transferred", "", _single(1));

        pixel.transfer(1, address(bob));

        (bool oldOwnerOk,) = address(alice).call(abi.encodeCall(RegistryActor.detachToken, (registry, 1)));
        _assertFalse(oldOwnerOk, "Previous token owner detached token");

        bob.detachToken(registry, 1);
        _assertEq(registry.collectionOfToken(1), 0, "Token still assigned");
        _assertEq(registry.collectionTokenCount(collectionId), 0, "Collection not updated");
    }

    function _callCreate(RegistryActor actor, string memory name, string memory metadataURI, uint256[] memory tokenIds)
        private
        returns (bool ok)
    {
        (ok,) = address(actor)
            .call(abi.encodeCall(RegistryActor.createCollection, (registry, name, metadataURI, tokenIds)));
    }

    function _single(uint256 value) private pure returns (uint256[] memory values) {
        values = new uint256[](1);
        values[0] = value;
    }

    function _pair(uint256 first, uint256 second) private pure returns (uint256[] memory values) {
        values = new uint256[](2);
        values[0] = first;
        values[1] = second;
    }

    function _assertFalse(bool value, string memory message) private pure {
        require(!value, message);
    }

    function _assertEq(uint256 actual, uint256 expected, string memory message) private pure {
        require(actual == expected, message);
    }

    function _assertEq(address actual, address expected, string memory message) private pure {
        require(actual == expected, message);
    }

    function _assertEq(string memory actual, string memory expected, string memory message) private pure {
        require(keccak256(bytes(actual)) == keccak256(bytes(expected)), message);
    }
}
