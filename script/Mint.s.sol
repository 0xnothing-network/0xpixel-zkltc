// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {Script, console} from "forge-std/Script.sol";
import {ZeroxPixel} from "../src/ZeroxPixel.sol";

/**
 * @title MintPixelArt
 * @notice Mints a single pixel-art NFT on an already-deployed ZeroxPixel contract.
 *
 * Required env vars:
 *   PRIVATE_KEY      — deployer / minter key
 *   NFT_ADDRESS      — address of the deployed ZeroxPixel contract
 *   PIXEL_NAME       — short name (max 32 bytes)
 *   PIXEL_DESC       — description (max 256 bytes)
 *   PIXEL_GRID       — 8 / 16 / 32 / 64 / 128
 *   PIXEL_DATA       — body in `[x,y]=#RRGGBB [x,y]=#RRGGBB ...` format
 */
contract MintPixelArt is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address nftAddr = vm.envAddress("NFT_ADDRESS");
        string memory name = vm.envString("PIXEL_NAME");
        string memory desc = vm.envString("PIXEL_DESC");
        uint256 grid = vm.envUint("PIXEL_GRID");
        string memory px = vm.envString("PIXEL_DATA");

        ZeroxPixel nft = ZeroxPixel(nftAddr);

        vm.startBroadcast(pk);
        uint256 id = nft.mint(name, desc, grid, px);
        vm.stopBroadcast();

        console.log("Minted token id:", id);
        console.log("Owner:          ", nft.ownerOf(id));
        console.log("Token URI:      ", nft.tokenURI(id));
    }
}
