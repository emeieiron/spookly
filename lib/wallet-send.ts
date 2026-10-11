import {
  parseEther,
  type Account,
  type Address,
  type Chain,
  type Hash,
  type Hex,
  type Transport,
  type WalletClient,
} from "viem"
import { publicClient } from "./cheque-payment"
import { formatMon } from "./money"

export type SignerClient = WalletClient<Transport, Chain, Account>

export async function sendChecked(
  client: SignerClient,
  to: Address,
  data: Hex,
  value = 0n,
  onSubmitted?: (hash: Hash) => void
): Promise<Hash> {
  const from = client.account.address
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
  if (balance < need)
    throw new Error(
      `Not enough MON: this needs ${formatMon(need)}, your wallet has ${formatMon(balance)}.`
    )
  const hash = await client.sendTransaction({
    to,
    data,
    value,
    gas: limit,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  })
  onSubmitted?.(hash)
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== "success") throw new Error("The transaction failed.")
  return hash
}
