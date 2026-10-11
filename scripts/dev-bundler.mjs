// Minimal ERC-4337 bundler for local testing against an anvil fork. Not for production.
// Usage: MONAD_RPC_URL=http://127.0.0.1:8545 node scripts/dev-bundler.mjs  (then BUNDLER_RPC_URL=http://localhost:4337)
import { createServer } from "node:http"
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseEventLogs,
} from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import {
  entryPoint07Abi,
  getUserOperationHash,
  toPackedUserOperation,
} from "viem/account-abstraction"

const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032"
const rpc = process.env.MONAD_RPC_URL ?? "http://127.0.0.1:8545"
// Anvil's default dev keys are swept or delegated on the real testnet, and a fork inherits that state.
const key = process.env.DEV_BUNDLER_KEY ?? generatePrivateKey()
const chain = defineChain({
  id: 10143,
  name: "Monad fork",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
})
const client = createPublicClient({ chain, transport: http() })
const wallet = createWalletClient({
  chain,
  account: privateKeyToAccount(key),
  transport: http(),
})
const receipts = new Map()

const hex = (n) => `0x${BigInt(n).toString(16)}`
const toOp = (op) => ({
  ...op,
  nonce: BigInt(op.nonce),
  callGasLimit: BigInt(op.callGasLimit),
  verificationGasLimit: BigInt(op.verificationGasLimit),
  preVerificationGas: BigInt(op.preVerificationGas),
  maxFeePerGas: BigInt(op.maxFeePerGas),
  maxPriorityFeePerGas: BigInt(op.maxPriorityFeePerGas),
})

const methods = {
  eth_supportedEntryPoints: () => [ENTRY_POINT],
  eth_chainId: () => hex(chain.id),
  eth_estimateUserOperationGas: () => ({
    preVerificationGas: hex(60_000),
    verificationGasLimit: hex(150_000),
    callGasLimit: hex(700_000),
  }),
  eth_sendUserOperation: async ([raw]) => {
    const op = toOp(raw)
    const userOpHash = getUserOperationHash({
      userOperation: op,
      chainId: chain.id,
      entryPointAddress: ENTRY_POINT,
      entryPointVersion: "0.7",
    })
    const hash = await wallet.writeContract({
      address: ENTRY_POINT,
      abi: entryPoint07Abi,
      functionName: "handleOps",
      args: [[toPackedUserOperation(op)], wallet.account.address],
      gas: 2_000_000n,
    })
    client.waitForTransactionReceipt({ hash }).then((receipt) => {
      const event = parseEventLogs({
        abi: entryPoint07Abi,
        eventName: "UserOperationEvent",
        logs: receipt.logs,
      })[0]
      receipts.set(userOpHash, {
        userOpHash,
        success: event?.args.success ?? false,
        receipt: {
          transactionHash: hash,
          blockNumber: hex(receipt.blockNumber),
        },
      })
    })
    return userOpHash
  },
  eth_getUserOperationReceipt: ([hash]) => receipts.get(hash) ?? null,
}

await client.request({
  method: "anvil_setBalance",
  params: [wallet.account.address, hex(10n ** 21n)],
})

createServer(async (req, res) => {
  let body = ""
  for await (const chunk of req) body += chunk
  const { id, method, params } = JSON.parse(body)
  let reply
  try {
    if (!methods[method]) throw new Error(`Unsupported method ${method}`)
    reply = { jsonrpc: "2.0", id, result: await methods[method](params ?? []) }
  } catch (error) {
    console.error(method, error.shortMessage ?? error.message)
    reply = {
      jsonrpc: "2.0",
      id,
      error: { code: -32000, message: error.shortMessage ?? error.message },
    }
  }
  res.setHeader("Content-Type", "application/json")
  res.end(JSON.stringify(reply))
}).listen(4337, () =>
  console.log("dev bundler on http://localhost:4337 ->", rpc)
)
