import { parseEther, type Address, type Hex } from "viem"
import { chequeBookAbi, factoryAbi } from "./abi"
import { publicClient } from "./cheque-payment"
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
  `pippo:cheque:${owner}:${signer}`
export const storedKey = (owner: Address, signer: Address) => {
  try {
    return localStorage.getItem(keyStorage(owner, signer)) as Hex | null
  } catch {
    return null
  }
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
  const live = c.active && !expired && c.remaining > 0n
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
