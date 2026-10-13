import { decodeFunctionData, getAddress, type Address } from "viem"
import { chequeBookAbi, factoryAbi } from "../abi"
import { FACTORY } from "../chain"
import {
  SPONSOR_CAIP2,
  SPONSOR_REQUEST_TTL,
  type SponsorTransaction,
} from "../sponsorship"
import { sponsorClient } from "./sponsor-policy"
import { type SponsorRecord } from "./sponsor-store"

export const SPONSOR_RETRY_DELAY = 2 * 60_000

export function pendingCheque(record: SponsorRecord) {
  const call = record.request.body.params.calls.at(-1)
  if (!call) return null
  try {
    const factory = FACTORY && getAddress(call.to) === getAddress(FACTORY)
    const decoded = factory
      ? decodeFunctionData({ abi: factoryAbi, data: call.data })
      : decodeFunctionData({ abi: chequeBookAbi, data: call.data })
    if (
      decoded.functionName !== "createAndWrite" &&
      decoded.functionName !== "fundAndWrite"
    )
      return null
    return { signer: decoded.args[0] as Address, factory: !!factory, call }
  } catch {
    return null
  }
}

export async function canRetryCheque(
  record: SponsorRecord,
  tx: {
    wallet_id: string
    caip2: string
    status: string
    transaction_hash: string | null
  },
  now = Date.now()
) {
  if (
    tx.wallet_id !== record.walletId ||
    tx.caip2 !== SPONSOR_CAIP2 ||
    tx.transaction_hash ||
    ![
      "broadcasted",
      "pending",
      "provider_error",
      "failed",
      "execution_reverted",
    ].includes(tx.status) ||
    now < record.expiresAt - SPONSOR_REQUEST_TTL + SPONSOR_RETRY_DELAY
  )
    return false
  const cheque = pendingCheque(record)
  if (!cheque) return false
  if (cheque.factory) {
    const book = await sponsorClient.readContract({
      address: FACTORY!,
      abi: factoryAbi,
      functionName: "bookOf",
      args: [getAddress(record.walletAddress)],
    })
    return book === "0x0000000000000000000000000000000000000000"
  }
  const [owner, existing] = await Promise.all([
    sponsorClient.readContract({
      address: cheque.call.to,
      abi: chequeBookAbi,
      functionName: "owner",
    }),
    sponsorClient.readContract({
      address: cheque.call.to,
      abi: chequeBookAbi,
      functionName: "cheques",
      args: [cheque.signer],
    }),
  ])
  // expiry remains nonzero after cancellation. A key is never writable twice.
  return (
    getAddress(owner) === getAddress(record.walletAddress) && existing[1] === 0n
  )
}

export function sameChequeTransaction(
  record: SponsorRecord,
  tx: SponsorTransaction
) {
  const cheque = pendingCheque(record)
  return (
    !!cheque &&
    getAddress(record.walletAddress) === tx.from &&
    getAddress(cheque.call.to) === tx.to &&
    cheque.call.data.toLowerCase() === tx.data.toLowerCase() &&
    BigInt(cheque.call.value) === BigInt(tx.value)
  )
}
