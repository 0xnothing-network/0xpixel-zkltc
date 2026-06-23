import { erc20Abi } from "viem";

export const NUSD_ABI = [
  ...erc20Abi,
  {
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "mint",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "amount", type: "uint256" }],
    name: "burn",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "from", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "burnFrom",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "from", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "burnByOwner",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export const NUSD_ADDRESS = process.env.NEXT_PUBLIC_NUSD_ADDRESS || "0xC1F96C07D3EAbd25b080522aE85DaaA978192EC0";
