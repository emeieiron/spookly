import {
  decodeAbiParameters,
  getAbiItem,
  toEventSelector,
  type Address,
  type Hash,
  type Hex,
} from "viem"
import { entryPoint07Abi } from "viem/account-abstraction"

// A payment's UserOperationEvent as found by HyperSync, or how far HyperSync looked without finding it.
export type IndexedReceipt =
  | { transactionHash: Hash; success: boolean }
  | { transactionHash: null; scannedTo: number }

const USER_OPERATION_EVENT = toEventSelector(
  getAbiItem({ abi: entryPoint07Abi, name: "UserOperationEvent" })
)

export const receiptQuery = (
  entryPoint: Address,
  userOpHash: Hash,
  fromBlock: number
) => ({
  from_block: fromBlock,
  logs: [
    { address: [entryPoint], topics: [[USER_OPERATION_EVENT], [userOpHash]] },
  ],
  field_selection: { log: ["transaction_hash", "data"] },
  max_num_logs: 1,
})

type QueryResponse = {
  data?: { logs?: { transaction_hash?: Hash; data?: Hex }[] }[]
  next_block?: number
}

// HyperSync may stop short of the chain head; next_block is where an unfinished search continues.
export function parseReceipt(body: QueryResponse): IndexedReceipt | null {
  const log = body.data?.flatMap((batch) => batch.logs ?? [])[0]
  if (log?.transaction_hash && log.data) {
    // Non-indexed fields: nonce, success, actualGasCost, actualGasUsed.
    const [, success] = decodeAbiParameters(
      [
        { type: "uint256" },
        { type: "bool" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      log.data
    )
    return { transactionHash: log.transaction_hash, success }
  }
  return Number.isSafeInteger(body.next_block)
    ? { transactionHash: null, scannedTo: body.next_block! }
    : null
}
