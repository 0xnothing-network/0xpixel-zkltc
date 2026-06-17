// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {Script, console} from "forge-std/Script.sol";
import {ZeroxPixel} from "../src/ZeroxPixel.sol";

/**
 * @title ListForSale
 * @notice Lists an existing token on the marketplace.
 *
 * Required env vars:
 *   PRIVATE_KEY  — owner of the token
 *   NFT_ADDRESS  — address of the deployed ZeroxPixel contract
 *   TOKEN_ID     — id of the token to list
 *   PRICE_WEI    — listing price in wei
 */
contract ListForSale is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address nftAddr = vm.envAddress("NFT_ADDRESS");
        uint256 tokenId = vm.envUint("TOKEN_ID");
        uint256 price = vm.envUint("PRICE_WEI");

        ZeroxPixel nft = ZeroxPixel(nftAddr);

        vm.startBroadcast(pk);
        nft.listForSale(tokenId, price);
        vm.stopBroadcast();

        console.log("Listed token", tokenId, "for", price, "wei");
    }
}
