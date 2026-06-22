export const DEX_ABI = [
  {
    inputs: [
      { name: "_nusd", type: "address" },
      { name: "_native", type: "address" },
    ],
    stateMutability: "nonpayable",
    type: "constructor",
  },
  {
    anonymous: false,
    inputs: [
      { name: "user", indexed: true, type: "address" },
      { name: "pairId", indexed: true, type: "bytes32" },
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
      { name: "lpMinted", type: "uint256" },
    ],
    name: "LiquidityAdded",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { name: "user", indexed: true, type: "address" },
      { name: "pairId", indexed: true, type: "bytes32" },
      { name: "lpBurned", type: "uint256" },
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
    ],
    name: "LiquidityRemoved",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { name: "pairId", indexed: true, type: "bytes32" },
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
    ],
    name: "PoolCreated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { name: "user", indexed: true, type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "RewardClaimed",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { name: "user", indexed: true, type: "address" },
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "amountIn", type: "uint256" },
      { name: "amountOut", type: "uint256" },
      { name: "fee", type: "uint256" },
    ],
    name: "Swapped",
    type: "event",
  },
  { name: "NATIVE", outputs: [{ name: "", type: "address" }], stateMutability: "view", type: "function" },
  { name: "NUSD", outputs: [{ name: "", type: "address" }], stateMutability: "view", type: "function" },
  { name: "accRewardPerNUSD", outputs: [{ name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  {
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "amountA", type: "uint256" },
      { name: "amountB", type: "uint256" },
    ],
    name: "addLiquidity",
    outputs: [{ name: "lpMinted", type: "uint256" }],
    stateMutability: "payable",
    type: "function",
  },
  { inputs: [{ name: "", type: "uint256" }], name: "allPools", outputs: [{ name: "", type: "address" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "claimReward", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [], name: "getAllPools", outputs: [{ name: "", type: "address[]" }], stateMutability: "view", type: "function" },
  {
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
    ],
    name: "getPairId",
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "pure",
    type: "function",
  },
  {
    inputs: [{ name: "pairId", type: "bytes32" }],
    name: "getPoolInfo",
    outputs: [
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
      { name: "reserve0", type: "uint256" },
      { name: "reserve1", type: "uint256" },
      { name: "totalLP", type: "uint256" },
      { name: "volume24h", type: "uint256" },
      { name: "totalVolume", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "user", type: "address" }],
    name: "getUserPendingReward",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  { inputs: [], name: "owner", outputs: [{ name: "", type: "address" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "", type: "bytes32" }], name: "poolCreator", outputs: [{ name: "", type: "address" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "", type: "bytes32" }], name: "poolExists", outputs: [{ name: "", type: "bool" }], stateMutability: "view", type: "function" },
  {
    inputs: [{ name: "", type: "bytes32" }],
    name: "pools",
    outputs: [
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
      { name: "reserve0", type: "uint256" },
      { name: "reserve1", type: "uint256" },
      { name: "totalLP", type: "uint256" },
      { name: "volume24h", type: "uint256" },
      { name: "totalVolume", type: "uint256" },
      { name: "lastVolumeReset", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "pairId", type: "bytes32" },
      { name: "lpAmount", type: "uint256" },
    ],
    name: "removeLiquidity",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "amountIn", type: "uint256" },
      { name: "minAmountOut", type: "uint256" },
    ],
    name: "swap",
    outputs: [{ name: "amountOut", type: "uint256" }],
    stateMutability: "payable",
    type: "function",
  },
  { inputs: [], name: "totalNUSDLocked", outputs: [{ name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "totalRewardPool", outputs: [{ name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  {
    inputs: [
      { name: "",
        type: "bytes32" },
      { name: "", type: "address" },
    ],
    name: "userLP",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "", type: "address" }],
    name: "userNUSDLocked",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "", type: "address" }],
    name: "userRewardDebt",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  { stateMutability: "payable", type: "receive" },
] as const;

export const DEX_ADDRESS = process.env.NEXT_PUBLIC_DEX_ADDRESS || "0xE042e43e3aBF44a17033B647F0c4559BD0185336";
export const NATIVE_ADDRESS = "0x0000000000000000000000000000000000000000";

export interface PoolInfo {
  token0: `0x${string}`;
  token1: `0x${string}`;
  reserve0: bigint;
  reserve1: bigint;
  totalLP: bigint;
  volume24h: bigint;
  totalVolume: bigint;
}

export interface PoolWithUser extends PoolInfo {
  pairId: `0x${string}`;
  userLP: bigint;
  userShare: number;
}
