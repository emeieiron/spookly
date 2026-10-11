import type { FundingQuote, FundingTarget, FundingToken } from "./model"
import { parseStatus, parseTokens } from "./model"

async function request(url: string, init?: RequestInit) {
  const timeout = AbortSignal.timeout(30_000)
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
  })
  const body = await response.json()
  if (!response.ok)
    throw new Error(body.error ?? "Funding is unavailable. Try again later.")
  return body
}
export const getTokens = async (signal?: AbortSignal) =>
  parseTokens(await request("/api/funding", { signal }))
export const getQuote = (
  token: FundingToken,
  target: FundingTarget,
  recipient: string,
  refundTo: string,
  dry: boolean,
  signal?: AbortSignal
): Promise<FundingQuote> =>
  request("/api/funding", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      originAsset: token.assetId,
      target,
      recipient,
      refundTo,
      dry,
    }),
  })
export const getStatus = async (quote: FundingQuote, signal?: AbortSignal) => {
  const params = new URLSearchParams({
    depositAddress: quote.quote.depositAddress!,
  })
  if (quote.quote.depositMemo)
    params.set("depositMemo", quote.quote.depositMemo)
  return parseStatus(await request(`/api/funding?${params}`, { signal }))
}
