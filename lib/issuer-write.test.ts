import assert from "node:assert/strict"
import { after, beforeEach, mock, test } from "node:test"
import { decodeFunctionData, getAddress, toHex } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { chequeBookAbi } from "./abi"
import { FEE_ALLOWANCE } from "./cheque-book"
import { publicClient } from "./cheque-payment"
import { prepareChequeWrite } from "./issuer-write"
import { PRIVY_TESTNET_DELEGATE } from "./server/sponsor-execution"
import { type SignerClient } from "./wallet-send"

const owner = privateKeyToAccount(toHex(1n, { size: 32 }))
const book = {
  address: getAddress("0x1111111111111111111111111111111111111111"),
  available: 0n,
  spareGas: FEE_ALLOWANCE,
  cheques: [],
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

test("delegated wallets prepare allowance-based writes without an unusable permit signature", async () => {
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
  const draft = await prepareChequeWrite(client, book, null, 10000n, 7)
  const call = decodeFunctionData({ abi: chequeBookAbi, data: draft.data })
  assert.equal(call.functionName, "fundAndWrite")
  if (call.functionName !== "fundAndWrite") throw new Error("Wrong write")
  assert.equal(call.args[4], 10000n)
  assert.equal(call.args[5].deadline, 0n)
  assert.equal(sign.mock.callCount(), 0)
  assert.deepEqual(
    await prepareChequeWrite(client, book, null, 10000n, 7),
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
  const draft = await prepareChequeWrite(client, book, null, 10000n, 7)
  const call = decodeFunctionData({ abi: chequeBookAbi, data: draft.data })
  if (call.functionName !== "fundAndWrite") throw new Error("Wrong write")
  assert.ok(call.args[5].deadline > BigInt(Math.floor(Date.now() / 1000)))
  assert.equal(sign.mock.callCount(), 1)
})
