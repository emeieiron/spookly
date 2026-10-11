import { type Hash } from "viem"
import { type SponsorRequest, type SponsorTransaction } from "./sponsorship"

export type PendingSponsor = {
  id: string
  request: SponsorRequest
  transaction: SponsorTransaction
  signature: string
  walletSignature: Hash
  hash?: Hash
}
const key = (address: string) => `pippo:sponsor:10143:${address.toLowerCase()}`
export const readPendingSponsor = (address: string): PendingSponsor | null =>
  JSON.parse(localStorage.getItem(key(address)) ?? "null")
export const savePendingSponsor = (address: string, pending: PendingSponsor) =>
  localStorage.setItem(key(address), JSON.stringify(pending))
export const clearPendingSponsor = (address: string) =>
  localStorage.removeItem(key(address))
export function acknowledgeSponsor(address: string, hash: Hash) {
  if (readPendingSponsor(address)?.hash === hash) clearPendingSponsor(address)
}
