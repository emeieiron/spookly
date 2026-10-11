// End-to-end check in the configured environment: write a cheque and pay 0.5 USDC to Base
// through the bundler, then wait for Circle forwarding. Mainnet requires --broadcast.
// Needs DEPLOYER_PRIVATE_KEY with MON/USDC and BUNDLER_RPC_URL (or testnet ALCHEMY_API_KEY).
// Optional RECIPIENT on the selected Base network defaults to the issuer.
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  parseEther,
  zeroAddress,
  type Address,
  type Hex,
} from "viem"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { base as baseMainnet, baseSepolia } from "viem/chains"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { chequeBookAbi, factoryAbi } from "../lib/abi"
import { deliveryStatus } from "../lib/cctp"
import { FACTORY, IS_MAINNET, erc20Abi, monad } from "../lib/chain"
import {
  planPayment,
  publicClient,
  sendPayment,
  waitForPayment,
} from "../lib/cheque-payment"
import { networkByChainId } from "../lib/networks"
import { NO_PERMIT, signPermit } from "../lib/permit"

import { bundlerEndpoint } from "../config/network.mjs"
if (IS_MAINNET && !process.argv.includes("--broadcast"))
  throw new Error(
    "Mainnet smoke spends real funds. Pass --broadcast explicitly."
  )
const bundlerUrl = bundlerEndpoint()
const baseChain = IS_MAINNET ? baseMainnet : baseSepolia
if (!process.env.DEPLOYER_PRIVATE_KEY || !bundlerUrl || !FACTORY)
  throw new Error(
    "Set DEPLOYER_PRIVATE_KEY and ALCHEMY_API_KEY, and run pnpm contracts:deploy first."
  )

const issuer = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex)
const wallet = createWalletClient({
  account: issuer,
  chain: monad,
  transport: http(),
})
if ((await publicClient.getChainId()) !== monad.id)
  throw new Error("RPC chain mismatch")
const base = createPublicClient({ chain: baseChain, transport: http() })
const network = networkByChainId(baseChain.id)!
const recipient = getAddress(process.env.RECIPIENT ?? issuer.address)
const AMOUNT = 500_000n
const CHEQUE = 650_000n
const FEE_ALLOWANCE = parseEther("0.4")
const KEY_FILE = `.smoke-cheque-${monad.id}.json`

async function send(label: string, hash: Promise<Hex>) {
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: await hash,
  })
  if (receipt.status !== "success")
    throw new Error(`${label} failed: ${receipt.transactionHash}`)
  console.log(`${label}: ${receipt.transactionHash}`)
}

const bookOf = () =>
  publicClient.readContract({
    address: FACTORY!,
    abi: factoryAbi,
    functionName: "bookOf",
    args: [issuer.address],
  })
let book: Address = await bookOf()

// The cheque key is saved locally so later runs reuse the same cheque instead of stranding its funds.
const saved = existsSync(KEY_FILE)
  ? JSON.parse(readFileSync(KEY_FILE, "utf8"))
  : null
let key: Hex | undefined =
  book !== zeroAddress && saved?.book === book ? saved.key : undefined
if (key) {
  const [remaining, , active] = await publicClient.readContract({
    address: book,
    abi: chequeBookAbi,
    functionName: "cheques",
    args: [privateKeyToAccount(key).address],
  })
  if (!active || remaining < AMOUNT + 150_000n) key = undefined
}
if (!key) {
  // One transaction: create or fund the book by permit, deposit fees and write the cheque.
  key = generatePrivateKey()
  const signer = privateKeyToAccount(key).address
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 86400)
  if (book === zeroAddress) {
    const permit = await signPermit(wallet, FACTORY, CHEQUE)
    writeFileSync(KEY_FILE, JSON.stringify({ book: "pending", key }), {
      mode: 0o600,
    })
    await send(
      "create book and write cheque",
      wallet.writeContract({
        address: FACTORY,
        abi: factoryAbi,
        functionName: "createAndWrite",
        args: [signer, CHEQUE, expiry, FEE_ALLOWANCE, permit, "0x"],
        value: FEE_ALLOWANCE,
      })
    )
    book = await bookOf()
  } else {
    const available = await publicClient.readContract({
      address: book,
      abi: chequeBookAbi,
      functionName: "available",
    })
    const pull = CHEQUE > available ? CHEQUE - available : 0n
    const permit = pull > 0n ? await signPermit(wallet, book, pull) : NO_PERMIT
    writeFileSync(KEY_FILE, JSON.stringify({ book, key }), { mode: 0o600 })
    await send(
      "fund and write cheque",
      wallet.writeContract({
        address: book,
        abi: chequeBookAbi,
        functionName: "fundAndWrite",
        args: [signer, CHEQUE, expiry, FEE_ALLOWANCE, pull, permit, "0x"],
        value: FEE_ALLOWANCE,
      })
    )
  }
  writeFileSync(KEY_FILE, JSON.stringify({ book, key }), { mode: 0o600 })
}
console.log("book", book)
const signer = privateKeyToAccount(key).address
console.log("cheque", signer)

const before = await base.readContract({
  address: network.usdc,
  abi: erc20Abi,
  functionName: "balanceOf",
  args: [recipient],
})
const plan = await planPayment(book, signer, network, recipient, AMOUNT)
console.log(
  `paying ${AMOUNT} to ${recipient} on ${baseChain.name}, forwarding fee ${plan.fee}`
)
const sent = await sendPayment(book, key, plan, bundlerUrl)
console.log("userOp", sent.userOpHash)
const burn = await waitForPayment(sent.userOpHash, sent.fromBlock)
console.log("burn tx", burn)

const deadline = Date.now() + 15 * 60_000
for (;;) {
  const delivery = await deliveryStatus(burn).catch(() => ({
    status: "pending" as const,
    forwardTxHash: undefined,
  }))
  console.log("delivery", delivery.status, delivery.forwardTxHash ?? "")
  if (delivery.status === "failed") throw new Error("Forwarding failed")
  if (delivery.forwardTxHash) {
    const receipt = await base.waitForTransactionReceipt({
      hash: delivery.forwardTxHash as Hex,
    })
    console.log(
      `mint on ${baseChain.name}`,
      receipt.status,
      receipt.transactionHash
    )
    break
  }
  if (Date.now() > deadline) throw new Error("Timed out waiting for delivery")
  await new Promise((r) => setTimeout(r, 5_000))
}
const after = await base.readContract({
  address: network.usdc,
  abi: erc20Abi,
  functionName: "balanceOf",
  args: [recipient],
})
console.log(`${baseChain.name} USDC received: ${after - before}`)
if (after - before < AMOUNT)
  throw new Error("Recipient received less than the requested amount")
