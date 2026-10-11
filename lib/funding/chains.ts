import {
  arbitrum,
  avalanche,
  base,
  bsc,
  mainnet,
  optimism,
  polygon,
  unichain,
} from "viem/chains"
import { monad, IS_MAINNET } from "../chain"
import { type Chain } from "viem"

// Deposit chains are funding sources, independent of the app's single Monad environment.
export const SOURCE_CHAINS: Record<string, Chain> = {
  eth: mainnet,
  ethereum: mainnet,
  base,
  arb: arbitrum,
  arbitrum,
  op: optimism,
  optimism,
  polygon,
  pol: polygon,
  avax: avalanche,
  avalanche,
  bsc,
  unichain,
  monad,
}
export function sourceChain(token: { blockchain: string }) {
  return SOURCE_CHAINS[token.blockchain]
}

// Privy must permit source transfers, while Monad remains the single app network.
export const WALLET_CHAINS: [Chain, ...Chain[]] = [
  monad,
  ...(IS_MAINNET
    ? [
        ...new Map(
          Object.values(SOURCE_CHAINS).map((chain) => [chain.id, chain])
        ).values(),
      ].filter((chain) => chain.id !== monad.id)
    : []),
]
