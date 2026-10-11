import assert from "node:assert/strict"
import { test } from "node:test"
import { parseEther } from "viem"
import {
  destinationToken,
  depositAmount,
  fundingComplete,
  canCloseUnpaid,
  parseStatus,
  parseTokens,
  quoteExpiry,
  readSession,
  sessionKey,
  validateQuote,
  type FundingQuote,
  type FundingSession,
  type QuoteRequest,
} from "./funding/model"
import { creationGasReserve, fundingTargets } from "./funding/requirements"
import { selectNetwork, bundlerEndpoint } from "../config/network.mjs"

const account = "0x1111111111111111111111111111111111111111"
const token = {
  assetId: "nep141:base-usdc",
  blockchain: "base",
  decimals: 6,
  symbol: "USDC",
  contractAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
}
const request: QuoteRequest = {
  dry: false,
  swapType: "EXACT_OUTPUT",
  depositType: "ORIGIN_CHAIN",
  amount: "1000000",
  originAsset: token.assetId,
  destinationAsset: "nep245:monad:143_USDC",
  slippageTolerance: 100,
  refundTo: account,
  refundType: "ORIGIN_CHAIN",
  recipient: account,
  recipientType: "DESTINATION_CHAIN",
  deadline: new Date(Date.now() + 120000).toISOString(),
}
const quote: FundingQuote = {
  quoteRequest: request,
  quote: {
    amountIn: "1100000",
    maxAmountIn: "1111000",
    amountOut: "1000000",
    minAmountOut: "1000000",
    timeEstimate: 30,
    deadline: request.deadline,
    depositAddress: "0x2222222222222222222222222222222222222222",
  },
}
const session: FundingSession = {
  version: 1,
  account,
  chainId: 143,
  purpose: "write",
  token,
  refundTo: account,
  createdAt: Date.now(),
  confirmed: true,
  draft: { amount: "1", days: 7 },
  legs: [
    {
      target: { symbol: "USDC", amount: "1000000" },
      quote,
      status: "PROCESSING",
      payment: "submitted",
      transactionHash: `0x${"ab".repeat(32)}`,
    },
  ],
}

