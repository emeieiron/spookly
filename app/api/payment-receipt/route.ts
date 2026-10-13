import { isHash } from "viem"
import { deployment } from "@/config/network.mjs"
import { ENTRY_POINT, monad } from "@/lib/chain"
import { parseReceipt, receiptQuery } from "@/lib/hypersync"

const headers = { "Cache-Control": "no-store" }
// A local fork's blocks past the fork point never reach HyperSync, so it can't speak for them.
const forked = /\/\/(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(
  process.env.MONAD_RPC_URL ?? ""
)

// Finds a payment's UserOperationEvent from any starting block in one HyperSync request, so confirming a payment
// after a reload doesn't page through the public RPC 100 blocks at a time. The token stays server-side.
export async function GET(request: Request) {
  const token = process.env.ENVIO_API_TOKEN
  if (!token || forked)
    return Response.json(
      { error: "HyperSync is not configured" },
      { status: 503, headers }
    )
  const params = new URL(request.url).searchParams
  const userOpHash = params.get("userOpHash") ?? ""
  const fromBlock = Number(params.get("fromBlock"))
  if (!isHash(userOpHash) || !Number.isSafeInteger(fromBlock) || fromBlock < 0)
    return Response.json(
      { error: "Unsupported request" },
      { status: 400, headers }
    )

  try {
    const response = await fetch(`https://${monad.id}.hypersync.xyz/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        receiptQuery(
          ENTRY_POINT,
          userOpHash,
          // No spook payment predates the factory.
          Math.max(fromBlock, Number(deployment.blockNumber ?? 0))
        )
      ),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    })
    const receipt = response.ok ? parseReceipt(await response.json()) : null
    if (receipt) return Response.json(receipt, { headers })
  } catch {}
  return Response.json(
    { error: "HyperSync is unavailable" },
    { status: 502, headers }
  )
}
