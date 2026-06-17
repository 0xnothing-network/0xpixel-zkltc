# 0xPixel on LitVM

On-chain pixel-art NFT marketplace built on **LitVM** — the first trustless
EVM-compatible rollup secured by Litecoin (Arbitrum Orbit + BitcoinOS).

Each pixel-art piece is minted as an ERC-721 token whose `tokenURI` returns
fully on-chain SVG (no IPFS, no external hosting). A built-in marketplace lets
creators list their work, supports a 2.5 % dev fee, and pays 2.5 % royalties
back to the original creator on every secondary sale.

## Stack

| Layer | Tool |
| --- | --- |
| Smart contract | Solidity `0.8.34` + OpenZeppelin Contracts v5 |
| Dev / build | [Foundry](https://book.getfoundry.sh) (forge / cast / anvil) |
| Test / deploy scripts | Forge tests + Forge scripts |
| Network | LitVM LiteForge testnet (chain id `4441`) |
| Frontend | Next.js 14 (App Router) + wagmi v2 + viem + RainbowKit |
| Wallet | Any EVM wallet (MetaMask, Rabby, WalletConnect) |

## Quick start

```bash
# 1. Install Foundry (skip if already installed)
curl -L https://foundry.paradigm.xyz | bash
foundryup

# 2. Install dependencies
forge install OpenZeppelin/openzeppelin-contracts --no-commit
forge install foundry-rs/forge-std --no-commit

# 3. Copy env file and fill in your private key
cp .env.example .env

# 4. Build
forge build

# 5. Test
forge test -vvv

# 6. Deploy to LitVM testnet
forge script script/Deploy.s.sol:DeployZeroxPixel \
  --rpc-url $LITVM_RPC_URL \
  --private-key $PRIVATE_KEY \
  --broadcast
```

> Need testnet zkLTC? Grab some from the [LitVM faucet](https://liteforge.hub.caldera.xyz)
> after adding the LitVM network to your wallet (chain id `4441`).

## Repository layout

```
.
├── src/                  # Solidity sources
│   └── ZeroxPixel.sol    # Main ERC-721 + marketplace contract
├── test/                 # Forge tests
├── script/               # Forge deployment / interaction scripts
├── lib/                  # External dependencies (OpenZeppelin, forge-std)
├── frontend/             # Next.js + wagmi marketplace UI
├── foundry.toml          # Foundry config (LitVM RPC, EVM=shanghai, OZ remap)
├── .env.example          # Environment template
└── README.md
```

## LitVM specifics

LitVM is an Arbitrum Orbit chain, so most Ethereum contracts work unchanged.
Two things to be aware of:

- `block.number` returns the **approximate Ethereum L1 block**, not the LitVM
  block. If you ever need the L2 block number, call
  `ArbSys(address(100)).arbBlockNumber()`.
- `blockhash()` is **not** cryptographically secure — do not use it for
  randomness. This contract does not need it.

Full details: <https://docs.litvm.com/evm-differences>.

## Network parameters

| Field | Value |
| --- | --- |
| Network | LitVM LiteForge (testnet) |
| Chain ID | `4441` |
| RPC | `https://liteforge.rpc.caldera.xyz/http` |
| Explorer | `https://liteforge.explorer.caldera.xyz` |
| Gas token | zkLTC |
| Faucet | <https://liteforge.hub.caldera.xyz> |

## License

MIT
