import { isHex, parseEther, type Address, type Hex } from "viem"
import { privateKeyToAddress } from "viem/accounts"
import { monad, IS_MAINNET } from "./chain"
import { chequeBookAbi, factoryAbi } from "./abi"
import { publicClient } from "./cheque-payment"
import { openChequeKey, sealedKeyId, type LinkVault } from "./link-vault"
import { formatUsdc } from "./money"

export const FEE_ALLOWANCE = parseEther("0.3")
export const DAYS = [1, 7, 30]
const ZERO = "0x0000000000000000000000000000000000000000"

export type Cheque = {
  signer: Address
  amount: bigint
  remaining: bigint
  expiry: number
  active: boolean
  gasLeft: bigint
  sealedKey: Hex
}
export type Book = {
  address: Address
  available: bigint
  spareGas: bigint
  cheques: Cheque[]
}

export const keyStorage = (owner: Address, signer: Address) =>
  IS_MAINNET
    ? `pippo:cheque:${monad.id}:${owner}:${signer}`
    : `pippo:cheque:${owner}:${signer}`
// A stored key counts only if it still controls the cheque's signer.
export const storedKey = (owner: Address, signer: Address): Hex | null => {
  try {
    const key = localStorage.getItem(keyStorage(owner, signer))
    return key && isHex(key) && privateKeyToAddress(key) === signer ? key : null
  } catch {
    return null
  }
}

export const isLive = (c: Cheque, now: number) =>
  c.active && c.remaining > 0n && c.expiry * 1000 > now

export type Links = {
  // Keys of live cheques, from this device or opened from their sealed copies.
  keys: Partial<Record<Address, Hex>>
  // Live cheques sealed with a passkey this device hasn't unlocked.
  locked: { signer: Address; id: Hex }[]
  // Every passkey id sealed into the book.
  ids: Hex[]
}

export async function readLinks(
  owner: Address,
  cheques: Cheque[],
  vault: LinkVault | null,
  now: number
): Promise<Links> {
  const links: Links = { keys: {}, locked: [], ids: [] }
  for (const c of cheques) {
    const id = sealedKeyId(c.sealedKey)
    if (id && !links.ids.includes(id)) links.ids.push(id)
    if (!isLive(c, now)) continue
    const local = storedKey(owner, c.signer)
    const key =
      local ??
      (vault && id === vault.id
        ? await openChequeKey(vault, c.sealedKey, c.signer)
        : null)
    if (key) {
      links.keys[c.signer] = key
      if (!local)
        try {
          localStorage.setItem(keyStorage(owner, c.signer), key)
        } catch {}
    } else if (id && id !== vault?.id)
      links.locked.push({ signer: c.signer, id })
  }
  return links
}

// Keys with a sealed copy can come back with the passkey, so signing out leaves none of them on this device.
export function forgetSealedKeys(owner: Address, cheques: Cheque[]) {
  for (const c of cheques)
    if (sealedKeyId(c.sealedKey))
      try {
        localStorage.removeItem(keyStorage(owner, c.signer))
      } catch {}
}

export async function readBook(
  factory: Address,
  owner: Address
): Promise<Book | null> {
  const address = await publicClient.readContract({
    address: factory,
    abi: factoryAbi,
    functionName: "bookOf",
    args: [owner],
  })
  if (address === ZERO) return null
  const read = <
    N extends "available" | "committedGas" | "gasBalance" | "chequeCount",
  >(
    functionName: N
  ) =>
    publicClient.readContract({
      address,
      abi: chequeBookAbi,
      functionName,
    }) as Promise<bigint>
  const [available, committed, gas, count] = await Promise.all([
    read("available"),
    read("committedGas"),
    read("gasBalance"),
    read("chequeCount"),
  ])
  const cheques = await publicClient.readContract({
    address,
    abi: chequeBookAbi,
    functionName: "list",
    args: [0n, count],
  })
  return {
    address,
    available,
    spareGas: gas > committed ? gas - committed : 0n,
    cheques: cheques.map((c) => ({ ...c, expiry: Number(c.expiry) })).reverse(),
  }
}

export function describe(c: Cheque, now: number) {
  const expired = c.expiry * 1000 <= now
  const live = isLive(c, now)
  const spent = c.amount - c.remaining
  const date = new Date(c.expiry * 1000).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  })
  const status = !c.active
    ? spent > 0n
      ? `Cancelled · ${formatUsdc(spent)} spent`
      : "Cancelled"
    : expired
      ? `Expired · ${formatUsdc(c.remaining)} unclaimed`
      : c.remaining === 0n
        ? "Spent"
        : spent > 0n
          ? `${formatUsdc(c.remaining)} left · until ${date}`
          : `until ${date}`
  return { live, expired, spent, status }
}
