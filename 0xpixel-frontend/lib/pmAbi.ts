// PMining contract ABI
// Contract: 0x37672fE781D51278D673E9B78F13EBC2f514Cb92

export const PMiningAbi = [
  {
    type: "constructor",
    inputs: [
      { internalType: "address", name: "_nToken", type: "address" },
      { internalType: "address", name: "_nftContract", type: "address" },
      { internalType: "address", name: "_devWallet", type: "address" },
    ],
    stateMutability: "nonpayable",
  },
  { type: "error", inputs: [{ internalType: "address", name: "owner", type: "address" }], name: "OwnableInvalidOwner" },
  { type: "error", inputs: [{ internalType: "address", name: "account", type: "address" }], name: "OwnableUnauthorizedAccount" },
  { type: "error", inputs: [], name: "ReentrancyGuardReentrantCall" },
  {
    type: "event",
    name: "OwnershipTransferred",
    inputs: [
      { indexed: true, internalType: "address", name: "previousOwner", type: "address" },
      { indexed: true, internalType: "address", name: "newOwner", type: "address" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RewardPoolDeposited",
    inputs: [{ indexed: false, internalType: "uint256", name: "amount", type: "uint256" }],
    anonymous: false,
  },
  {
    type: "event",
    name: "RigBought",
    inputs: [
      { indexed: true, internalType: "address", name: "buyer", type: "address" },
      { indexed: true, internalType: "uint256", name: "nftId", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "pricePaid", type: "uint256" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RigClaimed",
    inputs: [
      { indexed: true, internalType: "address", name: "user", type: "address" },
      { indexed: true, internalType: "uint256", name: "nftId", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "amount", type: "uint256" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RigDeposited",
    inputs: [{ indexed: true, internalType: "uint256", name: "nftId", type: "uint256" }],
    anonymous: false,
  },
  {
    type: "event",
    name: "RigUpgraded",
    inputs: [
      { indexed: true, internalType: "uint256", name: "nftId", type: "uint256" },
      { indexed: false, internalType: "uint8", name: "newLevel", type: "uint8" },
    ],
    anonymous: false,
  },
  {
    type: "function",
    name: "FIRST_MACHINE_PRICE",
    inputs: [],
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "NFTContract",
    inputs: [],
    outputs: [{ internalType: "contract IERC721", name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "NORMAL_MACHINE_PRICE",
    inputs: [],
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "NToken",
    inputs: [],
    outputs: [{ internalType: "contract IERC20", name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "buyRig",
    inputs: [{ internalType: "uint256", name: "nftId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "claimAllRigs",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "claimRig",
    inputs: [{ internalType: "uint256", name: "nftId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "depositRewardPool",
    inputs: [{ internalType: "uint256", name: "amount", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "depositRig",
    inputs: [{ internalType: "uint256", name: "nftId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "devWallet",
    inputs: [],
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getRigInfo",
    inputs: [{ internalType: "uint256", name: "nftId", type: "uint256" }],
    outputs: [
      { internalType: "address", name: "owner", type: "address" },
      { internalType: "uint8", name: "level", type: "uint8" },
      { internalType: "uint256", name: "dailyProduction", type: "uint256" },
      { internalType: "uint256", name: "nextClaimTime", type: "uint256" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getUserMachines",
    inputs: [{ internalType: "address", name: "user", type: "address" }],
    outputs: [{ internalType: "uint256[]", name: "", type: "uint256[]" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "isRigDeposited",
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "lastRigClaimTime",
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "levelProduction",
    inputs: [{ internalType: "uint8", name: "", type: "uint8" }],
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "levelUpgradeCost",
    inputs: [{ internalType: "uint8", name: "", type: "uint8" }],
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "owner",
    inputs: [],
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "renounceOwnership",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "rigLevel",
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    outputs: [{ internalType: "uint8", name: "", type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "rigOwner",
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalRewardPool",
    inputs: [],
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "transferOwnership",
    inputs: [{ internalType: "address", name: "newOwner", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "upgradeRig",
    inputs: [{ internalType: "uint256", name: "nftId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "userRigCount",
    inputs: [{ internalType: "address", name: "", type: "address" }],
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "withdrawDevFees",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

export interface RigInfo {
  owner: `0x${string}`;
  level: number;
  dailyProduction: bigint;
  nextClaimTime: bigint;
}

export interface UserRig {
  nftId: bigint;
  level: number;
  dailyProduction: bigint;
  nextClaimTime: bigint;
  canClaim: boolean;
  isOwner: boolean;
}
