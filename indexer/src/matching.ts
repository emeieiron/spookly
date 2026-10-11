import profiles from "../../config/networks.json" with { type: "json" }
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
// Read the config actually passed to Envio. Never infer mainnet from an unrelated shell environment.
const configFile = process.env.ENVIO_CONFIG
  ? resolve(process.env.ENVIO_CONFIG)
  : new URL("../config.yaml", import.meta.url)
const config = readFileSync(configFile, "utf8")
const profile = config.includes("name: pippo-mainnet")
  ? profiles.mainnet
  : profiles.testnet
export const MONAD_CHAIN = profile.chainId
export const MONAD_DOMAIN = 15
export const STATS_ID = `global-${MONAD_CHAIN}`
export const MONAD_TOKEN_MESSENGER = profile.tokenMessenger.toLowerCase()
export const DOMAIN_BY_CHAIN: Record<number, number> = Object.fromEntries(
  profile.payouts.map((n) => [n.chainId, n.domain])
)
export const CHAIN_BY_DOMAIN = Object.fromEntries(
  Object.entries(DOMAIN_BY_CHAIN).map(([chain, domain]) => [
    domain,
    Number(chain),
  ])
) as Record<number, number>

// A burn and its mint agree on who burned, where it goes, to whom and how much.
export const matchKey = (
  sender: string,
  domain: number,
  recipient: string,
  burned: bigint
) => `${sender.toLowerCase()}-${domain}-${recipient.toLowerCase()}-${burned}`

// bytes32 → address, as CCTP pads recipients and senders.
export const toAddress = (word: string) => `0x${word.slice(-40)}`.toLowerCase()

// BurnMessageV2: version (4) | burnToken (32) | mintRecipient (32) | amount (32) | messageSender (32) |
// maxFee (32) | feeExecuted (32) | expirationBlock (32) | hookData
export function parseBurnMessage(body: string) {
  const hex = body.startsWith("0x") ? body.slice(2) : body
  if (hex.length < 228 * 2) return null
  const word = (start: number) => hex.slice(start * 2, (start + 32) * 2)
  return {
    recipient: toAddress(word(36)),
    burned: BigInt(`0x${word(68)}`),
    sender: toAddress(word(100)),
    feeExecuted: BigInt(`0x${word(164)}`),
  }
}

export const eventId = (chainId: number, txHash: string, logIndex: number) =>
  `${chainId}-${txHash}-${logIndex}`
