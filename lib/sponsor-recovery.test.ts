import assert from "node:assert/strict"
import { afterEach, mock, test } from "node:test"
import {
  encodeFunctionData,
  getAddress,
  parseEther,
  toHex,
  zeroHash,
} from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { chequeBookAbi } from "./abi"
import { USDC, erc20Abi, ENTRY_POINT } from "./chain"
import {
  reserveShortfall,
  reserveMessage,
  SponsorFundingError,
} from "./monad-reserve"
import { sponsorRequest, SPONSOR_REQUEST_TTL } from "./sponsorship"
import {
  sponsorClient,
  validateSponsorTransaction,
} from "./server/sponsor-policy"
import {
  sponsorExecution,
  PRIVY_TESTNET_DELEGATE,
} from "./server/sponsor-execution"
import {
  canRetryCheque,
  sameChequeTransaction,
} from "./server/sponsor-recovery"

const owner = privateKeyToAccount(toHex(1n, { size: 32 })).address
const signer = privateKeyToAccount(toHex(2n, { size: 32 })).address
const book = getAddress("0x1111111111111111111111111111111111111111")
const code = `0xef0100${PRIVY_TESTNET_DELEGATE.slice(2)}` as const
const now = Date.now()
const transaction = {
  from: owner,
  to: book,
  value: toHex(parseEther("0.2164")),
  data: encodeFunctionData({
    abi: chequeBookAbi,
    functionName: "fundAndWrite",
    args: [
      signer,
      10000n,
      BigInt(Math.floor(now / 1000) + 86400),
      parseEther("0.3"),
      10000n,
      { deadline: 0n, v: 0, r: zeroHash, s: zeroHash },
      "0x",
    ],
  }),
}
const record = {
  userId: "user",
  walletId: "wallet",
  walletAddress: owner,
  expiresAt: now - 180_000 + SPONSOR_REQUEST_TTL,
  request: sponsorRequest(
    "app",
    "wallet",
    "id",
    transaction,
    now - 180_000 + SPONSOR_REQUEST_TTL,
    10000n
  ),
  transactionId: "provider-id",
}
const status = {
  wallet_id: "wallet",
  caip2: "eip155:10143",
  status: "broadcasted",
  transaction_hash: "",
}
afterEach(() => mock.restoreAll())

test("zero-value sponsorship works below reserve; native spending requires the full reserve", () => {
  assert.equal(reserveShortfall(0n, 0n), 0n)
  assert.equal(
    reserveShortfall(parseEther("6.71"), parseEther("0.2164")),
    parseEther("3.5064")
  )
  assert.equal(
    reserveShortfall(parseEther("10.2164"), parseEther("0.2164")),
    0n
  )
  assert.match(reserveMessage(parseEther("3.506400000000000001")), /3.5065 MON/)
})

test("delegated-wallet preflight rejects the live regression before reserving or estimating", async () => {
  mock.method(sponsorClient, "getChainId", async () => 10143)
  mock.method(sponsorClient, "readContract", async () => book)
  mock.method(sponsorClient, "getBalance", async () => parseEther("6.71"))
  mock.method(sponsorClient, "getCode", async () => code)
  const estimate = mock.method(sponsorClient, "estimateGas", async () => {
    throw new Error("Must not estimate")
  })
  await assert.rejects(
    validateSponsorTransaction(transaction),
    SponsorFundingError
  )
  assert.equal(estimate.mock.callCount(), 0)
})

test("an ordinary wallet below reserve keeps its native path without being delegated", async () => {
  mock.method(sponsorClient, "getChainId", async () => 10143)
  mock.method(sponsorClient, "readContract", async () => book)
  mock.method(sponsorClient, "getBalance", async () => parseEther("6.71"))
  mock.method(sponsorClient, "getCode", async () => "0x")
  assert.equal(await validateSponsorTransaction(transaction), false)
})

test("full batch estimation uses actual delegated code and balances, including exact approval", async () => {
  mock.method(sponsorClient, "getChainId", async () => 10143)
  mock.method(sponsorClient, "readContract", async () => book)
  mock.method(sponsorClient, "getBalance", async () => parseEther("10.2164"))
  mock.method(sponsorClient, "getCode", async () => code)
  mock.method(sponsorClient, "estimateFeesPerGas", async () => ({
    maxFeePerGas: 100000000000n,
  }))
  const estimate = mock.method(
    sponsorClient,
    "estimateGas",
    async () => 400000n
  )
  assert.equal(await validateSponsorTransaction(transaction), true)
  const input = estimate.mock.calls[0].arguments[0]
  assert.ok(input)
  assert.equal(input.account, ENTRY_POINT)
  assert.equal(input.to, owner)
  assert.equal(input.stateOverride, undefined)
  assert.notEqual(input.data, transaction.data)
  assert.deepEqual(
    input,
    sponsorExecution(owner, code, record.request.body.params.calls)
  )
})

test("guarded retry requires an absent cheque, current ownership, correct network, and elapsed delay", async () => {
  let exists = false
  let owning = owner
  mock.method(
    sponsorClient,
    "readContract",
    async (input: { functionName: string }) =>
      input.functionName === "owner"
        ? owning
        : [0n, exists ? 1n : 0n, false, 0n, 0n]
  )
  assert.equal(await canRetryCheque(record, status, now), true)
  assert.equal(await canRetryCheque(record, status, now - 120000), false)
  assert.equal(
    await canRetryCheque(record, { ...status, caip2: "eip155:143" }, now),
    false
  )
  assert.equal(
    await canRetryCheque(record, { ...status, wallet_id: "other" }, now),
    false
  )
  exists = true // Cancelled cheques still have an expiry and cannot be retried.
  assert.equal(await canRetryCheque(record, status, now), false)
  exists = false
  owning = signer
  assert.equal(await canRetryCheque(record, status, now), false)
})

test("a retry cannot change cheque key, calldata, target or native amount; transfers cannot retry", async () => {
  assert.equal(sameChequeTransaction(record, transaction), true)
  assert.equal(
    sameChequeTransaction(record, { ...transaction, value: "0x0" }),
    false
  )
  assert.equal(
    sameChequeTransaction(record, {
      ...transaction,
      data: `${transaction.data}00`,
    }),
    false
  )
  assert.equal(
    sameChequeTransaction(record, { ...transaction, to: USDC }),
    false
  )
  const transfer = {
    ...transaction,
    to: USDC,
    value: "0x0" as const,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [owner, 10000n],
    }),
  }
  const item = {
    ...record,
    request: sponsorRequest("app", "wallet", "id", transfer, record.expiresAt),
  }
  assert.equal(await canRetryCheque(item, status, now), false)
})
