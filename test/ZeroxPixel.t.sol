// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {Test, console} from "forge-std/Test.sol";
import {ZeroxPixel} from "../src/ZeroxPixel.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

contract ZeroxPixelTest is Test {
    ZeroxPixel public nft;
    address public deployer = address(this);
    address public alice;
    address public bob;
    address public dev = address(0xDEAD);

    string constant SAMPLE_PIXELS = "[0,0]=#ff0000 [1,0]=#00ff00 [0,1]=#0000ff";
    string constant SAMPLE_NAME = "Sunset";
    string constant SAMPLE_DESC = "A tiny pixel-art sunset.";

    function setUp() public {
        nft = new ZeroxPixel(payable(dev));
        // Use a contract address for alice so `onERC721Received` works.
        alice = address(new AliceReceiver());
        bob = address(0xB0B);
        vm.label(deployer, "deployer");
        vm.label(alice, "alice");
        vm.label(bob, "bob");
        vm.label(dev, "dev");
    }

    /* ---------- Minting ------------------------------------------------- */

    function test_Mint_Succeeds() public {
        vm.startPrank(alice);
        uint256 id = nft.mint(SAMPLE_NAME, 8, SAMPLE_PIXELS);
        vm.stopPrank();

        assertEq(id, 1);
        assertEq(nft.ownerOf(id), alice);
        assertEq(nft.balanceOf(alice), 1);
    }

    function test_Mint_RejectsDuplicateArtwork() public {
        vm.startPrank(alice);
        nft.mint(SAMPLE_NAME, 8, SAMPLE_PIXELS);
        vm.stopPrank();

        vm.startPrank(bob);
        vm.expectRevert(bytes("Artwork exists"));
        nft.mint(SAMPLE_NAME, 8, SAMPLE_PIXELS);
        vm.stopPrank();
    }

    function test_Mint_RejectsInvalidGrid() public {
        vm.startPrank(alice);
        vm.expectRevert(bytes("Invalid grid (max 64)"));
        nft.mint("x", 7, SAMPLE_PIXELS);
        vm.stopPrank();
    }

    function test_Mint_RejectsEmptyName() public {
        vm.startPrank(alice);
        vm.expectRevert(bytes("Invalid name"));
        nft.mint("", 8, SAMPLE_PIXELS);
        vm.stopPrank();
    }

    function test_Mint_RejectsNameTooLong() public {
        vm.startPrank(alice);
        string memory longName = new string(33);
        vm.expectRevert(bytes("Invalid name"));
        nft.mint(longName, 8, SAMPLE_PIXELS);
        vm.stopPrank();
    }

    function test_Mint_RejectsEmptyPixelData() public {
        vm.startPrank(alice);
        vm.expectRevert(bytes("Invalid px"));
        nft.mint("ok", 8, "");
        vm.stopPrank();
    }

    function test_CheckOriginal_BeforeMint() public view {
        assertTrue(nft.checkOriginal(SAMPLE_PIXELS, 8));
    }

    function test_CheckOriginal_AfterMint() public {
        vm.startPrank(alice);
        nft.mint(SAMPLE_NAME, 8, SAMPLE_PIXELS);
        vm.stopPrank();
        assertFalse(nft.checkOriginal(SAMPLE_PIXELS, 8));
    }

    function test_GetCreator_ReturnsZeroForUnknown() public view {
        assertEq(nft.getCreator("nope", 8), address(0));
    }

    /* ---------- Listing ------------------------------------------------- */

    function test_List_RejectsNonOwner() public {
        vm.startPrank(alice);
        uint256 id = nft.mint(SAMPLE_NAME, 8, SAMPLE_PIXELS);
        vm.stopPrank();

        vm.startPrank(bob);
        vm.expectRevert(bytes("Not owner"));
        nft.listForSale(id, 1 ether);
        vm.stopPrank();
    }

    function test_List_RejectsZeroPrice() public {
        vm.startPrank(alice);
        uint256 id = nft.mint(SAMPLE_NAME, 8, SAMPLE_PIXELS);
        vm.stopPrank();

        vm.startPrank(alice);
        vm.expectRevert(bytes("Zero price"));
        nft.listForSale(id, 0);
        vm.stopPrank();
    }

    function test_List_RejectsDoubleListing() public {
        vm.startPrank(alice);
        uint256 id = nft.mint(SAMPLE_NAME, 8, SAMPLE_PIXELS);
        nft.listForSale(id, 1 ether);
        vm.stopPrank();

        vm.startPrank(alice);
        vm.expectRevert(bytes("Already listed"));
        nft.listForSale(id, 2 ether);
        vm.stopPrank();
    }

    function test_List_RejectsPriceAboveCap() public {
        vm.startPrank(alice);
        uint256 id = nft.mint(SAMPLE_NAME, 8, SAMPLE_PIXELS);
        vm.stopPrank();

        vm.startPrank(alice);
        vm.expectRevert(bytes("Price too high"));
        nft.listForSale(id, 1001 ether);
        vm.stopPrank();
    }

    function test_List_Succeeds() public {
        vm.startPrank(alice);
        uint256 id = nft.mint(SAMPLE_NAME, 8, SAMPLE_PIXELS);
        nft.listForSale(id, 1 ether);
        vm.stopPrank();

        assertTrue(nft.isTokenListed(id));
        (,,, uint256 price,,,,) = nft.tokenData(id);
        assertEq(price, 1 ether);
    }

    /* ---------- Buy ----------------------------------------------------- */

    function test_Buy_TransfersOwnershipAndPaysOut() public {
        vm.startPrank(alice);
        uint256 id = nft.mint(SAMPLE_NAME, 8, SAMPLE_PIXELS);
        nft.listForSale(id, 10 ether);
        vm.stopPrank();

        vm.deal(bob, 20 ether);
        vm.startPrank(bob);
        nft.buyNFT{value: 10 ether}(id);
        vm.stopPrank();

        assertEq(nft.ownerOf(id), bob);

        // Seller (alice) should receive price - 2.5% dev fee via pending withdrawals
        uint256 expectedSellerAmt = 10 ether - (10 ether * 25) / 1000;
        assertEq(nft.pendingWithdrawals(alice), expectedSellerAmt);
        // Dev wallet should receive 2.5% fee
        assertEq(nft.pendingWithdrawals(dev), (10 ether * 25) / 1000);
    }

    function test_Buy_PaysCreatorRoyaltyOnSecondarySale() public {
        // Alice mints and lists
        vm.startPrank(alice);
        uint256 id = nft.mint(SAMPLE_NAME, 8, SAMPLE_PIXELS);
        nft.listForSale(id, 10 ether);
        vm.stopPrank();

        // Bob buys
        vm.deal(bob, 20 ether);
        vm.startPrank(bob);
        nft.buyNFT{value: 10 ether}(id);
        vm.stopPrank();

        // Bob lists higher
        vm.startPrank(bob);
        nft.listForSale(id, 20 ether);
        vm.stopPrank();

        // Carol buys from Bob — Alice should get 2.5% royalty
        address carol = address(0xCAFE);
        vm.deal(carol, 100 ether);
        uint256 alicePendingBefore = nft.pendingWithdrawals(alice);
        vm.startPrank(carol);
        nft.buyNFT{value: 20 ether}(id);
        vm.stopPrank();

        // Royalty = 20 * 25 / 1000 = 0.5 ether
        assertEq(nft.pendingWithdrawals(alice), alicePendingBefore + (20 ether * 25) / 1000);
        assertEq(nft.ownerOf(id), carol);
    }

    function test_Buy_RejectsOwnerBuyingOwn() public {
        vm.deal(alice, 5 ether);
        vm.startPrank(alice);
        uint256 id = nft.mint(SAMPLE_NAME, 8, SAMPLE_PIXELS);
        nft.listForSale(id, 1 ether);
        vm.expectRevert(bytes("Cannot buy own"));
        nft.buyNFT{value: 1 ether}(id);
        vm.stopPrank();
    }

    function test_Buy_RejectsInsufficientPayment() public {
        vm.deal(bob, 1 ether);
        vm.startPrank(alice);
        uint256 id = nft.mint(SAMPLE_NAME, 8, SAMPLE_PIXELS);
        nft.listForSale(id, 1 ether);
        vm.stopPrank();

        vm.startPrank(bob);
        vm.expectRevert(bytes("Insufficient payment"));
        nft.buyNFT{value: 0.5 ether}(id);
        vm.stopPrank();
    }

    function test_Buy_RejectsUnlistedToken() public {
        vm.deal(bob, 5 ether);
        vm.startPrank(alice);
        uint256 id = nft.mint(SAMPLE_NAME, 8, SAMPLE_PIXELS);
        vm.stopPrank();

        vm.startPrank(bob);
        vm.expectRevert(bytes("Not listed"));
        nft.buyNFT{value: 1 ether}(id);
        vm.stopPrank();
    }

    function test_Buy_RefundsExcess() public {
        vm.startPrank(alice);
        uint256 id = nft.mint(SAMPLE_NAME, 8, SAMPLE_PIXELS);
        nft.listForSale(id, 1 ether);
        vm.stopPrank();

        vm.deal(bob, 10 ether);
        vm.startPrank(bob);
        nft.buyNFT{value: 3 ether}(id);
        vm.stopPrank();

        assertEq(nft.ownerOf(id), bob);
        // Excess 2 ETH refunded, seller pending = price - dev fee
        uint256 expectedSellerPending = 1 ether - (1 ether * 25) / 1000;
        assertEq(nft.pendingWithdrawals(alice), expectedSellerPending);
    }

    function test_Buy_IncrementsScore() public {
        vm.startPrank(alice);
        uint256 id = nft.mint(SAMPLE_NAME, 8, SAMPLE_PIXELS);
        nft.listForSale(id, 1 ether);
        vm.stopPrank();

        assertEq(nft.getScore(id), 0);

        vm.deal(bob, 5 ether);
        vm.startPrank(bob);
        nft.buyNFT{value: 1 ether}(id);
        vm.stopPrank();
        assertEq(nft.getScore(id), 1);
    }

    /* ---------- Delist -------------------------------------------------- */

    function test_Delist_RejectsNonOwner() public {
        vm.startPrank(alice);
        uint256 id = nft.mint(SAMPLE_NAME, 8, SAMPLE_PIXELS);
        nft.listForSale(id, 1 ether);
        vm.stopPrank();

        vm.startPrank(bob);
        vm.expectRevert(bytes("Not owner"));
        nft.delist(id);
        vm.stopPrank();
    }

    function test_Delist_RejectsUnlisted() public {
        vm.startPrank(alice);
        uint256 id = nft.mint(SAMPLE_NAME, 8, SAMPLE_PIXELS);
        vm.stopPrank();

        vm.startPrank(alice);
        vm.expectRevert(bytes("Not listed"));
        nft.delist(id);
        vm.stopPrank();
    }

    function test_Delist_Succeeds() public {
        vm.startPrank(alice);
        uint256 id = nft.mint(SAMPLE_NAME, 8, SAMPLE_PIXELS);
        nft.listForSale(id, 1 ether);
        nft.delist(id);
        vm.stopPrank();
        assertFalse(nft.isTokenListed(id));
    }

    /* ---------- Withdrawals -------------------------------------------- */

    function test_WithdrawPending_RejectsZero() public {
        vm.startPrank(alice);
        vm.expectRevert(bytes("No pending"));
        nft.withdrawPending();
        vm.stopPrank();
    }

    function test_WithdrawPending_PaysOut() public {
        vm.startPrank(alice);
        uint256 id = nft.mint(SAMPLE_NAME, 8, SAMPLE_PIXELS);
        nft.listForSale(id, 10 ether);
        vm.stopPrank();

        vm.deal(bob, 20 ether);
        vm.startPrank(bob);
        nft.buyNFT{value: 10 ether}(id);
        vm.stopPrank();

        // Dev wallet should have pending from 2.5% fee
        uint256 pending = nft.pendingWithdrawals(dev);
        assertGt(pending, 0);

        uint256 devBalBefore = dev.balance;
        vm.startPrank(dev);
        nft.withdrawPending();
        vm.stopPrank();
        assertEq(dev.balance, devBalBefore + pending);
        assertEq(nft.pendingWithdrawals(dev), 0);
    }

    /* ---------- ERC-2981 ------------------------------------------------ */

    function test_RoyaltyInfo_Returns2Point5Percent() public {
        vm.startPrank(alice);
        uint256 id = nft.mint(SAMPLE_NAME, 8, SAMPLE_PIXELS);
        vm.stopPrank();

        (address receiver, uint256 amount) = nft.royaltyInfo(id, 1 ether);
        assertEq(receiver, alice);
        assertEq(amount, (1 ether * 25) / 1000);
    }

    function test_SupportsInterface_ERC2981() public view {
        assertTrue(nft.supportsInterface(0x2a55205a)); // ERC-2981
    }

    /* ---------- tokenURI ------------------------------------------------ */

    function test_TokenURI_GeneratesValidDataURI() public {
        vm.startPrank(alice);
        uint256 id = nft.mint(SAMPLE_NAME, 8, SAMPLE_PIXELS);
        vm.stopPrank();

        string memory uri = nft.tokenURI(id);
        // Should start with the JSON data URI prefix
        assertEq(_prefix(uri, 29), "data:application/json;base64,");
    }

    function _prefix(string memory s, uint256 n) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        bytes memory out = new bytes(n);
        for (uint256 i = 0; i < n && i < b.length; i++) out[i] = b[i];
        return string(out);
    }

    /* ---------- Constructor --------------------------------------------- */

    function test_Constructor_RejectsZeroDevWallet() public {
        vm.expectRevert(bytes("Zero dev wallet"));
        new ZeroxPixel(payable(address(0)));
    }

    function test_Constructor_SetsDevWallet() public view {
        assertEq(nft.devWallet(), dev);
    }

    /* ---------- Receive ------------------------------------------------- */

    function test_Receive_AcceptsEth() public {
        (bool ok,) = address(nft).call{value: 1 ether}("");
        assertTrue(ok);
        assertEq(address(nft).balance, 1 ether);
    }
}

contract AliceReceiver is IERC721Receiver {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
}
