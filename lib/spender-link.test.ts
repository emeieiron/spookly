import assert from "node:assert/strict"
import { test } from "node:test"
import { toHex, type Address } from "viem"
import { spookLink, readSpookFragment } from "./spook-link"
import { spenderLinkFragment } from "./spender-link"

const origin = "https://spookly.example"
const book = "0x1111111111111111111111111111111111111111" as Address
const key = toHex(1n, { size: 32 })
const link = spookLink(origin, book, key)

test("installed spender opens the original spook fragment without rewriting its identity", () => {
  const fragment = spenderLinkFragment(`  ${link}  `, origin)
  assert.equal(fragment, new URL(link).hash)
  assert.deepEqual(readSpookFragment(fragment!), { book, key })
})

test("pasted links cannot navigate to another origin, route, or credential-bearing URL", () => {
  for (const invalid of [
    link.replace(origin, "https://another.example"),
    link.replace("/spook#", "/app#"),
    link.replace("/spook#", "/c?key=secret#"),
    link.replace("https://", "https://user:password@"),
    "javascript:alert(1)",
    "/spook#fragment",
    `${origin}/spook`,
    `${origin}/spook#broken`,
    spookLink(origin, book, toHex(0n, { size: 32 })),
    spookLink(origin, book, toHex((1n << 256n) - 1n, { size: 32 })),
  ])
    assert.equal(spenderLinkFragment(invalid, origin), null)
})
