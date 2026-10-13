import assert from "node:assert/strict"
import { after, beforeEach, mock, test } from "node:test"
import { decodeFunctionData, getAddress, toHex, type Hash } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { spookBookAbi } from "./abi"
import { FEE_ALLOWANCE } from "./spook-book"
import { publicClient } from "./spook-payment"
import { prepareSpookCreation, createSpook } from "./issuer-spook"
import { PRIVY_TESTNET_DELEGATE } from "./server/sponsor-execution"
import { readSpookDraft, saveSpookDraft } from "./spook-draft"
import { type SignerClient } from "./wallet-send"

const owner = privateKeyToAccount(toHex(1n, { size: 32 }))
const book = {
  address: getAddress("0x1111111111111111111111111111111111111111"),
  available: 0n,
  spareGas: FEE_ALLOWANCE,
  spooks: [],
}
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
  storage.clear()
  mock.restoreAll()
})
after(() => mock.restoreAll())

test("delegated wallets prepare allowance-based Spooks without an unusable permit signature", async () => {
  mock.method(
    publicClient,
    "getCode",
    async () => `0xef0100${PRIVY_TESTNET_DELEGATE.slice(2)}`
  )
  const sign = mock.fn(async () => {
    throw new Error("Must not request a raw permit")
  })
  const client = {
    account: owner,
    signTypedData: sign,
  } as unknown as SignerClient
  const draft = await prepareSpookCreation(client, book, null, 10000n, 7)
  const call = decodeFunctionData({ abi: spookBookAbi, data: draft.data })
  assert.equal(call.functionName, "fundAndSpook")
  if (call.functionName !== "fundAndSpook")
    throw new Error("Wrong Spook transaction")
  assert.equal(call.args[4], 10000n)
  assert.equal(call.args[5].deadline, 0n)
  assert.equal(sign.mock.callCount(), 0)
  assert.deepEqual(
    await prepareSpookCreation(client, book, null, 10000n, 7),
    draft
  )
})

test("ordinary wallets retain their current single-transaction permit funding flow", async () => {
  mock.method(publicClient, "getCode", async () => "0x")
  mock.method(publicClient, "readContract", async () => 0n)
  const sign = mock.fn(owner.signTypedData)
  const client = {
    account: owner,
    signTypedData: sign,
  } as unknown as SignerClient
  const draft = await prepareSpookCreation(client, book, null, 10000n, 7)
  const call = decodeFunctionData({ abi: spookBookAbi, data: draft.data })
  if (call.functionName !== "fundAndSpook")
    throw new Error("Wrong Spook transaction")
  assert.ok(call.args[5].deadline > BigInt(Math.floor(Date.now() / 1000)))
  assert.equal(sign.mock.callCount(), 1)
})

test("a funded spook resumes its saved receipt without signing or sending again", async () => {
  const fundedBook = { ...book, available: 1_000_000n }
  const client = { account: owner } as unknown as SignerClient
  const draft = await prepareSpookCreation(client, fundedBook, null, 10_000n, 7)
  const hash = `0x${"ab".repeat(32)}` as Hash
  saveSpookDraft(owner.address, { ...draft, hash })
  const receipt = mock.method(
    publicClient,
    "waitForTransactionReceipt",
    async () => ({ status: "success" })
  )
  const send = mock.fn(async () => {
    throw new Error("Must not send a second transaction")
  })
  const result = await createSpook(
    { account: owner.address, client, book: fundedBook },
    10_000n,
    7,
    null,
    send
  )
  assert.equal(result.signer, draft.signer)
  assert.equal(result.key, draft.key)
  assert.equal(receipt.mock.callCount(), 1)
  assert.equal(send.mock.callCount(), 0)
  assert.equal(readSpookDraft(owner.address), null)
})

test("an uncertain receipt preserves the funded spook and blocks changing its amount", async () => {
  const fundedBook = { ...book, available: 1_000_000n }
  const client = { account: owner } as unknown as SignerClient
  const draft = await prepareSpookCreation(client, fundedBook, null, 10_000n, 7)
  const saved = { ...draft, hash: `0x${"cd".repeat(32)}` as Hash }
  saveSpookDraft(owner.address, saved)
  mock.method(publicClient, "waitForTransactionReceipt", async () => {
    throw new Error("Receipt unavailable")
  })
  await assert.rejects(
    createSpook(
      { account: owner.address, client, book: fundedBook },
      10_000n,
      7,
      null
    ),
    /Receipt unavailable/
  )
  assert.deepEqual(readSpookDraft(owner.address), saved)
  await assert.rejects(
    prepareSpookCreation(client, fundedBook, null, 20_000n, 7),
    /previous spook/
  )
})
