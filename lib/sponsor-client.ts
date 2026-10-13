import { getAddress, toHex, type Hash } from "viem"
import {
  SPONSOR_CHAIN_ID,
  sponsorProofMessage,
  type SponsorRequest,
  type SponsorTransaction,
} from "./sponsorship"
import { FinalTransactionError, type SponsorSender } from "./wallet-send"
import {
  readPendingSponsor,
  savePendingSponsor,
  clearPendingSponsor,
} from "./sponsor-pending"

const pendingMessage =
  "Your transaction is still being checked. Try again to check it before sending another."
type SponsorDependencies = {
  walletId?: string
  getAccessToken: () => Promise<string | null>
  generateAuthorizationSignature: (
    request: SponsorRequest
  ) => Promise<{ signature: string }>
}
export function createSponsorSender({
  walletId,
  getAccessToken,
  generateAuthorizationSignature,
}: SponsorDependencies): SponsorSender {
  const send: SponsorSender = async ({ client, from, to, data, value }) => {
    const tx: SponsorTransaction = {
      from: getAddress(from),
      to: getAddress(to),
      data,
      value: toHex(value),
    }
    let pending = readPendingSponsor(from)
    if (!walletId && !pending) return null
    if (pending && JSON.stringify(pending.transaction) !== JSON.stringify(tx))
      throw new Error(pendingMessage)
    if (pending?.hash) return pending.hash
    const token = await getAccessToken()
    if (!token) throw new Error("Please sign in again.")
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    }
    let retryOf: string | null = null
    if (pending) {
      const response = await fetch(
        `/api/sponsor?id=${encodeURIComponent(pending.id)}`,
        {
          headers,
          cache: "no-store",
          signal: AbortSignal.timeout(10_000),
        }
      )
      if (response.ok) {
        const status = await response.json()
        if (status.blocked) throw new Error(status.error ?? pendingMessage)
        if (status.retryable) retryOf = pending.id
      }
    }
    if (!pending || retryOf) {
      let response: Response
      try {
        response = await fetch("/api/sponsor", {
          method: "POST",
          signal: AbortSignal.timeout(10_000),
          headers,
          body: JSON.stringify({
            phase: "prepare",
            walletId,
            transaction: tx,
            retryOf,
          }),
        })
      } catch {
        if (pending) throw new Error(pendingMessage)
        return null
      } // No request has been signed or submitted yet.
      const prepared = await response.json().catch(() => null)
      if (prepared?.blocked) {
        if (pending) throw new Error(prepared.error)
        throw new FinalTransactionError(prepared.error)
      }
      if (!response.ok || !prepared?.sponsored) {
        if (pending) throw new Error(prepared?.error ?? pendingMessage)
        return null
      }
      if (
        prepared.request?.body?.caip2 !== `eip155:${SPONSOR_CHAIN_ID}` ||
        prepared.request?.url !==
          `https://api.privy.io/v1/wallets/${encodeURIComponent(walletId!)}/rpc`
      )
        throw new FinalTransactionError(
          "Unexpected sponsorship network or wallet."
        )
      let walletSignature: Hash, signature: string
      try {
        walletSignature = await client.signMessage({
          message: sponsorProofMessage(prepared.request),
        })
        ;({ signature } = await generateAuthorizationSignature(
          prepared.request
        ))
      } catch {
        if (pending) throw new Error(pendingMessage)
        throw new FinalTransactionError(
          "The wallet could not authorize this request. Please try again."
        )
      }
      pending = {
        id: prepared.id,
        request: prepared.request,
        transaction: tx,
        signature,
        walletSignature,
        previousIds: pending ? [...pending.previousIds, pending.id] : [],
      }
      // Persist before submission; retries always use the same provider idempotency key.
      savePendingSponsor(from, pending)
    }
    if (JSON.stringify(pending.transaction) !== JSON.stringify(tx))
      throw new Error(pendingMessage)
    if (pending.request.body.caip2 !== `eip155:${SPONSOR_CHAIN_ID}`)
      throw new Error("Unexpected sponsorship network.")
    const submitted = await fetch("/api/sponsor", {
      method: "POST",
      signal: AbortSignal.timeout(20_000),
      headers,
      body: JSON.stringify({
        phase: "submit",
        id: pending.id,
        signature: pending.signature,
        walletSignature: pending.walletSignature,
      }),
    })
    if (!submitted.ok) throw new Error(pendingMessage)
    // A submitted request must never fall back to a second, self-funded transaction.
    for (let attempt = 0; attempt < 80; attempt++) {
      const response = await fetch(
        `/api/sponsor?id=${encodeURIComponent(pending.id)}`,
        { headers, cache: "no-store", signal: AbortSignal.timeout(10_000) }
      )
      if (response.ok) {
        const status = await response.json()
        if (status.blocked) throw new Error(status.error ?? pendingMessage)
        if (["failed", "execution_reverted"].includes(status.status)) {
          // An older attempt for this same cheque may still execute. Retain
          // its draft until the unique cheque key is reconciled on-chain.
          if (pending.previousIds.length) throw new Error(pendingMessage)
          clearPendingSponsor(from)
          throw new FinalTransactionError(
            "The transaction failed. Please try again."
          )
        }
        if (/^0x[\da-f]{64}$/i.test(status.hash ?? "")) {
          savePendingSponsor(from, { ...pending, hash: status.hash })
          return status.hash as Hash
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
    throw new Error(pendingMessage)
  }
  // React state updates do not prevent a rapid second click; share the exact in-flight request.
  const running = new Map<
    string,
    { fingerprint: string; result: ReturnType<SponsorSender> }
  >()
  return (tx) => {
    const key = tx.from.toLowerCase()
    const fingerprint = `${tx.to.toLowerCase()}:${tx.data.toLowerCase()}:${tx.value}`
    const existing = running.get(key)
    if (existing)
      return existing.fingerprint === fingerprint
        ? existing.result
        : Promise.reject(new Error(pendingMessage))
    const result = send(tx).finally(() => running.delete(key))
    running.set(key, { fingerprint, result })
    return result
  }
}
