// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/interfaces/IERC2981.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

interface IOwnable {
    function owner() external view returns (address);
}

contract ZeroxMarketplace is ReentrancyGuard, Ownable, Pausable {
    address payable public immutable devWallet;
    uint256 public constant PLATFORM_FEE_BPS = 140;

    struct Listing {
        address collection;
        uint256 tokenId;
        uint256 price;
        address seller;
        bool active;
    }

    struct Offer {
        address collection;
        uint256 tokenId;
        address offerer;
        uint256 price;
        bool active;
    }

    mapping(address => string) public collectionNames;
    mapping(uint256 => Listing) public listings;
    mapping(uint256 => Offer) public offers;

    uint256 private _listingIdCounter;
    uint256 private _offerIdCounter;

    mapping(address => mapping(uint256 => uint256)) public tokenToListingId;

    event Listed(uint256 indexed listingId, address indexed collection, uint256 tokenId, address seller, uint256 price);
    event ListingCancelled(uint256 indexed listingId);
    event OfferCreated(uint256 indexed offerId, address indexed collection, uint256 tokenId, address offerer, uint256 price);
    event OfferCancelled(uint256 indexed offerId);
    event OfferAccepted(uint256 indexed offerId, address buyer);
    event Bought(uint256 indexed listingId, address buyer, uint256 price);
    event CollectionNameUpdated(address indexed collection, string name);

    constructor(address payable _devWallet) Ownable(msg.sender) {
        require(_devWallet != address(0), "Invalid dev wallet");
        devWallet = _devWallet;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function setCollectionName(address collection, string calldata name) external whenNotPaused {
        try IOwnable(collection).owner() returns (address collectionOwner) {
            require(msg.sender == collectionOwner, "Only collection owner");
        } catch {
            require(bytes(collectionNames[collection]).length == 0, "Name already set");
        }

        collectionNames[collection] = name;
        emit CollectionNameUpdated(collection, name);
    }

    function list(address collection, uint256 tokenId, uint256 price) 
        external 
        nonReentrant 
        whenNotPaused 
    {
        require(price > 0 && price <= 1000 ether, "Invalid price");

        IERC721 nft = IERC721(collection);
        require(nft.ownerOf(tokenId) == msg.sender, "Not owner");
        require(
            nft.isApprovedForAll(msg.sender, address(this)) || 
            nft.getApproved(tokenId) == address(this),
            "Not approved"
        );

        uint256 existing = tokenToListingId[collection][tokenId];
        require(existing == 0 || !listings[existing].active, "Already listed");

        _listingIdCounter++;
        uint256 listingId = _listingIdCounter;

        listings[listingId] = Listing({
            collection: collection,
            tokenId: tokenId,
            price: price,
            seller: msg.sender,
            active: true
        });

        tokenToListingId[collection][tokenId] = listingId;

        emit Listed(listingId, collection, tokenId, msg.sender, price);
    }

    function cancelListing(uint256 listingId) external nonReentrant whenNotPaused {
        Listing storage listing = listings[listingId];
        require(listing.active, "Not active");
        require(listing.seller == msg.sender, "Not seller");

        listing.active = false;
        delete tokenToListingId[listing.collection][listing.tokenId];

        emit ListingCancelled(listingId);
    }

    function buy(uint256 listingId) external payable nonReentrant whenNotPaused {
        Listing storage listing = listings[listingId];
        require(listing.active, "Not active");
        require(msg.value >= listing.price, "Insufficient payment");

        _processPurchase(
            listing.collection,
            listing.tokenId,
            listing.seller,
            listing.price,
            msg.sender
        );

        listing.active = false;
        delete tokenToListingId[listing.collection][listing.tokenId];

        emit Bought(listingId, msg.sender, listing.price);
    }

    function makeOffer(address collection, uint256 tokenId, uint256 price) 
        external 
        payable 
        nonReentrant 
        whenNotPaused 
    {
        require(price > 0, "Price must be > 0");
        require(msg.value == price, "Must send exact amount");

        IERC721 nft = IERC721(collection);
        require(nft.ownerOf(tokenId) != msg.sender, "Cannot offer on own NFT");

        _offerIdCounter++;
        uint256 offerId = _offerIdCounter;

        offers[offerId] = Offer({
            collection: collection,
            tokenId: tokenId,
            offerer: msg.sender,
            price: price,
            active: true
        });

        emit OfferCreated(offerId, collection, tokenId, msg.sender, price);
    }

    function acceptOffer(uint256 offerId) external nonReentrant whenNotPaused {
        Offer storage offer = offers[offerId];
        require(offer.active, "Not active");

        address collection = offer.collection;
        uint256 tokenId = offer.tokenId;
        address buyer = offer.offerer;
        uint256 price = offer.price;

        IERC721 nft = IERC721(collection);
        require(nft.ownerOf(tokenId) == msg.sender, "Only owner can accept");

        offer.active = false;

        _processPurchase(collection, tokenId, msg.sender, price, buyer);

        emit OfferAccepted(offerId, buyer);
    }

    function cancelOffer(uint256 offerId) external nonReentrant {
        Offer storage offer = offers[offerId];
        require(offer.active, "Not active");
        require(offer.offerer == msg.sender, "Not offerer");

        offer.active = false;
        (bool success, ) = payable(msg.sender).call{value: offer.price}("");
        require(success, "Refund failed");

        emit OfferCancelled(offerId);
    }

    function _processPurchase(
        address collection,
        uint256 tokenId,
        address seller,
        uint256 price,
        address buyer
    ) internal {
        uint256 devFee = (price * PLATFORM_FEE_BPS) / 10000;
        uint256 sellerProceeds = price - devFee;

        try IERC2981(collection).royaltyInfo(tokenId, price) returns (address royaltyReceiver, uint256 royaltyAmount) {
            if (royaltyReceiver != address(0) && royaltyAmount > 0 && royaltyAmount < price) {
                sellerProceeds -= royaltyAmount;
                (bool royaltySent, ) = payable(royaltyReceiver).call{value: royaltyAmount}("");
                require(royaltySent, "Royalty failed");
            }
        } catch {}

        IERC721(collection).safeTransferFrom(seller, buyer, tokenId);

        (bool sellerSent, ) = payable(seller).call{value: sellerProceeds}("");
        require(sellerSent, "Payment to seller failed");

        (bool devSent, ) = devWallet.call{value: devFee}("");
        require(devSent, "Dev fee failed");
    }

    function getActiveListings(uint256 offset, uint256 limit) 
        external 
        view 
        returns (uint256[] memory) 
    {
        uint256[] memory result = new uint256[](limit);
        uint256 count = 0;

        for (uint256 i = offset + 1; i <= _listingIdCounter && count < limit; i++) {
            if (listings[i].active) {
                result[count] = i;
                count++;
            }
        }

        assembly {
            mstore(result, count)
        }
        return result;
    }

    function getListingByToken(address collection, uint256 tokenId) 
        external 
        view 
        returns (uint256, Listing memory) 
    {
        uint256 id = tokenToListingId[collection][tokenId];
        return (id, listings[id]);
    }
}