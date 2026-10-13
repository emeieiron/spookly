import assert from "node:assert/strict"
import { test } from "node:test"
import { toHex, type Address } from "viem"
import { chequeLink, readChequeFragment } from "./cheque-link"
import { spenderLinkFragment } from "./spender-link"

const origin = "https://pippo.example"
const book = "0x1111111111111111111111111111111111111111" as Address
const key = toHex(1n, { size: 32 })
const link = chequeLink(origin, book, key)

test("installed spender opens the original cheque fragment without rewriting its identity", () => {
  const fragment = spenderLinkFragment(`  ${link}  `, origin)
  assert.equal(fragment, new URL(link).hash)
  assert.deepEqual(readChequeFragment(fragment!), { book, key })
})

test("pasted links cannot navigate to another origin, route, or credential-bearing URL", () => {
  for (const invalid of [
    link.replace(origin, "https://another.example"),
    link.replace("/c#", "/app#"),
    link.replace("/c#", "/c?key=secret#"),
    link.replace("https://", "https://user:password@"),
    "javascript:alert(1)",
    "/c#fragment",
    `${origin}/c`,
    `${origin}/c#broken`,
    chequeLink(origin, book, toHex(0n, { size: 32 })),
    chequeLink(origin, book, toHex((1n << 256n) - 1n, { size: 32 })),
  ])
    assert.equal(spenderLinkFragment(invalid, origin), null)
})
