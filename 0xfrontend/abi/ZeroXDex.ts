/**
 * ABI for ZeroXDex (ZeroDex) Contract — deployed on LitVM LiteForge (chain id 4441)
 * Contract address: 0x873cb0402F0e74Db66663255e6B3535ca134C818
 * Contains only the events needed by the frontend chart & real-time invalidators.
 */

// Minimal ABI for ZeroXDex events used by the chart
export const ZeroXDexAbi = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'user', type: 'address' },
      { indexed: true, name: 'tokenIn', type: 'address' },
      { indexed: true, name: 'tokenOut', type: 'address' },
      { indexed: false, name: 'amountIn', type: 'uint256' },
      { indexed: false, name: 'amountOut', type: 'uint256' },
      { indexed: false, name: 'fee', type: 'uint256' },
    ],
    name: 'Swapped',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'user', type: 'address' },
      { indexed: true, name: 'pairId', type: 'bytes32' },
      { indexed: false, name: 'amount0', type: 'uint256' },
      { indexed: false, name: 'amount1', type: 'uint256' },
      { indexed: false, name: 'lpMinted', type: 'uint256' },
    ],
    name: 'LiquidityAdded',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'user', type: 'address' },
      { indexed: true, name: 'pairId', type: 'bytes32' },
      { indexed: false, name: 'lpBurned', type: 'uint256' },
      { indexed: false, name: 'amount0', type: 'uint256' },
      { indexed: false, name: 'amount1', type: 'uint256' },
    ],
    name: 'LiquidityRemoved',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'pairId', type: 'bytes32' },
      { indexed: false, name: 'token0', type: 'address' },
      { indexed: false, name: 'token1', type: 'address' },
      { indexed: false, name: 'creator', type: 'address' },
    ],
    name: 'PoolCreated',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'user', type: 'address' },
      { indexed: false, name: 'amount', type: 'uint256' },
    ],
    name: 'RewardClaimed',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: false, name: 'oldFee', type: 'uint256' },
      { indexed: false, name: 'newFee', type: 'uint256' },
    ],
    name: 'FeeUpdated',
    type: 'event',
  },
] as const;

// Contract address on LitVM LiteForge (must match lib/0xDexAbi.ts DEX_ADDRESS)
export const ZEROXDEX_ADDRESS =
  '0x873cb0402F0e74Db66663255e6B3535ca134C818' as const;

// Subgraph URL — version pinned to match the deployed subgraph
export const SUBGRAPH_URL =
  'https://api.goldsky.com/api/public/project_cmqmpust19i8v01t595z8hpq4/subgraphs/zeroxdex/1.0.7/gn' as const;
