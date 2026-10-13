import { encodeFunctionData, type Address } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { chequeBookAbi, factoryAbi } from "./abi"
import { FEE_ALLOWANCE, keyStorage, type Book } from "./cheque-book"
import { FACTORY, USDC, erc20Abi } from "./chain"
import { publicClient } from "./cheque-payment"
import { sealChequeKey, type LinkVault } from "./link-vault"
import { NO_PERMIT, signPermit } from "./permit"
import {
  FinalTransactionError,
  sendChecked,
  type SignerClient,
  type SponsorSender,
} from "./wallet-send"
import {
  clearWriteDraft,
  readWriteDraft,
  saveWriteDraft,
  type WriteDraft,
} from "./write-draft"
import {
  acknowledgeSponsor,
  clearPendingSponsor,
  readPendingSponsor,
} from "./sponsor-pending"

export async function prepareChequeWrite(
  client: SignerClient,
  book: Book | null,
  vault: LinkVault | null,
  amount: bigint,
  days: number
): Promise<WriteDraft> {
  const account = client.account.address
  const previous = readWriteDraft(account)
  if (previous) {
    if (previous.amount !== String(amount) || previous.days !== days)
      throw new Error(
        "A previous cheque is still being checked. Retry the same amount and expiry first."
      )
    return previous
  }
  if (!FACTORY) throw new Error("Cheque writing is unavailable.")
  const key = generatePrivateKey()
  const signer = privateKeyToAccount(key).address
  localStorage.setItem(keyStorage(account, signer), key)
  const expiry = BigInt(Math.floor(Date.now() / 1000) + days * 86400)
  const pull = book
    ? amount > book.available
      ? amount - book.available
      : 0n
    : amount
  const spare = book?.spareGas ?? 0n
  const value = FEE_ALLOWANCE > spare ? FEE_ALLOWANCE - spare : 0n
  const to = book?.address ?? FACTORY
  const code =
    pull > 0n ? await publicClient.getCode({ address: account }) : undefined
  const permit =
    pull > 0n && (!code || code === "0x")
      ? await signPermit(client, to, pull)
      : NO_PERMIT
  const sealed = vault ? await sealChequeKey(vault, key) : "0x"
  const data = book
    ? encodeFunctionData({
        abi: chequeBookAbi,
        functionName: "fundAndWrite",
        args: [signer, amount, expiry, FEE_ALLOWANCE, pull, permit, sealed],
      })
    : encodeFunctionData({
        abi: factoryAbi,
        functionName: "createAndWrite",
        args: [signer, amount, expiry, FEE_ALLOWANCE, permit, sealed],
      })
  const draft = {
    key,
    signer,
    amount: String(amount),
    days,
    to,
    data,
    value: String(value),
    pull: String(pull),
  }
  saveWriteDraft(account, draft)
  return draft
}

export async function prepareNativeChequeWrite(
  client: SignerClient,
  draft: WriteDraft
) {
  const pull = BigInt(draft.pull)
  if (pull === 0n) return
  // Wallets with code fund through an exact allowance. Ordinary wallets use
  // the permit already stored in the draft.
  const code = await publicClient.getCode({ address: client.account.address })
  if (!code || code === "0x") return
  const allowance = await publicClient.readContract({
    address: USDC,
    abi: erc20Abi,
    functionName: "allowance",
    args: [client.account.address, draft.to],
  })
  if (allowance < pull)
    await sendChecked(
      client,
      USDC,
      encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [draft.to, pull],
      })
    )
}

// Funding and ordinary writes share the same persisted signer and receipt recovery.
export async function writeCheque(
  wallet: { account: Address; client: SignerClient; book: Book | null },
  amount: bigint,
  days: number,
  vault: LinkVault | null,
  sponsor?: SponsorSender
) {
  const { account, client, book } = wallet
  const draft = await prepareChequeWrite(client, book, vault, amount, days)
  const { key, signer } = draft
  try {
    if (
      book?.cheques.some(
        (cheque) => cheque.signer.toLowerCase() === signer.toLowerCase()
      )
    ) {
      // Reconcile an already written cheque after a lost submission response.
      const pending = readPendingSponsor(account)
      if (pending?.transaction.data === draft.data) clearPendingSponsor(account)
    } else if (draft.hash) {
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: draft.hash,
      })
      acknowledgeSponsor(account, draft.hash)
      if (receipt.status !== "success")
        throw new FinalTransactionError("The transaction failed.")
    } else {
      await sendChecked(
        client,
        draft.to,
        draft.data,
        BigInt(draft.value),
        sponsor,
        () => prepareNativeChequeWrite(client, draft),
        (hash) => saveWriteDraft(account, { ...draft, hash })
      )
    }
  } catch (error) {
    if (error instanceof FinalTransactionError && !readPendingSponsor(account))
      clearWriteDraft(account)
    throw error
  }
  const bookAddress =
    book?.address ??
    (await publicClient.readContract({
      address: FACTORY!,
      abi: factoryAbi,
      functionName: "bookOf",
      args: [account],
    }))
  clearWriteDraft(account)
  return { signer, bookAddress, key }
}
