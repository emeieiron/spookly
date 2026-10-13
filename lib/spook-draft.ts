import { type Address, type Hex, type Hash } from "viem"
import { monad } from "./chain"

export type SpookDraft = {
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
  `spookly:spook:${monad.id}:${owner.toLowerCase()}`
export const readSpookDraft = (owner: Address): SpookDraft | null =>
  JSON.parse(localStorage.getItem(storageKey(owner)) ?? "null")
export const saveSpookDraft = (owner: Address, draft: SpookDraft) =>
  localStorage.setItem(storageKey(owner), JSON.stringify(draft))
export const clearSpookDraft = (owner: Address) =>
  localStorage.removeItem(storageKey(owner))
