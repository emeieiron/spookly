import {
  BaseError,
  UserRejectedRequestError,
  parseEther,
  type Account,
  type Address,
  type Chain,
  type Hash,
  type Hex,
  type Transport,
  type WalletClient,
} from "viem"
import { monad } from "./chain"
import { publicClient } from "./spook-payment"
import { formatMon } from "./money"
import { acknowledgeSponsor } from "./sponsor-pending"
import { isDelegated, reserveShortfall, reserveMessage } from "./monad-reserve"

export type SignerClient = WalletClient<Transport, Chain, Account>
export type SponsorSender = (tx: {
  client: SignerClient
  from: Address
  to: Address
  data: Hex
  value: bigint
}) => Promise<Hash | null>

export class FinalTransactionError extends Error {}

export async function sendValidated(
  client: SignerClient,
  to: Address,
  data: Hex,
  value = 0n,
  sponsor?: SponsorSender,
  beforeNative?: () => Promise<void>,
  onSubmitted?: (hash: Hash) => void
): Promise<Hash> {
  const from = client.account.address
  const [walletChain, rpcChain] = await Promise.all([
    client.getChainId(),
    publicClient.getChainId(),
  ])
  if (walletChain !== monad.id || rpcChain !== monad.id)
    throw new Error(`Please connect to ${monad.name}.`)
  const sponsoredHash = await sponsor?.({ client, from, to, data, value })
  if (sponsoredHash) {
    onSubmitted?.(sponsoredHash)
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: sponsoredHash,
    })
    acknowledgeSponsor(from, sponsoredHash)
    if (receipt.status !== "success")
      throw new FinalTransactionError("The transaction failed.")
    return sponsoredHash
  }
  const valueBalance = await publicClient.getBalance({ address: from })
  let delegated = false
  if (value > 0n) {
    const code = await publicClient.getCode({ address: from })
    delegated = isDelegated(code)
    const shortfall = reserveShortfall(valueBalance, value)
    if (delegated && shortfall > 0n)
      throw new FinalTransactionError(reserveMessage(shortfall))
  }
  if (valueBalance < value)
    throw new FinalTransactionError(
      `Not enough MON: this needs ${formatMon(value)}, your wallet has ${formatMon(valueBalance)}.`
    )
  await beforeNative?.()
  const [gas, fees, balance] = await Promise.all([
    // Monad refuses to estimate when the balance is short, so estimate as if funded and check the balance below.
    publicClient.estimateGas({
      account: from,
      to,
      data,
      value,
      stateOverride: [{ address: from, balance: parseEther("1000000") }],
    }),
    publicClient.estimateFeesPerGas(),
    publicClient.getBalance({ address: from }),
  ])
  // Monad includes a transaction that can pay its gas but not its value, charges the full gas limit and then
  // reverts it, so value and the gas limit must be covered together before signing.
  const limit = (gas * 11n) / 10n
  const need = value + limit * fees.maxFeePerGas
  // An approval in beforeNative can spend gas after the first balance check.
  const shortfall = reserveShortfall(balance, value)
  if (delegated && shortfall > 0n)
    throw new FinalTransactionError(reserveMessage(shortfall))
  if (balance < need)
    throw new FinalTransactionError(
      `Not enough MON: this needs ${formatMon(need)}, your wallet has ${formatMon(balance)}.`
    )
  let hash: Hash
  try {
    hash = await client.sendTransaction({
      to,
      data,
      value,
      gas: limit,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    })
  } catch (error) {
    if (
      error instanceof BaseError &&
      error.walk(
        (cause) => cause instanceof UserRejectedRequestError
      ) instanceof UserRejectedRequestError
    )
      throw new FinalTransactionError("The wallet request was cancelled.")
    throw error // An unknown RPC error may follow a successful broadcast.
  }
  onSubmitted?.(hash)
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== "success")
    throw new FinalTransactionError("The transaction failed.")
  return hash
}
