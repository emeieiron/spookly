import assert from "node:assert/strict"
import { after, beforeEach, mock, test } from "node:test"
import { encodeFunctionData, toHex } from "viem"
import { USDC, erc20Abi } from "./chain"
import { privateKeyToAccount } from "viem/accounts"
import { createSponsorSender } from "./sponsor-client"
import {
  acknowledgeSponsor,
  readPendingSponsor,
  readPendingTransfer,
  savePendingSponsor,
} from "./sponsor-pending"
import { sponsorRequest } from "./sponsorship"
import { FinalTransactionError, type SignerClient } from "./wallet-send"

const owner = privateKeyToAccount(toHex(1n, { size: 32 }))
const hash = toHex(3n, { size: 32 })
const requestId = "11111111-1111-4111-8111-111111111111"
const calls: { phase?: string; id?: string }[] = []
const storage = new Map<string, string>()
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
})
const transaction = {
  from: owner.address,
  to: owner.address,
  data: "0x12345678" as const,
  value: 0n,
  client: { signMessage: owner.signMessage } as unknown as SignerClient,
}
const sender = () =>
  createSponsorSender({
    walletId: "wallet",
    getAccessToken: async () => "token",
    generateAuthorizationSignature: async () => ({
      signature: "user-key-proof",
    }),
  })
const prepared = () =>
  Response.json({
    sponsored: true,
    id: requestId,
    request: sponsorRequest(
      "app",
      "wallet",
      requestId,
      {
        from: owner.address,
        to: owner.address,
        data: transaction.data,
        value: "0x0",
      },
      Date.now() + 60_000
    ),
  })

beforeEach(() => {
  storage.clear()
  calls.length = 0
  mock.restoreAll()
})
after(() => mock.restoreAll())

test("pending transfers restore the exact amount and recipient after reload", () => {
  const tx = {
    from: owner.address,
    to: USDC,
    value: "0x0" as const,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [owner.address, 10_000n],
    }),
  }
  savePendingSponsor(owner.address, {
    previousIds: [],
    id: requestId,
    transaction: tx,
    request: sponsorRequest(
      "app",
      "wallet",
      requestId,
      tx,
      Date.now() + 60_000
    ),
    signature: "user-key-proof",
    walletSignature: toHex(1n, { size: 65 }),
  })
  assert.deepEqual(readPendingTransfer(owner.address), {
    recipient: owner.address,
    amount: 10_000n,
  })
  assert.equal(
    readPendingTransfer(privateKeyToAccount(toHex(2n, { size: 32 })).address),
    null
  )
})

test("pre-submission outages preserve the self-funded path", async () => {
  mock.method(globalThis, "fetch", async () => {
    throw new Error("offline")
  })
  assert.equal(await sender()(transaction), null)
  assert.equal(readPendingSponsor(owner.address), null)
  mock.method(
    globalThis,
    "fetch",
    async () => new Response("Bad gateway", { status: 502 })
  )
  assert.equal(await sender()(transaction), null)
  assert.equal(readPendingSponsor(owner.address), null)
})

test("pending records require the current retry history field without migration defaults", () => {
  storage.set(
    `pippo:sponsor:10143:${owner.address.toLowerCase()}`,
    JSON.stringify({ id: requestId })
  )
  assert.throws(
    () => readPendingSponsor(owner.address),
    /Invalid pending sponsorship record/
  )
})

test("a reserve blocker stops before signing and cannot fall back to a native transaction", async () => {
  mock.method(globalThis, "fetch", async () =>
    Response.json(
      { blocked: true, error: "Add MON to cover the reserve." },
      { status: 422 }
    )
  )
  await assert.rejects(sender()(transaction), /Add MON/)
  assert.equal(readPendingSponsor(owner.address), null)
})

test("a guarded retry keeps the exact cheque transaction and retains the earlier provider request", async () => {
  const original = {
    from: owner.address,
    to: owner.address,
    data: transaction.data,
    value: "0x0" as const,
  }
  savePendingSponsor(owner.address, {
    previousIds: [],
    id: requestId,
    transaction: original,
    request: sponsorRequest(
      "app",
      "wallet",
      requestId,
      original,
      Date.now() - 60000
    ),
    signature: "old-proof",
    walletSignature: toHex(1n, { size: 65 }),
  })
  const freshId = "22222222-2222-4222-8222-222222222222"
  mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    if (init.method !== "POST")
      return Response.json(
        url.includes(requestId)
          ? { status: "broadcasted", retryable: true }
          : { status: "confirmed", hash }
      )
    const body = JSON.parse(init.body as string)
    calls.push(body)
    if (body.phase === "prepare") {
      assert.equal(body.retryOf, requestId)
      assert.deepEqual(body.transaction, original)
      return Response.json({
        sponsored: true,
        id: freshId,
        request: sponsorRequest(
          "app",
          "wallet",
          freshId,
          original,
          Date.now() + 60000
        ),
      })
    }
    assert.equal(body.id, freshId)
    return Response.json({ transactionId: "new-provider-id" })
  })
  assert.equal(await sender()(transaction), hash)
  assert.equal(readPendingSponsor(owner.address)?.id, freshId)
  assert.deepEqual(readPendingSponsor(owner.address)?.previousIds, [requestId])
  assert.deepEqual(readPendingSponsor(owner.address)?.transaction, original)
})

