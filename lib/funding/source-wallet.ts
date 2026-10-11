import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  http,
  isAddress,
  type Address,
  type EIP1193Provider,
  type Hash,
} from "viem"
import { erc20Abi } from "../chain"
import { sourceChain } from "./chains"
import {
  depositAmount,
  quoteExpiry,
  type FundingLeg,
  type FundingToken,
} from "./model"

export type SourceWallet = {
  address: string
  switchChain: (id: number) => Promise<unknown>
  getEthereumProvider: () => Promise<EIP1193Provider>
}
export function walletRejected(error: unknown): boolean {
  // Viem wraps provider errors in transaction/cause objects. Only code 4001 proves no signature was accepted.
  let cause = error
  for (
    let depth = 0;
    depth < 10 && cause && typeof cause === "object";
    depth++
  ) {
    if ("code" in cause && cause.code === 4001) return true
    cause = "cause" in cause ? cause.cause : null
  }
  return false
}
export async function payDeposit(
  wallet: SourceWallet,
  token: FundingToken,
  leg: FundingLeg,
  beforeSend: () => void
): Promise<Hash> {
  const chain = sourceChain(token)
  const address = leg.quote.quote.depositAddress
  if (
    !chain ||
    !isAddress(wallet.address) ||
    !address ||
    !isAddress(address) ||
    leg.quote.quote.depositMemo
  )
    throw new Error("Use the deposit address to pay from your source wallet.")
  if (leg.payment !== "unpaid" || leg.status !== "PENDING_DEPOSIT")
    throw new Error(
      "This deposit is already being tracked. Do not send it again."
    )
  if (quoteExpiry(leg.quote) <= Date.now() + 30_000)
    throw new Error("This quote has expired. Do not pay it.")
  if (
    leg.quote.quoteRequest.refundTo.toLowerCase() !==
    wallet.address.toLowerCase()
  )
    throw new Error("The refund address must be your connected source wallet.")
  const amount = BigInt(depositAmount(leg.quote))
  const tokenAddress = token.contractAddress
  if (tokenAddress && !isAddress(tokenAddress))
    throw new Error("Invalid source token address")
  if (!tokenAddress && token.symbol !== chain.nativeCurrency.symbol)
    throw new Error("Use an external source wallet for this asset.")
  const rpc = createPublicClient({ chain, transport: http() })
  await wallet.switchChain(chain.id)
  const client = createWalletClient({
    chain,
    account: wallet.address as Address,
    transport: custom(await wallet.getEthereumProvider()),
  })
  if (
    (await client.getChainId()) !== chain.id ||
    (await rpc.getChainId()) !== chain.id
  )
    throw new Error("The source wallet or RPC is on the wrong chain")
  const to = tokenAddress ? (tokenAddress as Address) : address
  const data = tokenAddress
    ? encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [address, amount],
      })
    : undefined
  const value = tokenAddress ? 0n : amount
  const [nativeBalance, fees, gas] = await Promise.all([
    rpc.getBalance({ address: client.account.address }),
    rpc.estimateFeesPerGas(),
    rpc.estimateGas({ account: client.account, to, data, value }),
  ])
  if (tokenAddress) {
    const balance = await rpc.readContract({
      address: tokenAddress as Address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [client.account.address],
    })
    if (balance < amount)
      throw new Error(
        `Not enough ${token.symbol} in the connected wallet on ${chain.name}.`
      )
  }
  const limit = (gas * 12n) / 10n
  if (nativeBalance < value + limit * fees.maxFeePerGas)
    throw new Error(
      `The source wallet needs ${chain.nativeCurrency.symbol} for the payment and network fee.`
    )
  beforeSend()
  return client.sendTransaction({ to, data, value, gas: limit, ...fees })
}
