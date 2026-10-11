import { type Address, type Hex, type Hash } from "viem"

export type WriteDraft = {
  key: Hex
  signer: Address
  amount: string
  days: number
  to: Address
  data: Hex
  value: string
  pull: string
  hash?: Hash
}
const storageKey = (owner: Address) =>
  `pippo:write:10143:${owner.toLowerCase()}`
export const readWriteDraft = (owner: Address): WriteDraft | null =>
  JSON.parse(localStorage.getItem(storageKey(owner)) ?? "null")
export const saveWriteDraft = (owner: Address, draft: WriteDraft) =>
  localStorage.setItem(storageKey(owner), JSON.stringify(draft))
export const clearWriteDraft = (owner: Address) =>
  localStorage.removeItem(storageKey(owner))