test("a funding blocker on an accepted cheque preserves its pending request", async () => {
  const original = {
    from: owner.address,
    to: owner.address,
    data: transaction.data,
    value: "0x0" as const,
  }
  savePendingSponsor(owner.address, {
    previousIds: [],
    id: requestId,
    transaction: original,
    request: sponsorRequest(
      "app",
      "wallet",
      requestId,
      original,
      Date.now() - 60000
    ),
    signature: "old-proof",
    walletSignature: toHex(1n, { size: 65 }),
  })
  mock.method(globalThis, "fetch", async () =>
    Response.json({
      status: "broadcasted",
      blocked: true,
      error: "Add MON to cover the reserve.",
    })
  )
  await assert.rejects(sender()(transaction), /Add MON/)
  assert.equal(readPendingSponsor(owner.address)?.id, requestId)
})

test("MFA or wallet authorization cancellation never submits a transaction", async () => {
  mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(init.body as string))
    return prepared()
  })
  const client = {
    signMessage: async () => {
      throw new Error("MFA cancelled")
    },
  } as unknown as SignerClient
  await assert.rejects(
    sender()({ ...transaction, client }),
    FinalTransactionError
  )
  assert.deepEqual(
    calls.map((c) => c.phase),
    ["prepare"]
  )
  assert.equal(readPendingSponsor(owner.address), null)
})

test("an uncertain broadcast retries the stored request after a reload", async () => {
  let disconnected = true
  mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    if (init.method === "POST") {
      const body = JSON.parse(init.body as string)
      calls.push(body)
      if (body.phase === "prepare") return prepared()
      if (disconnected) throw new Error("lost after submission")
      return Response.json({ transactionId: "provider-id" })
    }
    assert.match(url, new RegExp(requestId))
    return Response.json({ status: "confirmed", hash })
  })
  await assert.rejects(sender()(transaction))
  assert.equal(readPendingSponsor(owner.address)?.id, requestId)
  // Recreate the sender as a fresh page load would.
  disconnected = false
  assert.equal(await sender()(transaction), hash)
  assert.deepEqual(
    calls.map((c) => c.phase),
    ["prepare", "submit", "submit"]
  )
  assert.deepEqual(
    calls.filter((c) => c.phase === "submit").map((c) => c.id),
    [requestId, requestId]
  )
  // Keep the hash until the caller confirms its receipt, even if its RPC goes offline.
  assert.equal(await sender()(transaction), hash)
  assert.equal(calls.length, 3)
  acknowledgeSponsor(owner.address, hash)
  assert.equal(readPendingSponsor(owner.address), null)
})

test("rapid duplicate clicks share one reservation and one submission", async () => {
  mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    if (init.method === "POST") {
      const body = JSON.parse(init.body as string)
      calls.push(body)
      return body.phase === "prepare"
        ? prepared()
        : Response.json({ transactionId: "provider-id" })
    }
    return Response.json({ status: "confirmed", hash })
  })
  const send = sender()
  const first = send(transaction),
    second = send(transaction)
  assert.equal(first, second)
  await assert.rejects(
    send({ ...transaction, value: 1n }),
    /still being checked/
  )
  assert.deepEqual(await Promise.all([first, second]), [hash, hash])
  assert.deepEqual(
    calls.map((c) => c.phase),
    ["prepare", "submit"]
  )
})

test("a known reverted transaction clears pending state for a safe new attempt", async () => {
  mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) =>
    init.method === "POST"
      ? JSON.parse(init.body as string).phase === "prepare"
        ? prepared()
        : Response.json({ transactionId: "provider-id" })
      : Response.json({ status: "execution_reverted" })
  )
  await assert.rejects(sender()(transaction), FinalTransactionError)
  assert.equal(readPendingSponsor(owner.address), null)
})
