import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { after, before, beforeEach, describe, mock, test } from "node:test"
import { randomUUID } from "node:crypto"
import { getAddress, toHex } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { serverPrivy } from "./server/privy"
import { sponsorClient } from "./server/sponsor-policy"
import {
  readSponsor,
  reserveSponsor,
  sponsorReservationKeys,
  type SponsorRecord,
} from "./server/sponsor-store"
import { sponsorProofMessage, sponsorRequest } from "./sponsorship"
import { GET, POST } from "../app/api/sponsor/route"

const container = process.env.SPONSOR_REDIS_TEST_CONTAINER
const exec = promisify(execFile)
const owner = privateKeyToAccount(toHex(1n, { size: 32 }))
const other = privateKeyToAccount(toHex(2n, { size: 32 }))
const id = () => randomUUID()
const json = (data: unknown) => Response.json(data)

describe(
  "sponsorship with real Redis atomic reservations",
  { skip: !container, concurrency: false },
  () => {
    let providerCalls = 0
    let uncertain = false
    const redis = async (command: (string | number)[]) => {
      if (!container?.startsWith("pippo-sponsor-test-"))
        throw new Error("Use a disposable Pippo test container.")
      const { stdout } = await exec("docker", [
        "exec",
        container,
        "redis-cli",
        "--json",
        ...command.map(String),
      ])
      return JSON.parse(stdout)
    }
    const record = (
      requestId: string,
      userId = "user",
      walletAddress = owner.address
    ): SponsorRecord => ({
      userId,
      walletId: "wallet",
      walletAddress,
      expiresAt: Date.now() + 60000,
      request: sponsorRequest(
        "test-app",
        "wallet",
        requestId,
        {
          from: walletAddress,
          to: owner.address,
          data: "0x12345678",
          value: "0x0",
        },
        Date.now() + 60000
      ),
    })
    const request = (data: unknown) =>
      new Request("http://localhost/api/sponsor", {
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      })
    before(() => {
      process.env.NEXT_PUBLIC_PRIVY_APP_ID = "test-app"
      process.env.PRIVY_APP_SECRET = "test-secret"
      process.env.PRIVY_GAS_SPONSORSHIP = "true"
      process.env.UPSTASH_REDIS_REST_URL = "https://redis.test"
      process.env.UPSTASH_REDIS_REST_TOKEN = "test-token"
      mock.method(
        globalThis,
        "fetch",
        async (input: string | URL | Request, init?: RequestInit) => {
          const url = String(input)
          if (url === "https://redis.test")
            return json({
              result: await redis(JSON.parse(init!.body as string)),
            })
          if (url.endsWith("/rpc")) {
            providerCalls++
            if (uncertain) throw new Error("Connection lost after broadcast")
            return json({ data: { transaction_id: "transaction" } })
          }
          throw new Error(`Unexpected test request: ${url}`)
        }
      )
      mock.method(
        serverPrivy().utils().auth(),
        "verifyAccessToken",
        async () => ({ user_id: "user" })
      )
      mock.method(serverPrivy().users(), "_get", async () => ({
        id: "user",
        linked_accounts: [
          {
            id: "wallet",
            type: "wallet",
            wallet_client_type: "privy",
            connector_type: "embedded",
            chain_type: "ethereum",
            address: owner.address,
          },
        ],
      }))
      mock.method(serverPrivy().transactions(), "get", async () => ({
        wallet_id: "wallet",
        caip2: "eip155:10143",
        status: "confirmed",
        transaction_hash: toHex(3n, { size: 32 }),
      }))
    })
    beforeEach(async () => {
      await redis(["FLUSHDB"])
      providerCalls = 0
      uncertain = false
    })
    after(() => mock.restoreAll())

    test("50 simultaneous requests cannot exceed a wallet's daily limit", async () => {
      const attempts = await Promise.all(
        Array.from({ length: 50 }, async () => {
          const requestId = id()
          return reserveSponsor(requestId, record(requestId), {
            wallet: 5,
            user: 10,
            app: 100,
          })
        })
      )
      assert.equal(attempts.filter(Boolean).length, 5)
    })
    test("a user's multiple wallets share a limit, and app limits cover different users", async () => {
      const first = id(),
        second = id(),
        third = id()
      assert.equal(
        await reserveSponsor(first, record(first), {
          wallet: 10,
          user: 1,
          app: 2,
        }),
        true
      )
      assert.equal(
        await reserveSponsor(second, record(second, "user", other.address), {
          wallet: 10,
          user: 1,
          app: 2,
        }),
        false
      )
      assert.equal(
        await reserveSponsor(second, record(second, "other", other.address), {
          wallet: 10,
          user: 1,
          app: 2,
        }),
        true
      )
      assert.equal(
        await reserveSponsor(
          third,
          record(
            third,
            "third",
            getAddress("0x3333333333333333333333333333333333333333")
          ),
          { wallet: 10, user: 1, app: 2 }
        ),
        false
      )
    })
    test("replays cannot reserve twice and UTC date changes isolate counters", async () => {
      const requestId = id(),
        item = record(requestId)
      assert.equal(
        await reserveSponsor(requestId, item, { wallet: 5, user: 5, app: 100 }),
        true
      )
      assert.equal(
        await reserveSponsor(requestId, item, { wallet: 5, user: 5, app: 100 }),
        false
      )
      assert.deepEqual(await readSponsor(requestId), item)
      const today = sponsorReservationKeys(
        requestId,
        "user",
        owner.address,
        new Date("2026-10-11T23:59:59Z")
      )
      const tomorrow = sponsorReservationKeys(
        requestId,
        "user",
        owner.address,
        new Date("2026-10-12T00:00:00Z")
      )
      assert.notEqual(today[0], tomorrow[0])
      assert.equal(today[3], tomorrow[3])
    })
    test("an access token and user-key signature cannot bypass the wallet proof", async () => {
      const requestId = id(),
        item = record(requestId)
      await reserveSponsor(requestId, item, { wallet: 5, user: 5, app: 100 })
      const bad = await other.signMessage({
        message: sponsorProofMessage(item.request),
      })
      const result = await POST(
        request({
          phase: "submit",
          id: requestId,
          signature: "user-key-signature",
          walletSignature: bad,
        })
      )
      assert.equal(result.status, 403)
      assert.equal(providerCalls, 0)
    })
    test("confirmed submissions are replayed from storage without broadcasting again", async () => {
      const requestId = id(),
        item = record(requestId)
      await reserveSponsor(requestId, item, { wallet: 5, user: 5, app: 100 })
      const walletSignature = await owner.signMessage({
        message: sponsorProofMessage(item.request),
      })
      const input = {
        phase: "submit",
        id: requestId,
        signature: "user-key-signature",
        walletSignature,
      }
      assert.equal((await POST(request(input))).status, 200)
      assert.equal((await POST(request(input))).status, 200)
      assert.equal(providerCalls, 1)
      const response = await GET(
        new Request(`http://localhost/api/sponsor?id=${requestId}`, {
          headers: { Authorization: "Bearer test-token" },
        })
      )
      assert.equal((await response.json()).status, "confirmed")
    })
    test("uncertain broadcasts preserve the same provider idempotency key and reservation", async () => {
      const requestId = id(),
        item = record(requestId)
      await reserveSponsor(requestId, item, { wallet: 5, user: 5, app: 100 })
      const walletSignature = await owner.signMessage({
        message: sponsorProofMessage(item.request),
      })
      const input = {
        phase: "submit",
        id: requestId,
        signature: "user-key-signature",
        walletSignature,
      }
      uncertain = true
      assert.equal((await POST(request(input))).status, 503)
      assert.equal(
        (await readSponsor(requestId))?.request.headers[
          "privy-idempotency-key"
        ],
        requestId
      )
      assert.equal(
        await reserveSponsor(requestId, item, { wallet: 5, user: 5, app: 100 }),
        false
      )
      uncertain = false
      assert.equal((await POST(request(input))).status, 200)
    })
    test("wrong RPC networks and wallets are rejected before reservation", async () => {
      const foreign = await POST(
        request({
          phase: "prepare",
          walletId: "wallet",
          transaction: {
            from: other.address,
            to: owner.address,
            data: "0x12345678",
            value: "0x0",
          },
        })
      )
      assert.equal(foreign.status, 403)
      mock.method(sponsorClient, "getChainId", async () => 143)
      const wrongChain = await POST(
        request({
          phase: "prepare",
          walletId: "wallet",
          transaction: {
            from: owner.address,
            to: owner.address,
            data: "0x12345678",
            value: "0x0",
          },
        })
      )
      assert.equal(wrongChain.status, 503)
      assert.equal(providerCalls, 0)
    })
  }
)
