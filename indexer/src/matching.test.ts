import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import profiles from "./networks.json" with { type: "json" }
import {
  CHAIN_BY_DOMAIN,
  DOMAIN_BY_CHAIN,
  matchKey,
  parseBurnMessage,
  toAddress,
} from "./matching.ts"

// The burn message Circle delivered on Base Sepolia for a $0.10 spook payment
// (mint 0x54fb692e…f0d57a701, burned on Monad in 0xf7ca00e5…d76237).
const BODY =
  "0x00000001000000000000000000000000534b2f3a21130d7a60830c2df862319e593943a3000000000000000000000000505463601725af929db6d7cd7e5fe7a7feb4932b00000000000000000000000000000000000000000000000000000000000276560000000000000000000000001bba97730829ddee06320bd8db74896d5e824b4b000000000000000000000000000000000000000000000000000000000000efb6000000000000000000000000000000000000000000000000000000000000efb60000000000000000000000000000000000000000000000000000000000000000636374702d666f72776172640000000000000000000000000000000000000000"
const BOOK = "0x1bba97730829ddee06320bd8db74896d5e824b4b"
const PAYEE = "0x505463601725af929db6d7cd7e5fe7a7feb4932b"

test("reads the payee, amount, paying book and fee from a burn message", () => {
  assert.deepEqual(parseBurnMessage(BODY), {
    recipient: PAYEE,
    burned: 161366n,
    sender: BOOK,
    feeExecuted: 61366n,
  })
})

test("rejects bodies too short to be a burn message", () => {
  assert.equal(parseBurnMessage("0x0000"), null)
})

test("the burn on Monad and the mint on Base produce the same key", () => {
  // PaidCrossChain gives the recipient as bytes32 and the domain as a number; the mint is parsed from its body.
  const fromBurn = matchKey(
    BOOK.toUpperCase().replace("0X", "0x"),
    6,
    toAddress(`0x000000000000000000000000${PAYEE.slice(2)}`),
    161366n
  )
  const burn = parseBurnMessage(BODY)!
  const fromMint = matchKey(
    burn.sender,
    DOMAIN_BY_CHAIN[84532],
    burn.recipient,
    burn.burned
  )
  assert.equal(fromBurn, fromMint)
})

test("a different amount or payee never matches", () => {
  const burn = parseBurnMessage(BODY)!
  const key = matchKey(burn.sender, 6, burn.recipient, burn.burned)
  assert.notEqual(key, matchKey(burn.sender, 6, burn.recipient, 161367n))
  assert.notEqual(key, matchKey(burn.sender, 6, BOOK, burn.burned))
  assert.notEqual(key, matchKey(burn.sender, 3, burn.recipient, burn.burned))
})

test("the indexer's network copy matches config/networks.json", () => {
  const source = JSON.parse(
    readFileSync(new URL("../../config/networks.json", import.meta.url), "utf8")
  )
  for (const name of ["mainnet", "testnet"] as const) {
    const copy = profiles[name]
    assert.equal(copy.chainId, source[name].chainId)
    assert.equal(copy.tokenMessenger, source[name].tokenMessenger)
    assert.deepEqual(
      copy.payouts,
      source[name].payouts.map(
        ({ chainId, domain }: { chainId: number; domain: number }) => ({
          chainId,
          domain,
        })
      )
    )
  }
})

test("every destination maps to its CCTP domain and back", () => {
  for (const [chain, domain] of Object.entries(DOMAIN_BY_CHAIN))
    assert.equal(CHAIN_BY_DOMAIN[domain], Number(chain))
})