test("a selected environment includes matching chain IDs, USDC, Circle and payouts", () => {
  const main = selectNetwork("mainnet"),
    dev = selectNetwork("testnet")
  assert.equal(main.chainId, 143)
  assert.equal(dev.chainId, 10143)
  assert.equal(main.payouts.find((n) => n.domain === 6)?.chainId, 8453)
  assert.equal(dev.payouts.find((n) => n.domain === 6)?.chainId, 84532)
  assert.notEqual(main.iris, dev.iris)
  assert.notEqual(main.tokenMessenger, dev.tokenMessenger)
  assert.notEqual(main.payouts[0].usdc, dev.payouts[0].usdc)
  assert.throws(() => selectNetwork("production"))
  assert.throws(() => selectNetwork(""))
  assert.equal(
    bundlerEndpoint({ BUNDLER_RPC_URL: "https://bundler.example" }),
    "https://bundler.example"
  )
})
test("funding covers only deficits and includes the issuer gas reserve", () => {
  assert.deepEqual(
    fundingTargets(
      10_000_000n,
      3_000_000n,
      0n,
      2_000_000n,
      parseEther("0.1"),
      parseEther("0.6")
    ),
    [
      { symbol: "USDC", amount: "5000000" },
      { symbol: "MON", amount: parseEther("0.8").toString() },
    ]
  )
  assert.deepEqual(
    fundingTargets(
      10_000_000n,
      10_000_000n,
      parseEther("1"),
      0n,
      0n,
      parseEther("0.6")
    ),
    []
  )
  assert.ok(
    creationGasReserve(100_000_000_000n, false) >
      creationGasReserve(100_000_000_000n, true)
  )
})
test("destination identity is mainnet chain plus native USDC address, not its symbol", () => {
  const usdc = selectNetwork("mainnet").payouts[0].usdc
  const catalog = parseTokens([
    {
      ...token,
      assetId: "nep245:token:143_USDC",
      blockchain: "monad",
      contractAddress: usdc,
    },
    { ...token, assetId: "nep245:token:10143_USDC", blockchain: "monad" },
    {
      assetId: "nep245:token:143_MON",
      blockchain: "monad",
      decimals: 18,
      symbol: "MON",
    },
  ])
  assert.equal(
    destinationToken(catalog, { symbol: "USDC", amount: "1" }, usdc).assetId,
    "nep245:token:143_USDC"
  )
  assert.equal(
    destinationToken(catalog, { symbol: "MON", amount: "1" }, usdc).decimals,
    18
  )
  assert.throws(() =>
    destinationToken(
      catalog,
      { symbol: "USDC", amount: "1" },
      token.contractAddress
    )
  )
})
test("rejects quotes that redirect output/refunds, undersupply or have expired", () => {
  assert.deepEqual(validateQuote(quote, request), quote)
  assert.equal(depositAmount(quote), "1111000")
  assert.equal(quoteExpiry(quote), Date.parse(request.deadline))
  for (const key of [
    "recipient",
    "refundTo",
    "destinationAsset",
    "originAsset",
    "amount",
    "recipientType",
  ])
    assert.throws(() =>
      validateQuote(
        { ...quote, quoteRequest: { ...request, [key]: "wrong" } },
        request
      )
    )
  assert.throws(() =>
    validateQuote(
      { ...quote, quote: { ...quote.quote, minAmountOut: "999999" } },
      request
    )
  )
  assert.throws(() =>
    validateQuote(
      {
        ...quote,
        quote: { ...quote.quote, deadline: new Date(0).toISOString() },
      },
      request
    )
  )
  assert.throws(() =>
    validateQuote(
      { ...quote, quote: { ...quote.quote, maxAmountIn: "1" } },
      request
    )
  )
})
test("reload preserves a submitted deposit and draft without crossing accounts or networks", () => {
  const map = new Map([[sessionKey(143, account), JSON.stringify(session)]])
  const storage = { getItem: (key: string) => map.get(key) ?? null }
  assert.deepEqual(readSession(storage, 143, account), session)
  assert.equal(readSession(storage, 10143, account), null)
  assert.equal(readSession(storage, 143, quote.quote.depositAddress!), null)
  map.set(sessionKey(143, account), "garbage")
  assert.equal(readSession(storage, 143, account), null)
})
test("USDC success alone cannot finish when MON is still pending or refunded", () => {
  const first = { ...session.legs[0], status: "SUCCESS" as const }
  const gas = {
    ...first,
    target: { symbol: "MON" as const, amount: "1000000" },
    status: "PENDING_DEPOSIT" as const,
  }
  assert.equal(fundingComplete({ ...session, legs: [first, gas] }), false)
  assert.equal(
    fundingComplete({
      ...session,
      legs: [first, { ...gas, status: "REFUNDED" }],
    }),
    false
  )
  assert.equal(
    fundingComplete({
      ...session,
      legs: [first, { ...gas, status: "SUCCESS" }],
    }),
    true
  )
  assert.throws(() => parseStatus({ status: "COMPLETE" }))
})

test("only an expired request with every deposit unpaid can be closed", () => {
  const unpaid: FundingSession = {
    ...session,
    legs: [
      { ...session.legs[0], status: "PENDING_DEPOSIT", payment: "unpaid" },
    ],
  }
  const expiry = quoteExpiry(quote)
  assert.equal(canCloseUnpaid(unpaid, expiry - 1), false)
  assert.equal(canCloseUnpaid(unpaid, expiry), true)
  for (const payment of ["signing", "submitted"] as const)
    assert.equal(
      canCloseUnpaid(
        { ...unpaid, legs: [{ ...unpaid.legs[0], payment }] },
        expiry
      ),
      false
    )
  assert.equal(
    canCloseUnpaid(
      { ...unpaid, legs: [{ ...unpaid.legs[0], status: "KNOWN_DEPOSIT_TX" }] },
      expiry
    ),
    false
  )
  assert.deepEqual(
    readSession({ getItem: () => JSON.stringify(unpaid) }, 143, account),
    unpaid
  )
})
