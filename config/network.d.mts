export type NetworkProfile = {
  name: "mainnet" | "testnet"
  chainId: number
  chainName: string
  rpc: string
  tokenMessenger: string
  messageTransmitter: string
  iris: string
  payouts: {
    chainId: number
    name: string
    domain: number
    usdc: string
    explorer: string
  }[]
}
export function selectNetwork(value?: string): NetworkProfile
export const appNetwork: NetworkProfile
export const deployment: {
  chainId: number
  factory: string | null
  blockNumber: string | number | null
  transactionHash: string | null
}
export function bundlerEndpoint(
  env?: Record<string, string | undefined>
): string | null
