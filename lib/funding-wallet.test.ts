import { sourceChain } from "./funding/chains"
import assert from "node:assert/strict"
import { test } from "node:test"
import {
  payDeposit,
  walletRejected,
  type SourceWallet,
} from "./funding/source-wallet"
import type { FundingLeg, FundingToken } from "./funding/model"

const account = "0x1111111111111111111111111111111111111111"
const token: FundingToken = {
  blockchain: "base",
  symbol: "USDC",
  decimals: 6,
  assetId: "base:usdc",
  contractAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
}
const leg: FundingLeg = {
  target: { symbol: "USDC", amount: "1000000" },
  payment: "unpaid",
  status: "PENDING_DEPOSIT",
  quote: {
    quoteRequest: {
      dry: false,
      swapType: "EXACT_OUTPUT",
      depositType: "ORIGIN_CHAIN",
      amount: "1000000",
      originAsset: token.assetId,
      destinationAsset: "monad:143_USDC",
      slippageTolerance: 100,
      refundTo: account,
      refundType: "ORIGIN_CHAIN",
      recipient: account,
      recipientType: "DESTINATION_CHAIN",
      deadline: new Date(Date.now() + 60000).toISOString(),
    },
    quote: {
      amountIn: "1100000",
      amountOut: "1000000",
      minAmountOut: "1000000",
      timeEstimate: 30,
      deadline: new Date(Date.now() + 60000).toISOString(),
      depositAddress: "0x2222222222222222222222222222222222222222",
    },
  },
}
test("submitted, uncertain, settled, expired and memo deposits cannot open another wallet payment", async () => {
  let opened = 0
  const wallet: SourceWallet = {
    address: account,
    async switchChain() {
      opened++
    },
    async getEthereumProvider() {
      throw new Error("must never open")
    },
  }
  const cases: FundingLeg[] = [
    { ...leg, payment: "submitted" },
    { ...leg, payment: "signing" },
    { ...leg, status: "SUCCESS" },
    {
      ...leg,
      quote: {
        ...leg.quote,
        quote: { ...leg.quote.quote, deadline: new Date(0).toISOString() },
      },
    },
    {
      ...leg,
      quote: {
        ...leg.quote,
        quote: { ...leg.quote.quote, depositMemo: "required" },
      },
    },
  ]
  for (const value of cases)
    await assert.rejects(
      payDeposit(wallet, token, value, () => {
        opened++
      })
    )
  assert.equal(opened, 0)
  assert.equal(sourceChain(token).id, 8453)
})
test("only a provider's explicit rejection permits a retry after signing starts", () => {
  assert.equal(walletRejected({ code: 4001 }), true)
  assert.equal(walletRejected({ cause: { cause: { code: 4001 } } }), true)
  assert.equal(
    walletRejected(new Error("Transaction rejected; connection lost")),
    false
  )
  assert.equal(walletRejected({ code: -32000 }), false)
})
