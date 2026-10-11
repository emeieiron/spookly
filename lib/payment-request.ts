import { getAddress, isAddress, type Address } from "viem"
import { networkByChainId } from "./networks"

export type PaymentRequest = {
  recipient: Address
  chainId?: number
  amount?: bigint
  // The QR asks for a token other than USDC on its network.
  wrongToken?: boolean
}

// EIP-681 amounts may use scientific notation, e.g. uint256=2.5e6.
function parseInteger(value: string): bigint | null {
  const match = value.match(/^(\d+)(?:\.(\d+))?(?:e(\d+))?$/i)
  if (!match) return null
  const [, whole, fraction = "", exponent = "0"] = match
  const digits = whole + fraction
  const shift = Number(exponent) - fraction.length
  if (shift >= 0) return BigInt(digits) * 10n ** BigInt(shift)
  // Fractional base units are invalid unless the dropped digits are zeros.
  const kept = digits.slice(0, shift)
  return /^0*$/.test(digits.slice(shift)) ? BigInt(kept || "0") : null
}

export function parsePaymentRequest(raw: string): PaymentRequest | null {
  const text = raw.trim()
  if (isAddress(text, { strict: false })) return { recipient: getAddress(text) }

  // ethereum:[pay-]<target>[@chainId][/function]?params
  const match = text.match(
    /^ethereum:(?:pay-)?(0x[0-9a-fA-F]{40})(?:@(\d+))?(?:\/(\w+))?(?:\?(.*))?$/
  )
  if (!match) return null
  const [, target, chain, fn, query = ""] = match
  const params = new URLSearchParams(query)
  const chainId = chain ? Number(chain) : undefined

  if (fn === "transfer") {
    const recipient = params.get("address")
    if (!recipient || !isAddress(recipient, { strict: false })) return null
    const amount = params.get("uint256")
      ? parseInteger(params.get("uint256")!)
      : null
    const network = chainId ? networkByChainId(chainId) : undefined
    return {
      recipient: getAddress(recipient),
      chainId,
      amount: amount ?? undefined,
      wrongToken: network
        ? getAddress(target) !== getAddress(network.usdc)
        : undefined,
    }
  }
  if (fn) return null
  // A plain native-currency request: use the address but let the payer enter a USDC amount.
  return { recipient: getAddress(target), chainId }
}
