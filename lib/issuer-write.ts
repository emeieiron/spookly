import {
  encodeFunctionData,
  formatUnits,
  type Address,
  type Hash,
  type Hex,
} from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { chequeBookAbi, factoryAbi } from "./abi"
import { FEE_ALLOWANCE, keyStorage, type Book } from "./cheque-book"
import { FACTORY, monad } from "./chain"
import { publicClient } from "./cheque-payment"
import { sealChequeKey, type LinkVault } from "./link-vault"
import { NO_PERMIT, signPermit } from "./permit"
import { sendChecked, type SignerClient } from "./wallet-send"

export function pendingWriteDraft(
  account: string
): { amount: string; days: number } | null {
  try {
    const saved = JSON.parse(
      localStorage.getItem(
        `pippo:write:${monad.id}:${account.toLowerCase()}`
      ) ?? "null"
    )
    if (
      !saved ||
      !/^\d+$/.test(saved.amount) ||
      ![1, 7, 30].includes(saved.days)
    )
      return null
    return { amount: formatUnits(BigInt(saved.amount), 6), days: saved.days }
  } catch {
    return null
  }
}

type PendingWrite = { amount: string; days: number; key: Hex; hash?: Hash }
// Keep the same signer across funding, rejected signatures and uncertain receipts.
export async function writeCheque(
  wallet: { account: Address; client: SignerClient; book: Book | null },
  amount: bigint,
  days: number,
  vault: LinkVault | null
) {
  if (!FACTORY) throw new Error("Cheque creation is unavailable right now.")
  const { account, client, book } = wallet
  const storage = `pippo:write:${monad.id}:${account.toLowerCase()}`
  const saved = localStorage.getItem(storage)
  const pending: PendingWrite = saved
    ? JSON.parse(saved)
    : { amount: amount.toString(), days, key: generatePrivateKey() }
  if (pending.amount !== amount.toString() || pending.days !== days)
    throw new Error(
      "Finish the previous cheque before changing its amount or expiry."
    )
  const signer = privateKeyToAccount(pending.key).address
  localStorage.setItem(storage, JSON.stringify(pending))
  localStorage.setItem(keyStorage(account, signer), pending.key)
  const exists = book?.cheques.some(
    (c) => c.signer.toLowerCase() === signer.toLowerCase()
  )
  if (!exists && pending.hash) {
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: pending.hash,
    })
    if (receipt.status !== "success") {
      delete pending.hash
      localStorage.setItem(storage, JSON.stringify(pending))
      throw new Error(
        "The cheque transaction failed. Your funds remain available; try again."
      )
    }
  } else if (!exists) {
    const pull =
      amount > (book?.available ?? 0n) ? amount - (book?.available ?? 0n) : 0n
    const spareGas = book?.spareGas ?? 0n
    const topUp = FEE_ALLOWANCE > spareGas ? FEE_ALLOWANCE - spareGas : 0n
    const permit =
      pull > 0n
        ? await signPermit(client, book?.address ?? FACTORY, pull)
        : NO_PERMIT
    const sealed = vault ? await sealChequeKey(vault, pending.key) : "0x"
    const expiry = BigInt(Math.floor(Date.now() / 1000) + days * 86400)
    await sendChecked(
      client,
      book?.address ?? FACTORY,
      book
        ? encodeFunctionData({
            abi: chequeBookAbi,
            functionName: "fundAndWrite",
            args: [signer, amount, expiry, FEE_ALLOWANCE, pull, permit, sealed],
          })
        : encodeFunctionData({
            abi: factoryAbi,
            functionName: "createAndWrite",
            args: [signer, amount, expiry, FEE_ALLOWANCE, permit, sealed],
          }),
      topUp,
      (hash) => {
        pending.hash = hash
        localStorage.setItem(storage, JSON.stringify(pending))
      }
    )
  }
  const bookAddress =
    book?.address ??
    (await publicClient.readContract({
      address: FACTORY,
      abi: factoryAbi,
      functionName: "bookOf",
      args: [account],
    }))
  localStorage.removeItem(storage)
  return { signer, bookAddress, key: pending.key }
}
