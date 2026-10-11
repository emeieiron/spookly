import type { Address } from "viem"
import { appNetwork } from "../config/network.mjs"
import { MONAD_DOMAIN } from "./chain"

export type Network = {
  chainId: number
  name: string
  domain: number
  usdc: Address
  explorer: string
}

// Native USDC and CCTP domains: developers.circle.com/stablecoins/usdc-contract-addresses
export const NETWORKS: Network[] = appNetwork.payouts as Network[]

export const networkByChainId = (chainId: number) =>
  NETWORKS.find((n) => n.chainId === chainId)
export const isLocal = (network: Network) => network.domain === MONAD_DOMAIN
