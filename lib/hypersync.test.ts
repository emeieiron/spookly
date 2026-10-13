import assert from "node:assert/strict"
import { test } from "node:test"
import { encodeAbiParameters, type Hash, type Hex } from "viem"
import { parseReceipt, receiptQuery } from "./hypersync"

const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032"
const USER_OP: Hash =
  "0x2412e4c7e596725c51b15e40e019698bb3c7dfe707b8d153eccb305699d91aab"
const TX: Hash =
  "0xcb960aacb39c8b6371542894b92c52762867269a119b3f359a73e70b34c29de4"
// The non-indexed fields of a real UserOperationEvent on Monad mainnet, as HyperSync returned them.
const SUCCEEDED: Hex =
  "0x00008b3b9cb55e26f5e002361e9f7c00ad4017514b171e6e0000000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000028555"
const failed = encodeAbiParameters(
  [
    { type: "uint256" },
    { type: "bool" },
    { type: "uint256" },
    { type: "uint256" },
  ],
  [1n, false, 0n, 0n]
)

test("asks HyperSync for this operation's event from the given block", () => {
  const query = receiptQuery(ENTRY_POINT, USER_OP, 113140121)
  assert.equal(query.from_block, 113140121)
  assert.deepEqual(query.logs[0].address, [ENTRY_POINT])
  assert.equal(query.logs[0].topics[1][0], USER_OP)
  assert.equal(
    query.logs[0].topics[0][0],
    "0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f"
  )
})

test("reads the transaction and outcome of a found payment", () => {
  assert.deepEqual(
    parseReceipt({
      data: [
        { logs: [] },
        { logs: [{ transaction_hash: TX, data: SUCCEEDED }] },
      ],
      next_block: 113172736,
    }),
    { transactionHash: TX, success: true }
  )
  assert.deepEqual(
    parseReceipt({
      data: [{ logs: [{ transaction_hash: TX, data: failed }] }],
    }),
    { transactionHash: TX, success: false }
  )
})

test("reports how far it searched when the payment isn't there yet", () => {
  assert.deepEqual(parseReceipt({ data: [], next_block: 113172736 }), {
    transactionHash: null,
    scannedTo: 113172736,
  })
  assert.equal(parseReceipt({ data: [] }), null)
})
