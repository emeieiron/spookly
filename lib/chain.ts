import { defineChain, type Address } from "viem"
import deployment from "./deployment.json"

export const ENTRY_POINT: Address = "0x0000000071727De22E5E9d8BAf0edAc6f37da032"
export const USDC: Address = "0x534b2f3A21130d7a60830c2Df862319e593943A3"
export const TOKEN_MESSENGER: Address =
  "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA"
export const FACTORY = deployment.factory as Address | null
export const MONAD_DOMAIN = 15
export const IRIS_API = "https://iris-api-sandbox.circle.com"
export const EXPLORER = "https://testnet.monadexplorer.com"

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        process.env.NEXT_PUBLIC_MONAD_RPC_URL ??
          "https://testnet-rpc.monad.xyz",
      ],
    },
  },
  blockExplorers: { default: { name: "Monad Explorer", url: EXPLORER } },
  testnet: true,
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
