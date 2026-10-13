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
import { spookBookAbi, factoryAbi } from "../abi"
import { FACTORY, USDC, erc20Abi, monad } from "../chain"
import {
  SPONSOR_CHAIN_ID,
  sponsorRequest,
  type SponsorTransaction,
} from "../sponsorship"
import { sponsorExecution } from "./sponsor-execution"
import {
  isDelegated,
  reserveShortfall,
  reserveMessage,
  SponsorFundingError,
} from "../monad-reserve"

export const sponsorClient = createPublicClient({
  chain: monad,
  transport: http(process.env.MONAD_RPC_URL ?? monad.rpcUrls.default.http[0]),
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
      if (call.functionName !== "createAndSpook" || book) return false
      return (
        encodeFunctionData({ abi: factoryAbi, ...call }).toLowerCase() ===
        tx.data.toLowerCase()
      )
    }
    if (book && tx.to === getAddress(book)) {
      const call = decodeFunctionData({ abi: spookBookAbi, data: tx.data })
      if (
        call.functionName !== "fundAndSpook" &&
        call.functionName !== "cancel"
      )
        return false
      if (call.functionName === "cancel" && BigInt(tx.value) !== 0n)
        return false
      return (
        encodeFunctionData({ abi: spookBookAbi, ...call }).toLowerCase() ===
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
    return call.functionName === "createAndSpook" ? call.args[1] : 0n
  }
  if (tx.to === getAddress(USDC)) return 0n
  const call = decodeFunctionData({ abi: spookBookAbi, data: tx.data })
  return call.functionName === "fundAndSpook" ? call.args[4] : 0n
}

export async function validateSponsorTransaction(tx: SponsorTransaction) {
  if (
    monad.id !== SPONSOR_CHAIN_ID ||
    (await sponsorClient.getChainId()) !== SPONSOR_CHAIN_ID
  )
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
  const [balance, code] = await Promise.all([
    sponsorClient.getBalance({ address: tx.from }),
    sponsorClient.getCode({ address: tx.from }),
  ])
  const shortfall = reserveShortfall(balance, BigInt(tx.value))
  if (shortfall > 0n) {
    // An undelegated EOA can still use the original self-funded path. Avoid
    // delegating it into a native-value transaction Monad cannot execute.
    if (!isDelegated(code)) return false
    throw new SponsorFundingError(reserveMessage(shortfall))
  }
  if (code && code !== "0x" && !isDelegated(code)) return false
  const calls = sponsorRequest("", "", "", tx, 0, sponsorApproval(tx)).body
    .params.calls
  const [gas, fees] = await Promise.all([
    sponsorClient.estimateGas(sponsorExecution(tx.from, code, calls)),
    sponsorClient.estimateFeesPerGas(),
  ])
  const batchEstimate = gas + 200_000n
  return (
    batchEstimate <= MAX_GAS &&
    batchEstimate * fees.maxFeePerGas <= MAX_ESTIMATED_FEE
  )
}
