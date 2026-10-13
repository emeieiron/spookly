import { parseEther, type Hex } from "viem"
import { formatMon } from "./money"

// Monad's reserve applies to native value spent by EIP-7702 accounts, even
// when another account sponsors their transaction gas.
export const MONAD_DELEGATED_RESERVE = parseEther("10")
export const isDelegated = (code?: Hex) =>
  /^0xef0100[\da-f]{40}$/i.test(code ?? "")

export function reserveShortfall(balance: bigint, value: bigint) {
  if (value === 0n) return 0n
  const required = MONAD_DELEGATED_RESERVE + value
  return required > balance ? required - balance : 0n
}

export function reserveMessage(shortfall: bigint) {
  const precision = 100_000_000_000_000n
  const roundedUp = ((shortfall + precision - 1n) / precision) * precision
  return `Add at least ${formatMon(roundedUp)} to cover the cheque fee allowance. Monad requires this wallet to retain 10 MON.`
}

export class SponsorFundingError extends Error {}
