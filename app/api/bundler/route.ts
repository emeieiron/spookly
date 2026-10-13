import { bundlerEndpoint } from "@/config/network.mjs"
import {
  createPublicClient,
  decodeFunctionData,
  getAddress,
  http,
  isAddress,
  type Address,
} from "viem"
import { spookBookAbi, factoryAbi } from "@/lib/abi"
import { ENTRY_POINT, FACTORY, monad } from "@/lib/chain"

const METHODS = new Set([
  "eth_supportedEntryPoints",
  "eth_estimateUserOperationGas",
  "eth_sendUserOperation",
  "eth_getUserOperationReceipt",
  "eth_getUserOperationByHash",
  "rundler_maxPriorityFeePerGas",
])

const client = createPublicClient({
  chain: monad,
  transport: http(process.env.MONAD_RPC_URL),
})
const knownBooks = new Set<string>()

// Only relay operations for spook books created by our factory, so the Alchemy key can't be used for anything else.
async function isSpookBook(sender: Address) {
  if (knownBooks.has(sender)) return true
  if (!FACTORY) return false
  try {
    const owner = await client.readContract({
      address: sender,
      abi: spookBookAbi,
      functionName: "owner",
    })
    const book = await client.readContract({
      address: FACTORY,
      abi: factoryAbi,
      functionName: "bookOf",
      args: [owner],
    })
    if (getAddress(book) !== sender) return false
  } catch {
    return false
  }
  knownBooks.add(sender)
  return true
}

const userMessage = (raw: string) => {
  const code = raw.match(/AA\d{2}/)?.[0]
  if (code === "AA21")
    return "The spook's fee balance is empty. Ask the issuer to top it up."
  if (code === "AA22") return "This spook has expired."
  if (code === "AA24")
    return "This spook can't make that payment. It may be spent or cancelled."
  return "The payment couldn't be processed. Try again."
}

export async function POST(request: Request) {
  const endpoint = bundlerEndpoint()
  if (!endpoint)
    return Response.json(
      { error: "Bundler is not configured" },
      { status: 503 }
    )

  const raw = await request.text()
  if (raw.length > 32_000)
    return Response.json({ error: "Request too large" }, { status: 413 })
  let body: { jsonrpc: string; id: unknown; method: string; params?: unknown[] }
  try {
    body = JSON.parse(raw)
    if (body.jsonrpc !== "2.0" || !METHODS.has(body.method)) throw new Error()
    const params = body.params ?? []
    if (
      body.method === "eth_sendUserOperation" ||
      body.method === "eth_estimateUserOperationGas"
    ) {
      const [op, entryPoint] = params as [
        {
          sender?: string
          callData?: `0x${string}`
          factory?: string
          paymaster?: string
        },
        string,
      ]
      if (
        params.length !== 2 ||
        String(entryPoint).toLowerCase() !== ENTRY_POINT.toLowerCase()
      )
        throw new Error()
      if (
        !op?.sender ||
        !isAddress(op.sender) ||
        op.factory ||
        op.paymaster ||
        !op.callData
      )
        throw new Error()
      const { functionName } = decodeFunctionData({
        abi: spookBookAbi,
        data: op.callData,
      })
      if (functionName !== "pay" && functionName !== "payCrossChain")
        throw new Error()
      if (!(await isSpookBook(getAddress(op.sender)))) throw new Error()
    }
  } catch {
    return Response.json({ error: "Unsupported request" }, { status: 400 })
  }

  const fail = (message: string) =>
    Response.json(
      { jsonrpc: "2.0", id: body.id, error: { code: -32000, message } },
      { headers: { "Cache-Control": "no-store" } }
    )
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: raw,
      signal: AbortSignal.timeout(25_000),
    })
    if (response.status === 429)
      return fail("The payment service is busy. Try again in a moment.")
    if (!response.ok)
      return fail("The payment service is unavailable. Try again later.")
    const result = await response.json()
    if (result.error) {
      console.error("bundler", body.method, result.error)
      return fail(userMessage(String(result.error.message ?? "")))
    }
    return Response.json(result, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return fail("The payment service is unavailable. Try again later.")
  }
}
