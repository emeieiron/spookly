import assert from "node:assert/strict"
import { after, beforeEach, mock, test } from "node:test"
import { privateKeyToAccount } from "viem/accounts"
import { toHex } from "viem"
import { IS_MAINNET, monad } from "./chain"
import { createSponsorSender } from "./sponsor-client"
import { readPendingSponsor } from "./sponsor-pending"
import { publicClient } from "./cheque-payment"
import { sendChecked, type SignerClient } from "./wallet-send"
import { GET, POST } from "../app/api/sponsor/route"

const owner = privateKeyToAccount(toHex(1n, { size: 32 }))
const storage = new Map<string, string>()
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
})
beforeEach(() => {
  mock.restoreAll()
  storage.clear()
})
after(() => mock.restoreAll())

test("wallet transactions reject another network before authorization or submission", async () => {
  const client = {
    account: owner,
    getChainId: async () => (monad.id === 143 ? 10143 : 143),
  } as unknown as SignerClient
  mock.method(publicClient, "getChainId", async () => monad.id)
  const sponsor = mock.fn(async () => {
    throw new Error("Must not authorize")
  })
  await assert.rejects(
    sendChecked(client, owner.address, "0x12345678", 0n, sponsor),
    /Please connect/
  )
  assert.equal(sponsor.mock.callCount(), 0)
})

test(
  "mainnet ignores testnet sponsorship records and credentials on both client and server",
  { skip: !IS_MAINNET },
  async () => {
    const key = `pippo:sponsor:10143:${owner.address.toLowerCase()}`
    storage.set(key, "unresolved-testnet-record")
    assert.equal(readPendingSponsor(owner.address), null)
    const fetch = mock.method(globalThis, "fetch", async () => {
      throw new Error("Must not contact sponsor")
    })
    const auth = mock.fn(async () => {
      throw new Error("Must not authorize")
    })
    const send = createSponsorSender({
      walletId: "test-wallet",
      getAccessToken: auth,
      generateAuthorizationSignature: auth,
    })
    assert.equal(
      await send({
        client: { account: owner } as unknown as SignerClient,
        from: owner.address,
        to: owner.address,
        data: "0x12345678",
        value: 0n,
      }),
      null
    )
    const keys = [
      "PRIVY_GAS_SPONSORSHIP",
      "PRIVY_APP_SECRET",
      "UPSTASH_REDIS_REST_URL",
      "UPSTASH_REDIS_REST_TOKEN",
    ] as const
    const previous = keys.map((key) => process.env[key])
    try {
      for (const key of keys) process.env[key] = "true"
      const response = await POST(
        new Request("http://localhost/api/sponsor", {
          method: "POST",
          body: "{}",
        })
      )
      assert.deepEqual(await response.json(), { sponsored: false })
      assert.equal(
        (await GET(new Request("http://localhost/api/sponsor?id=test"))).status,
        503
      )
      assert.equal(auth.mock.callCount(), 0)
      assert.equal(fetch.mock.callCount(), 0)
      assert.equal(storage.get(key), "unresolved-testnet-record")
    } finally {
      keys.forEach((key, i) => {
        if (previous[i] === undefined) delete process.env[key]
        else process.env[key] = previous[i]
      })
    }
  }
)
