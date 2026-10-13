import assert from "node:assert/strict"
import { test } from "node:test"
import { GET, POST } from "../app/api/funding/route"
import { IS_MAINNET, USDC } from "./chain"

test("funding API limits output to native mainnet assets and validates requests before quoting", async () => {
  const original = globalThis.fetch
  const previous = process.env.AURORA_API_KEY
  process.env.AURORA_API_KEY = "test-only-key"
  const calls: string[] = []
  const source = {
    assetId: "base:usdc",
    blockchain: "base",
    symbol: "USDC",
    decimals: 6,
  }
  const destination = {
    ...source,
    assetId: "nep245:test:143_USDC",
    blockchain: "monad",
    contractAddress: USDC,
  }
  let minimum: string | null = null
  let captured: Record<string, unknown> | null = null
  globalThis.fetch = async (input, init) => {
    calls.push(String(input))
    if (String(input).includes("/tokens/"))
      return Response.json({ asset_stats: [], tokens: [source, destination] })
    if (String(input).includes("/quote/")) {
      if (minimum)
        return Response.json(
          { message: `Amount is too low for bridge, try at least ${minimum}` },
          { status: 400 }
        )
      captured = JSON.parse(String(init?.body))
      const q = captured!
      return Response.json({
        quoteRequest: q,
        quote: {
          amountIn: "1100000",
          amountOut: q.amount,
          minAmountOut: q.amount,
          timeEstimate: 30,
          depositAddress: "0x2222222222222222222222222222222222222222",
          deadline: new Date(
            Date.parse(String(q.deadline)) + 3 * 86400000
          ).toISOString(),
        },
      })
    }
    return Response.json({ status: "PROCESSING" })
  }
  const request = (body: unknown) =>
    new Request("http://localhost/api/funding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  const body = {
    recipient: "0x1111111111111111111111111111111111111111",
    refundTo: "0x1111111111111111111111111111111111111111",
    originAsset: source.assetId,
    target: { symbol: "USDC", amount: "1000000" },
    dry: false,
    destinationAsset: "attacker-asset",
    appFees: [{ fee: 9999 }],
  }
  try {
    assert.equal(
      (await POST(request({ ...body, recipient: "bad" }))).status,
      400
    )
    assert.equal(
      (
        await POST(
          request({ ...body, target: { symbol: "USDT", amount: "1" } })
        )
      ).status,
      400
    )
    assert.equal(
      (
        await POST(
          request({ ...body, target: { symbol: "USDC", amount: "-1" } })
        )
      ).status,
      400
    )
    const response = await POST(request(body))
    if (!IS_MAINNET) {
      assert.notEqual(response.status, 200)
      assert.equal(calls.length, 0)
      return
    }
    assert.equal(response.status, 200)
    assert.equal(
      (captured as Record<string, unknown> | null)?.destinationAsset,
      destination.assetId
    )
    assert.equal(
      (captured as Record<string, unknown> | null)?.appFees,
      undefined
    )
    assert.equal(
      (captured as Record<string, unknown> | null)?.slippageTolerance,
      100
    )
    assert.equal(
      (
        await GET(
          new Request("http://localhost/api/funding?depositAddress=../../bad")
        )
      ).status,
      400
    )
    const status = await GET(
      new Request(
        "http://localhost/api/funding?depositAddress=0x123&depositMemo=123"
      )
    )
    assert.equal((await status.json()).status, "PROCESSING")
    assert.ok(calls.at(-1)?.includes("depositMemo=123"))
    minimum = "1200001"
    const rejected = await POST(request(body))
    assert.equal(rejected.status, 422)
    assert.equal(
      (await rejected.json()).error,
      "This route needs at least 1.2001 USDC. Choose another source chain."
    )
    delete process.env.AURORA_API_KEY
    assert.equal(
      (await GET(new Request("http://localhost/api/funding"))).status,
      503
    )
  } finally {
    globalThis.fetch = original
    if (previous === undefined) delete process.env.AURORA_API_KEY
    else process.env.AURORA_API_KEY = previous
  }
})
