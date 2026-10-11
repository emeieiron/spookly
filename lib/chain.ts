import { defineChain, type Address } from "viem"
import { appNetwork, deployment } from "../config/network.mjs"

export const ENTRY_POINT: Address = "0x0000000071727De22E5E9d8BAf0edAc6f37da032"
export const USDC = appNetwork.payouts[0].usdc as Address
export const TOKEN_MESSENGER = appNetwork.tokenMessenger as Address
export const FACTORY = deployment.factory as Address | null
export const MONAD_DOMAIN = 15
export const IRIS_API = appNetwork.iris
export const EXPLORER = appNetwork.payouts[0].explorer
export const IS_MAINNET = appNetwork.name === "mainnet"
export const monad = defineChain({
  id: appNetwork.chainId,
  name: appNetwork.chainName,
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_MONAD_RPC_URL ?? appNetwork.rpc],
    },
  },
  blockExplorers: { default: { name: "Monad Explorer", url: EXPLORER } },
  testnet: !IS_MAINNET,
})

export const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "a", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const
