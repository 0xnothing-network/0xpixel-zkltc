// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {Script, console} from "forge-std/Script.sol";
import {ZeroxPixel} from "../src/ZeroxPixel.sol";

/**
 * @title DeployZeroxPixel
 * @notice Deploys the 0xPixel marketplace to LitVM testnet (or any EVM chain).
 *
 * Usage:
 *   source .env
 *   forge script script/Deploy.s.sol:DeployZeroxPixel \
 *     --rpc-url $LITVM_RPC_URL \
 *     --private-key $PRIVATE_KEY \
 *     --broadcast
 *
 * Optional arguments (set as env vars before running):
 *   DEV_WALLET — address that receives the 2.5% marketplace fee.
 *                Defaults to the deployer if unset.
 */
contract DeployZeroxPixel is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        address devWallet = vm.envOr("DEV_WALLET", deployer);

        console.log("Deployer:        ", deployer);
        console.log("Dev wallet:      ", devWallet);
        console.log("Chain id:        ", block.chainid);
        console.log("Block timestamp: ", block.timestamp);

        vm.startBroadcast(deployerPrivateKey);
        ZeroxPixel nft = new ZeroxPixel(payable(devWallet));
        vm.stopBroadcast();

        console.log("ZeroxPixel deployed at:", address(nft));
    }
}
