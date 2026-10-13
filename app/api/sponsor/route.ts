import { IS_MAINNET } from "@/lib/chain"
import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import { getAddress, recoverMessageAddress, type Hex } from "viem"
import {
  SPONSOR_CAIP2,
  SPONSOR_REQUEST_TTL,
  sponsorRequest,
  sponsorProofMessage,
} from "@/lib/sponsorship"
import { authenticatedSponsorUser, serverPrivy } from "@/lib/server/privy"
import {
  parseSponsorTransaction,
  sponsorApproval,
  sponsorLimits,
  validateSponsorTransaction,
  sponsorClient,
} from "@/lib/server/sponsor-policy"
import {
  readSponsor,
  reserveSponsor,
  saveSponsor,
  sponsorStoreConfigured,
} from "@/lib/server/sponsor-store"
import {
  SponsorFundingError,
  reserveShortfall,
  reserveMessage,
} from "@/lib/monad-reserve"
import {
  canRetryCheque,
  sameChequeTransaction,
  pendingCheque,
} from "@/lib/server/sponsor-recovery"

export const runtime = "nodejs"
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } })
const configured = () =>
  !IS_MAINNET && !!process.env.PRIVY_APP_SECRET && sponsorStoreConfigured()

export async function POST(request: Request) {
  // A disabled or unavailable sponsor preserves the existing self-funded path.
  if (!configured()) return json({ sponsored: false })
  if (Number(request.headers.get("content-length") ?? 0) > 25_000)
    return json({ error: "Request too large." }, 413)
  let submitted = false
  try {
    const raw = await request.text()
    if (raw.length > 25_000) return json({ error: "Request too large." }, 413)
    const input = JSON.parse(raw)
    // The kill switch stops new reservations; submitted transactions remain recoverable.
    if (
      input.phase === "prepare" &&
      process.env.PRIVY_GAS_SPONSORSHIP !== "true"
    )
      return json({ sponsored: false })
    const { user, wallets } = await authenticatedSponsorUser(request)
    if (input.phase === "prepare") {
      if (input.retryOf !== null && typeof input.retryOf !== "string")
        return json({ error: "Invalid request." }, 400)
      const tx = parseSponsorTransaction(input.transaction)
      const wallet = wallets.find(
        (w) =>
          w.id === input.walletId &&
          w.chain_type === "ethereum" &&
          getAddress(w.address) === tx.from
      )
      if (!wallet?.id)
        return json({ error: "Wallet does not belong to this account." }, 403)
      if (input.retryOf !== null) {
        const previous = await readSponsor(input.retryOf)
        if (
          !previous ||
          previous.userId !== user.id ||
          previous.walletId !== wallet.id ||
          !previous.transactionId ||
          !sameChequeTransaction(previous, tx) ||
          !(await canRetryCheque(
            previous,
            await serverPrivy().transactions().get(previous.transactionId)
          ))
        )
          return json(
            { error: "This transaction cannot be safely retried yet." },
            409
          )
      }
      if (!(await validateSponsorTransaction(tx)))
        return json({ sponsored: false })
      const id = randomUUID()
      const expiresAt = Date.now() + SPONSOR_REQUEST_TTL
      const record = {
        userId: user.id,
        walletId: wallet.id,
        walletAddress: tx.from,
        expiresAt,
        retryOf: input.retryOf as string | null,
        request: sponsorRequest(
          process.env.NEXT_PUBLIC_PRIVY_APP_ID!,
          wallet.id,
          id,
          tx,
          expiresAt,
          sponsorApproval(tx)
        ),
      }
      if (!(await reserveSponsor(id, record, sponsorLimits)))
        return json({ sponsored: false })
      return json({ sponsored: true, id, request: record.request })
    }
    if (
      input.phase !== "submit" ||
      typeof input.id !== "string" ||
      typeof input.signature !== "string" ||
      typeof input.walletSignature !== "string" ||
      !/^0x[\da-f]{130}$/i.test(input.walletSignature) ||
      input.signature.length > 4096
    )
      return json({ error: "Invalid request." }, 400)
    const record = await readSponsor(input.id)
    if (
      !record ||
      record.userId !== user.id ||
      !wallets.some((w) => w.id === record.walletId)
    )
      return json({ error: "Unknown sponsorship request." }, 404)
    if (record.transactionId)
      return json({ transactionId: record.transactionId })
    if (Date.now() > record.expiresAt)
      return json(
        {
          error:
            "This sponsorship request expired. Check your wallet before trying again.",
        },
        409
      )
    const signer = await recoverMessageAddress({
      message: sponsorProofMessage(record.request),
      signature: input.walletSignature as Hex,
    })
    if (getAddress(signer) !== getAddress(record.walletAddress))
      return json({ error: "Wallet authorization is required." }, 403)
    // The client authorizes this exact, expiring request. The server cannot alter it or sign offline.
    submitted = true
    const response = await fetch(record.request.url, {
      method: "POST",
      headers: {
        ...record.request.headers,
        "privy-authorization-signature": input.signature,
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${process.env.NEXT_PUBLIC_PRIVY_APP_ID}:${process.env.PRIVY_APP_SECRET}`).toString("base64")}`,
      },
      body: JSON.stringify(record.request.body),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    })
    const result = await response.json()
    if (!response.ok)
      return json(
        {
          error:
            "Wallet submission was not confirmed. Check this transaction before trying again.",
        },
        502
      )
    const transactionId = result.data?.transaction_id
    if (typeof transactionId !== "string")
      throw new Error("Missing transaction id.")
    await saveSponsor(input.id, { ...record, transactionId })
    return json({ transactionId })
  } catch (error) {
    if (!submitted && error instanceof SponsorFundingError)
      return json({ blocked: true, error: error.message }, 422)
    // Only pre-submission failures can safely fall back to a normal transaction.
    return submitted
      ? json(
          {
            error:
              "Your transaction may still be processing. Try again to check it.",
          },
          503
        )
      : json(
          { error: "Wallet sponsorship is unavailable. Please try again." },
          503
        )
  }
}

export async function GET(request: Request) {
  if (!configured())
    return json({ error: "Wallet sponsorship is unavailable." }, 503)
  try {
    const { user } = await authenticatedSponsorUser(request)
    const record = await readSponsor(
      new URL(request.url).searchParams.get("id") ?? ""
    )
    if (!record || record.userId !== user.id)
      return json({ error: "Unknown transaction." }, 404)
    if (!record.transactionId) return json({ status: "pending" })
    const tx = await serverPrivy().transactions().get(record.transactionId)
    if (tx.wallet_id !== record.walletId || tx.caip2 !== SPONSOR_CAIP2)
      return json({ error: "Unexpected transaction network." }, 502)
    if (
      !tx.transaction_hash &&
      ["broadcasted", "pending", "provider_error"].includes(tx.status)
    ) {
      const cheque = pendingCheque(record)
      if (cheque) {
        const shortfall = reserveShortfall(
          await sponsorClient.getBalance({
            address: getAddress(record.walletAddress),
          }),
          BigInt(cheque.call.value)
        )
        // This describes a current execution blocker, not proof the provider
        // dropped the operation. Preserve the request and cheque draft.
        if (shortfall > 0n)
          return json({
            status: tx.status,
            hash: tx.transaction_hash,
            blocked: true,
            error: reserveMessage(shortfall),
          })
      }
    }
    return json({
      status: tx.status,
      hash: tx.transaction_hash,
      retryable: await canRetryCheque(record, tx),
    })
  } catch {
    return json({ error: "Unable to check the transaction yet." }, 503)
  }
}
