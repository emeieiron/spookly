import { formatUnits, parseUnits } from "viem"

export const formatUsdc = (value: bigint) =>
  "$" +
  Number(formatUnits(value, 6)).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

export function parseUsdc(input: string): bigint | null {
  const trimmed = input.trim().replace(/^\$/, "")
  if (!/^\d+(\.\d{0,6})?$/.test(trimmed)) return null
  const value = parseUnits(trimmed, 6)
  return value > 0n ? value : null
}

export const formatMon = (value: bigint) =>
  Number(formatUnits(value, 18)).toLocaleString("en-US", {
    maximumFractionDigits: 4,
  }) + " MON"

export const shortAddress = (address: string) =>
  `${address.slice(0, 6)}…${address.slice(-4)}`
