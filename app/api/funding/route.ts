import { isAddress } from "viem"
import { IS_MAINNET, USDC } from "@/lib/chain"
import {
  destinationToken,
  parseTokens,
  units,
  validateQuote,
  type FundingTarget,
  type QuoteRequest,
} from "@/lib/funding/model"
import { sourceChain } from "@/lib/funding/chains"

const BASE = "https://intents-api.aurora.dev"
const headers = { "Cache-Control": "no-store" }
let catalog: { at: number; tokens: ReturnType<typeof parseTokens> } | null =
  null
async function aurora(path: string, init?: RequestInit) {
  const key = process.env.AURORA_API_KEY
  if (!IS_MAINNET || !key)
    throw new Error("Cross-chain funding is unavailable right now.")
  const response = await fetch(
    `${BASE}/api/${path.replace("{key}", encodeURIComponent(key))}`,
    {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    }
  )
  if (!response.ok)
    throw new Error(
      response.status === 429
        ? "Funding is busy. Try again in a moment."
        : "Couldn't get a funding quote or status. Try again later."
    )
  return response.json()
}
async function tokens() {
  if (!catalog || Date.now() - catalog.at > 60_000)
    catalog = {
      at: Date.now(),
      tokens: parseTokens(await aurora("tokens/{key}")),
    }
  return catalog.tokens
}
export async function GET(request: Request) {
  try {
    if (!IS_MAINNET || !process.env.AURORA_API_KEY)
      return Response.json(
        { error: "Cross-chain funding is unavailable right now." },
        { status: 503, headers }
      )
    const params = new URL(request.url).searchParams
    const address = params.get("depositAddress")
    if (!address) return Response.json(await tokens(), { headers })
    if (address.length > 200 || !/^[\w.:\-]+$/.test(address))
      return Response.json(
        { error: "Invalid deposit address" },
        { status: 400, headers }
      )
    const query = new URLSearchParams({ depositAddress: address })
    const memo = params.get("depositMemo")
    if (memo && memo.length <= 200) query.set("depositMemo", memo)
    return Response.json(await aurora(`status/{key}?${query}`), { headers })
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Funding is unavailable" },
      { status: 502, headers }
    )
  }
}
export async function POST(request: Request) {
  if (
    request.headers.get("origin") &&
    request.headers.get("origin") !== new URL(request.url).origin
  )
    return Response.json(
      { error: "Unsupported request" },
      { status: 403, headers }
    )
  let body
  try {
    const raw = await request.text()
    if (raw.length > 4000) throw new Error()
    body = JSON.parse(raw)
    if (
      !isAddress(body.recipient) ||
      typeof body.refundTo !== "string" ||
      !/^[\w.:\-]{2,200}$/.test(body.refundTo) ||
      typeof body.dry !== "boolean" ||
      !["USDC", "MON"].includes(body.target?.symbol)
    )
      throw new Error()
    const amount = BigInt(units(body.target.amount))
    if (
      amount <= 0n ||
      amount >
        (body.target.symbol === "USDC"
          ? 100_000_000_000n
          : 100_000_000_000_000_000_000n)
    )
      throw new Error()
  } catch {
    return Response.json(
      { error: "Invalid funding request" },
      { status: 400, headers }
    )
  }
  try {
    const all = await tokens()
    const source = all.find((t) => t.assetId === body.originAsset)
    if (!source) throw new Error("That asset is unavailable")
    if (sourceChain(source) && !isAddress(body.refundTo))
      throw new Error("Enter a valid refund address on the source chain")
    const destination = destinationToken(
      all,
      body.target as FundingTarget,
      USDC
    )
    const quoteRequest: QuoteRequest = {
      dry: body.dry,
      swapType: "EXACT_OUTPUT",
      depositType: "ORIGIN_CHAIN",
      originAsset: body.originAsset,
      destinationAsset: destination.assetId,
      amount: body.target.amount,
      slippageTolerance: 100,
      refundTo: body.refundTo,
      refundType: "ORIGIN_CHAIN",
      recipient: body.recipient,
      recipientType: "DESTINATION_CHAIN",
      deadline: new Date(Date.now() + 20 * 60_000).toISOString(),
    }
    const result = await aurora("quote/{key}", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(quoteRequest),
    })
    return Response.json(validateQuote(result, quoteRequest), { headers })
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Funding is unavailable" },
      { status: 502, headers }
    )
  }
}
