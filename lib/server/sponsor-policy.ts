import {
  createPublicClient,
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  http,
  parseEther,
  zeroAddress,
  type Address,
} from "viem"
import { chequeBookAbi, factoryAbi } from "../abi"
import { FACTORY, USDC, erc20Abi, monadTestnet } from "../chain"
import { SPONSOR_CHAIN_ID, type SponsorTransaction } from "../sponsorship"

export const sponsorClient = createPublicClient({
  chain: monadTestnet,
  transport: http(
    process.env.MONAD_RPC_URL ?? monadTestnet.rpcUrls.default.http[0]
  ),
})

// Dev configuration only. Reservations count attempts, including failures and cancellations.
export const sponsorLimits = { wallet: 5, user: 5, app: 100 }
const MAX_VALUE = parseEther("0.3")
const MAX_ESTIMATED_FEE = parseEther("0.25")
const MAX_GAS = 5_000_000n

export function parseSponsorTransaction(value: unknown): SponsorTransaction {
  if (!value || typeof value !== "object")
    throw new Error("Invalid transaction.")
  const tx = value as Record<string, unknown>
  if (
    Object.keys(tx).some(
      (key) => !["from", "to", "data", "value"].includes(key)
    ) ||
    typeof tx.from !== "string" ||
    typeof tx.to !== "string" ||
    typeof tx.data !== "string" ||
    !/^0x(?:[\da-f]{2}){4,8192}$/i.test(tx.data) ||
    typeof tx.value !== "string" ||
    !/^0x[\da-f]{1,32}$/i.test(tx.value)
  )
    throw new Error("Invalid transaction.")
  const amount = BigInt(tx.value)
  if (amount > MAX_VALUE)
    throw new Error("Transaction value exceeds sponsorship limits.")
  return {
    from: getAddress(tx.from),
    to: getAddress(tx.to),
    data: tx.data as SponsorTransaction["data"],
    value: tx.value as SponsorTransaction["value"],
  }
}

export function allowedSponsorCall(
  tx: SponsorTransaction,
  book: Address | null
): boolean {
  try {
    if (FACTORY && tx.to === getAddress(FACTORY)) {
      const call = decodeFunctionData({ abi: factoryAbi, data: tx.data })
      if (call.functionName !== "createAndWrite" || book) return false
      return (
        encodeFunctionData({ abi: factoryAbi, ...call }).toLowerCase() ===
        tx.data.toLowerCase()
      )
    }
    if (book && tx.to === getAddress(book)) {
      const call = decodeFunctionData({ abi: chequeBookAbi, data: tx.data })
      if (
        call.functionName !== "fundAndWrite" &&
        call.functionName !== "cancel"
      )
        return false
      if (call.functionName === "cancel" && BigInt(tx.value) !== 0n)
        return false
      return (
        encodeFunctionData({ abi: chequeBookAbi, ...call }).toLowerCase() ===
        tx.data.toLowerCase()
      )
    }
    if (tx.to === getAddress(USDC) && BigInt(tx.value) === 0n) {
      const call = decodeFunctionData({ abi: erc20Abi, data: tx.data })
      return (
        call.functionName === "transfer" &&
        encodeFunctionData({ abi: erc20Abi, ...call }).toLowerCase() ===
          tx.data.toLowerCase()
      )
    }
  } catch {
    /* Unrecognized calldata is never sponsored. */
  }
  return false
}

export function sponsorApproval(tx: SponsorTransaction): bigint {
  if (FACTORY && tx.to === getAddress(FACTORY)) {
    const call = decodeFunctionData({ abi: factoryAbi, data: tx.data })
    return call.functionName === "createAndWrite" ? call.args[1] : 0n
  }
  if (tx.to === getAddress(USDC)) return 0n
  const call = decodeFunctionData({ abi: chequeBookAbi, data: tx.data })
  return call.functionName === "fundAndWrite" ? call.args[4] : 0n
}

export async function validateSponsorTransaction(tx: SponsorTransaction) {
  if ((await sponsorClient.getChainId()) !== SPONSOR_CHAIN_ID)
    throw new Error("Sponsorship requires Monad testnet.")
  const book = FACTORY
    ? await sponsorClient.readContract({
        address: FACTORY,
        abi: factoryAbi,
        functionName: "bookOf",
        args: [tx.from],
      })
    : zeroAddress
  if (!allowedSponsorCall(tx, book === zeroAddress ? null : book)) return false
  const [gas, fees, balance] = await Promise.all([
    sponsorClient.estimateGas({
      account: tx.from,
      to: tx.to,
      data: tx.data,
      value: BigInt(tx.value),
      // Simulate the existing EOA permit path for gas estimation. The sponsored
      // batch supplies the allowance before writing, including after delegation.
      stateOverride: [
        { address: tx.from, balance: parseEther("1000000"), code: "0x" },
      ],
    }),
    sponsorClient.estimateFeesPerGas(),
    sponsorClient.getBalance({ address: tx.from }),
  ])
  // The app covers transaction gas, never the cheque's recipient fee allowance.
  if (balance < BigInt(tx.value))
    throw new Error("Not enough MON for this cheque's fee allowance.")
  const batchEstimate = gas + 200_000n
  return (
    batchEstimate <= MAX_GAS &&
    batchEstimate * fees.maxFeePerGas <= MAX_ESTIMATED_FEE
  )
}
