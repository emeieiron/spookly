import type { Address } from "viem"
import { MONAD_DOMAIN, USDC } from "./chain"

export type Network = {
  chainId: number
  name: string
  domain: number
  usdc: Address
  explorer: string
}

// Circle testnet USDC and CCTP domains: developers.circle.com/stablecoins/usdc-contract-addresses
export const NETWORKS: Network[] = [
  {
    chainId: 10143,
    name: "Monad",
    domain: MONAD_DOMAIN,
    usdc: USDC,
    explorer: "https://testnet.monadexplorer.com",
  },
  {
    chainId: 84532,
    name: "Base",
    domain: 6,
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    explorer: "https://sepolia.basescan.org",
  },
  {
    chainId: 421614,
    name: "Arbitrum",
    domain: 3,
    usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    explorer: "https://sepolia.arbiscan.io",
  },
  {
    chainId: 11155420,
    name: "Optimism",
    domain: 2,
    usdc: "0x5fd84259d66Cd46123540766Be93DFE6D43130D7",
    explorer: "https://sepolia-optimism.etherscan.io",
  },
  {
    chainId: 80002,
    name: "Polygon",
    domain: 7,
    usdc: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
    explorer: "https://amoy.polygonscan.com",
  },
  {
    chainId: 43113,
    name: "Avalanche",
    domain: 1,
    usdc: "0x5425890298aed601595a70AB815c96711a31Bc65",
    explorer: "https://testnet.snowtrace.io",
  },
  {
    chainId: 1301,
    name: "Unichain",
    domain: 10,
    usdc: "0x31d0220469e10c4E71834a79b1f276d740d3768F",
    explorer: "https://sepolia.uniscan.xyz",
  },
  {
    chainId: 59141,
    name: "Linea",
    domain: 11,
    usdc: "0xFEce4462D57bD51A6A552365A011b95f0E16d9B7",
    explorer: "https://sepolia.lineascan.build",
  },
  {
    chainId: 4801,
    name: "World Chain",
    domain: 14,
    usdc: "0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88",
    explorer: "https://worldchain-sepolia.explorer.alchemy.com",
  },
  {
    chainId: 11155111,
    name: "Ethereum",
    domain: 0,
    usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    explorer: "https://sepolia.etherscan.io",
  },
]

export const networkByChainId = (chainId: number) =>
  NETWORKS.find((n) => n.chainId === chainId)
export const isLocal = (network: Network) => network.domain === MONAD_DOMAIN
