import { isAddress } from "viem"

export type FundingToken = {
  assetId: string
  decimals: number
  blockchain: string
  symbol: string
  contractAddress?: string | null
}
export type FundingTarget = { symbol: "USDC" | "MON"; amount: string }
export type QuoteRequest = {
  dry: boolean
  swapType: "EXACT_OUTPUT"
  depositType: "ORIGIN_CHAIN"
  originAsset: string
  destinationAsset: string
  amount: string
  slippageTolerance: number
  refundTo: string
  refundType: "ORIGIN_CHAIN"
  recipient: string
  recipientType: "DESTINATION_CHAIN"
  deadline: string
}
export type FundingQuote = {
  quoteRequest: QuoteRequest
  quote: {
    amountIn: string
    maxAmountIn?: string
    amountOut: string
    minAmountOut: string
    timeEstimate: number
    depositAddress?: string
    depositMemo?: string
    deadline?: string
    timeWhenInactive?: string
    refundFee?: string | null
  }
}
export const SWAP_STATUSES = [
  "PENDING_DEPOSIT",
  "KNOWN_DEPOSIT_TX",
  "INCOMPLETE_DEPOSIT",
  "PROCESSING",
  "SUCCESS",
  "REFUNDED",
  "FAILED",
] as const
export type SwapStatus = (typeof SWAP_STATUSES)[number]
export type FundingLeg = {
  target: FundingTarget
  quote: FundingQuote
  status: SwapStatus
  // Persist before opening the wallet; an interrupted submission is never automatically retried.
  payment: "unpaid" | "signing" | "submitted"
  transactionHash?: `0x${string}`
}
export type FundingSession = {
  version: 1
  account: string
  chainId: number
  purpose: "receive" | "write"
  token: FundingToken
  refundTo: string
  legs: FundingLeg[]
  createdAt: number
  confirmed: boolean
  draft?: { amount: string; days: number }
}

const record = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error("Invalid funding response")
  return v as Record<string, unknown>
}
export function units(value: unknown): string {
  if (typeof value !== "string" || !/^\d{1,78}$/.test(value))
    throw new Error("Invalid funding amount")
  return value
}
export function parseTokens(value: unknown): FundingToken[] {
  if (!Array.isArray(value)) throw new Error("Invalid token catalog")
  return value.map((item) => {
    const t = record(item)
    if (
      typeof t.assetId !== "string" ||
      typeof t.blockchain !== "string" ||
      typeof t.symbol !== "string" ||
      !Number.isInteger(t.decimals) ||
      Number(t.decimals) < 0 ||
      Number(t.decimals) > 36 ||
      (t.contractAddress != null && typeof t.contractAddress !== "string")
    )
      throw new Error("Invalid token catalog")
    return t as FundingToken
  })
}
export function parseTokenCatalog(value: unknown): FundingToken[] {
  return parseTokens(record(value).tokens)
}
export function destinationToken(
  tokens: FundingToken[],
  target: FundingTarget,
  usdc: string
) {
  const token = tokens.find(
    (t) =>
      t.blockchain === "monad" &&
      t.assetId.includes(":143_") &&
      (target.symbol === "USDC"
        ? t.decimals === 6 &&
          t.contractAddress?.toLowerCase() === usdc.toLowerCase()
        : t.symbol === "MON" && t.decimals === 18 && !t.contractAddress)
  )
  if (!token) throw new Error(`${target.symbol} funding is unavailable`)
  return token
}
export function validateQuote(
  value: unknown,
  expected: QuoteRequest
): FundingQuote {
  const result = record(value)
  const request = record(result.quoteRequest)
  for (const key of [
    "dry",
    "swapType",
    "depositType",
    "originAsset",
    "destinationAsset",
    "amount",
    "recipient",
    "recipientType",
    "refundTo",
    "refundType",
    "slippageTolerance",
    "deadline",
  ] as const)
    if (request[key] !== expected[key])
      throw new Error("The funding quote does not match your request")
  const q = record(result.quote)
  const input = BigInt(units(q.amountIn))
  const max = q.maxAmountIn == null ? input : BigInt(units(q.maxAmountIn))
  if (
    input <= 0n ||
    max < input ||
    BigInt(units(q.amountOut)) < BigInt(expected.amount) ||
    BigInt(units(q.minAmountOut)) < BigInt(expected.amount) ||
    !Number.isFinite(q.timeEstimate) ||
    Number(q.timeEstimate) < 0
  )
    throw new Error("The quote cannot cover the requested funding")
  if (
    !expected.dry &&
    (typeof q.depositAddress !== "string" ||
      !q.depositAddress ||
      !Number.isFinite(Date.parse(String(q.deadline))) ||
      Date.parse(String(q.deadline)) <= Date.now())
  )
    throw new Error("The deposit quote has expired or is incomplete")
  if (q.depositMemo != null && typeof q.depositMemo !== "string")
    throw new Error("Invalid deposit memo")
  if (
    q.timeWhenInactive != null &&
    !Number.isFinite(Date.parse(String(q.timeWhenInactive)))
  )
    throw new Error("Invalid deposit window")
  if (q.refundFee != null) units(q.refundFee)
  return result as FundingQuote
}
export const depositAmount = (quote: FundingQuote) =>
  quote.quote.maxAmountIn ?? quote.quote.amountIn
