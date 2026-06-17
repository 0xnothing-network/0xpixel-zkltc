// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {Test, console} from "forge-std/Test.sol";
import {ZeroxPixel} from "../src/ZeroxPixel.sol";

contract ZeroxPixelTest is Test {
    ZeroxPixel public nft;
    address public deployer = address(this);
    address public alice = address(0xA11CE);
    address public bob = address(0xB0B);
    address public dev = address(0xDEAD);

    string constant SAMPLE_PIXELS = "[0,0]=#ff0000 [1,0]=#00ff00 [0,1]=#0000ff";
    string constant SAMPLE_NAME = "Sunset";
    string constant SAMPLE_DESC = "A tiny pixel-art sunset.";

    function setUp() public {
        nft = new ZeroxPixel(payable(dev));
        vm.label(deployer, "deployer");
        vm.label(alice, "alice");
        vm.label(bob, "bob");
        vm.label(dev, "dev");
    }

    /* ---------- Minting ------------------------------------------------- */

    function test_Mint_Succeeds() public {
        uint256 id = nft.mint(SAMPLE_NAME, SAMPLE_DESC, 8, SAMPLE_PIXELS);
        assertEq(id, 1);
        assertEq(nft.ownerOf(id), alice);
        assertEq(nft.balanceOf(alice), 1);
    }

    function test_Mint_RejectsDuplicateArtwork() public {
        vm.prank(alice);
        nft.mint(SAMPLE_NAME, SAMPLE_DESC, 8, SAMPLE_PIXELS);
        vm.prank(bob);
        vm.expectRevert(bytes("Artwork exists"));
        nft.mint(SAMPLE_NAME, SAMPLE_DESC, 8, SAMPLE_PIXELS);
    }

    function test_Mint_RejectsInvalidGrid() public {
        vm.prank(alice);
        vm.expectRevert(bytes("Invalid grid"));
        nft.mint("x", "y", 7, SAMPLE_PIXELS);
    }

    function test_Mint_RejectsEmptyName() public {
        vm.prank(alice);
        vm.expectRevert(bytes("Invalid name"));
        nft.mint("", "desc", 8, SAMPLE_PIXELS);
    }

    function test_Mint_RejectsDescriptionTooLong() public {
        vm.prank(alice);
        string memory longDesc = new string(257);
        vm.expectRevert(bytes("Desc too long"));
        nft.mint("ok", longDesc, 8, SAMPLE_PIXELS);
    }

    function test_Mint_RejectsEmptyPixelData() public {
        vm.prank(alice);
        vm.expectRevert(bytes("Invalid px"));
        nft.mint("ok", "d", 8, "");
    }

    function test_CheckOriginal_BeforeMint() public view {
        assertTrue(nft.checkOriginal(SAMPLE_PIXELS, 8));
    }

    function test_CheckOriginal_AfterMint() public {
        vm.prank(alice);
        nft.mint(SAMPLE_NAME, SAMPLE_DESC, 8, SAMPLE_PIXELS);
        assertFalse(nft.checkOriginal(SAMPLE_PIXELS, 8));
    }

    function test_GetCreator_ReturnsZeroForUnknown() public view {
        assertEq(nft.getCreator("nope", 8), address(0));
    }

    /* ---------- Listing ------------------------------------------------- */

    function test_List_RejectsNonOwner() public {
        vm.prank(alice);
        uint256 id = nft.mint(SAMPLE_NAME, SAMPLE_DESC, 8, SAMPLE_PIXELS);

        vm.prank(bob);
        vm.expectRevert(bytes("Not owner"));
        nft.listForSale(id, 1 ether);
    }

    function test_List_RejectsZeroPrice() public {
        vm.prank(alice);
        uint256 id = nft.mint(SAMPLE_NAME, SAMPLE_DESC, 8, SAMPLE_PIXELS);

        vm.prank(alice);
        vm.expectRevert(bytes("Zero price"));
        nft.listForSale(id, 0);
    }

    function test_List_RejectsDoubleListing() public {
        vm.prank(alice);
        uint256 id = nft.mint(SAMPLE_NAME, SAMPLE_DESC, 8, SAMPLE_PIXELS);

        vm.prank(alice);
        nft.listForSale(id, 1 ether);
        vm.prank(alice);
        vm.expectRevert(bytes("Already listed"));
        nft.listForSale(id, 2 ether);
    }

    function test_List_RejectsPriceAboveCap() public {
        vm.prank(alice);
        uint256 id = nft.mint(SAMPLE_NAME, SAMPLE_DESC, 8, SAMPLE_PIXELS);

        vm.prank(alice);
        vm.expectRevert(bytes("Price too high"));
        nft.listForSale(id, 1001 ether);
    }

    function test_List_Succeeds() public {
        vm.prank(alice);
        uint256 id = nft.mint(SAMPLE_NAME, SAMPLE_DESC, 8, SAMPLE_PIXELS);

        vm.prank(alice);
        nft.listForSale(id, 1 ether);
        assertTrue(nft.isTokenListed(id));
        (,,, , uint256 price,,,,) = nft.tokenData(id);
        assertEq(price, 1 ether);
    }

    /* ---------- Buy ----------------------------------------------------- */

    function test_Buy_TransfersOwnershipAndPaysOut() public {
        vm.prank(alice);
        uint256 id = nft.mint(SAMPLE_NAME, SAMPLE_DESC, 8, SAMPLE_PIXELS);
        vm.prank(alice);
        nft.listForSale(id, 10 ether);

        uint256 aliceBalBefore = alice.balance;
        uint256 devBalBefore = dev.balance;

        vm.prank(bob);
        nft.buyNFT{value: 10 ether}(id);

        assertEq(nft.ownerOf(id), bob);
        // Seller receives price - 2.5% dev fee
        // (no royalty because seller == creator)
        assertEq(alice.balance, aliceBalBefore + 10 ether - (10 ether * 25) / 1000);
        assertEq(dev.balance, devBalBefore + (10 ether * 25) / 1000);
    }

    function test_Buy_PaysCreatorRoyaltyOnSecondarySale() public {
        // Alice mints and lists
        vm.prank(alice);
        uint256 id = nft.mint(SAMPLE_NAME, SAMPLE_DESC, 8, SAMPLE_PIXELS);
        vm.prank(alice);
        nft.listForSale(id, 10 ether);

        // Bob buys
        vm.prank(bob);
        nft.buyNFT{value: 10 ether}(id);

        // Bob lists higher
        vm.prank(bob);
        nft.listForSale(id, 20 ether);

        // Carol buys from Bob — Alice should get 2.5% royalty
        uint256 alicePendingBefore = nft.pendingWithdrawals(alice);
        address carol = address(0xCAFE);
        vm.deal(carol, 100 ether);
        vm.prank(carol);
        nft.buyNFT{value: 20 ether}(id);

        // Royalty = 20 * 25 / 1000 = 0.5 ether
        assertEq(nft.pendingWithdrawals(alice), alicePendingBefore + (20 ether * 25) / 1000);
        assertEq(nft.ownerOf(id), carol);
    }

    function test_Buy_RejectsOwnerBuyingOwn() public {
        vm.prank(alice);
        uint256 id = nft.mint(SAMPLE_NAME, SAMPLE_DESC, 8, SAMPLE_PIXELS);
        vm.prank(alice);
        nft.listForSale(id, 1 ether);

        vm.prank(alice);
        vm.expectRevert(bytes("Cannot buy own"));
        nft.buyNFT{value: 1 ether}(id);
    }

    function test_Buy_RejectsInsufficientPayment() public {
        vm.prank(alice);
        uint256 id = nft.mint(SAMPLE_NAME, SAMPLE_DESC, 8, SAMPLE_PIXELS);
        vm.prank(alice);
        nft.listForSale(id, 1 ether);

        vm.prank(bob);
        vm.expectRevert(bytes("Insufficient payment"));
        nft.buyNFT{value: 0.5 ether}(id);
    }

    function test_Buy_RejectsUnlistedToken() public {
        vm.prank(alice);
        uint256 id = nft.mint(SAMPLE_NAME, SAMPLE_DESC, 8, SAMPLE_PIXELS);

        vm.prank(bob);
        vm.expectRevert(bytes("Not listed"));
        nft.buyNFT{value: 1 ether}(id);
    }

    function test_Buy_RefundsExcess() public {
        vm.prank(alice);
        uint256 id = nft.mint(SAMPLE_NAME, SAMPLE_DESC, 8, SAMPLE_PIXELS);
        vm.prank(alice);
        nft.listForSale(id, 1 ether);

        uint256 bobBalBefore = bob.balance;
        vm.prank(bob);
        nft.buyNFT{value: 3 ether}(id);

        assertEq(nft.ownerOf(id), bob);
        // Bob paid 3, price was 1, so Bob's net spend is 1
        assertEq(bobBalBefore - bob.balance, 1 ether);
    }

    function test_Buy_IncrementsScore() public {
        vm.prank(alice);
        uint256 id = nft.mint(SAMPLE_NAME, SAMPLE_DESC, 8, SAMPLE_PIXELS);
        vm.prank(alice);
        nft.listForSale(id, 1 ether);

        assertEq(nft.getScore(id), 0);

        vm.prank(bob);
        nft.buyNFT{value: 1 ether}(id);
        assertEq(nft.getScore(id), 1);
    }

    /* ---------- Delist -------------------------------------------------- */

    function test_Delist_RejectsNonOwner() public {
        vm.prank(alice);
        uint256 id = nft.mint(SAMPLE_NAME, SAMPLE_DESC, 8, SAMPLE_PIXELS);
        vm.prank(alice);
        nft.listForSale(id, 1 ether);

        vm.prank(bob);
        vm.expectRevert(bytes("Not owner"));
        nft.delist(id);
    }

    function test_Delist_RejectsUnlisted() public {
        vm.prank(alice);
        uint256 id = nft.mint(SAMPLE_NAME, SAMPLE_DESC, 8, SAMPLE_PIXELS);

        vm.prank(alice);
        vm.expectRevert(bytes("Not listed"));
        nft.delist(id);
    }

    function test_Delist_Succeeds() public {
        vm.prank(alice);
        uint256 id = nft.mint(SAMPLE_NAME, SAMPLE_DESC, 8, SAMPLE_PIXELS);
        vm.prank(alice);
        nft.listForSale(id, 1 ether);

        vm.prank(alice);
        nft.delist(id);
        assertFalse(nft.isTokenListed(id));
    }

    /* ---------- Withdrawals -------------------------------------------- */

    function test_WithdrawPending_RejectsZero() public {
        vm.prank(alice);
        vm.expectRevert(bytes("No pending"));
        nft.withdrawPending();
    }

    function test_WithdrawPending_PaysOut() public {
        vm.prank(alice);
        uint256 id = nft.mint(SAMPLE_NAME, SAMPLE_DESC, 8, SAMPLE_PIXELS);
        vm.prank(alice);
        nft.listForSale(id, 10 ether);

        vm.prank(bob);
        nft.buyNFT{value: 10 ether}(id);

        // Alice should have pending from dev fee refund path
        // Actually she is the seller==creator so dev fee is in dev wallet pending
        uint256 pending = nft.pendingWithdrawals(dev);
        assertGt(pending, 0);

        uint256 devBalBefore = dev.balance;
        vm.prank(dev);
        nft.withdrawPending();
        assertEq(dev.balance, devBalBefore + pending);
        assertEq(nft.pendingWithdrawals(dev), 0);
    }

    /* ---------- ERC-2981 ------------------------------------------------ */

    function test_RoyaltyInfo_Returns2Point5Percent() public {
        vm.prank(alice);
        uint256 id = nft.mint(SAMPLE_NAME, SAMPLE_DESC, 8, SAMPLE_PIXELS);

        (address receiver, uint256 amount) = nft.royaltyInfo(id, 1 ether);
        assertEq(receiver, alice);
        assertEq(amount, (1 ether * 25) / 1000);
    }

    function test_SupportsInterface_ERC2981() public view {
        assertTrue(nft.supportsInterface(0x2a55205a)); // ERC-2981
    }

    /* ---------- tokenURI ------------------------------------------------ */

    function test_TokenURI_GeneratesValidDataURI() public {
        vm.prank(alice);
        uint256 id = nft.mint(SAMPLE_NAME, SAMPLE_DESC, 8, SAMPLE_PIXELS);

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
