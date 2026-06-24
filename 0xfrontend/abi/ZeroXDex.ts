/**
 * ABI for ZeroXDex Contract
 * Minimal ABI containing only the Swapped event for candlestick chart
 */

// Minimal ABI for ZeroXDex Swapped event
export const ZeroXDexAbi = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'sender', type: 'address' },
      { indexed: true, name: 'to', type: 'address' },
      { indexed: true, name: 'pair', type: 'address' },
      { indexed: false, name: 'amount0In', type: 'uint256' },
      { indexed: false, name: 'amount1Out', type: 'uint256' },
      { indexed: false, name: 'price', type: 'uint256' },
    ],
    name: 'Swapped',
    type: 'event',
  },
] as const;

// Contract address on LitVM LiteForge
export const ZEROXDEX_ADDRESS = '0xE042e43e3aBF44a17033B647F0c4559BD0185336' as const;

// Subgraph URL
export const SUBGRAPH_URL = 'https://api.goldsky.com/api/public/project_cmqmpust19i8v01t595z8hpq4/subgraphs/zeroxdex/1.0.2/gn';