export const quoteExpiry = (quote: FundingQuote) =>
  Math.min(
    Date.parse(quote.quoteRequest.deadline),
    Date.parse(quote.quote.deadline ?? quote.quoteRequest.deadline),
    Date.parse(
      quote.quote.timeWhenInactive ??
        quote.quote.deadline ??
        quote.quoteRequest.deadline
    )
  )
export const terminal = (status: SwapStatus) =>
  ["SUCCESS", "REFUNDED", "FAILED"].includes(status)
export const fundingComplete = (session: FundingSession) =>
  session.legs.every((leg) => leg.status === "SUCCESS")
export const canCloseUnpaid = (session: FundingSession, now: number) =>
  session.confirmed &&
  session.legs.every(
    (leg) =>
      leg.payment === "unpaid" &&
      leg.status === "PENDING_DEPOSIT" &&
      quoteExpiry(leg.quote) <= now
  )
export function parseStatus(value: unknown): SwapStatus {
  const status = record(value).status
  if (!SWAP_STATUSES.includes(status as SwapStatus))
    throw new Error("Unknown deposit status")
  return status as SwapStatus
}
export const sessionKey = (chainId: number, account: string) =>
  `pippo:funding:${chainId}:${account.toLowerCase()}`
export function readSession(
  storage: Pick<Storage, "getItem">,
  chainId: number,
  account: string
): FundingSession | null {
  try {
    const s = JSON.parse(
      storage.getItem(sessionKey(chainId, account)) ?? "null"
    ) as FundingSession | null
    if (
      !s ||
      s.version !== 1 ||
      s.chainId !== chainId ||
      s.account.toLowerCase() !== account.toLowerCase() ||
      !isAddress(s.account) ||
      !["receive", "write"].includes(s.purpose) ||
      typeof s.confirmed !== "boolean" ||
      !Number.isFinite(s.createdAt) ||
      !Array.isArray(s.legs) ||
      s.legs.length < 1 ||
      s.legs.length > 2
    )
      return null
    parseTokens([s.token])
    for (const leg of s.legs) {
      if (
        !["USDC", "MON"].includes(leg.target.symbol) ||
        BigInt(units(leg.target.amount)) <= 0n ||
        !leg.quote.quoteRequest.destinationAsset.includes(`:${chainId}_`) ||
        leg.quote.quoteRequest.recipient.toLowerCase() !==
          account.toLowerCase() ||
        leg.quote.quoteRequest.originAsset !== s.token.assetId ||
        !["unpaid", "signing", "submitted"].includes(leg.payment) ||
        !leg.quote.quote.depositAddress
      )
        return null
      parseStatus({ status: leg.status })
      units(depositAmount(leg.quote))
    }
    if (
      s.purpose === "write" &&
      (!s.draft ||
        ![1, 7, 30].includes(s.draft.days) ||
        !/^\d+(\.\d{0,6})?$/.test(s.draft.amount))
    )
      return null
    return s
  } catch {
    return null
  }
}
