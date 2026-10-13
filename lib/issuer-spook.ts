import { encodeFunctionData, type Address } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { spookBookAbi, factoryAbi } from "./abi"
import { FEE_ALLOWANCE, keyStorage, type Book } from "./spook-book"
import { FACTORY, USDC, erc20Abi } from "./chain"
import { publicClient } from "./spook-payment"
import { sealSpookKey, type LinkVault } from "./link-vault"
import { NO_PERMIT, signPermit } from "./permit"
import {
  FinalTransactionError,
  sendValidated,
  type SignerClient,
  type SponsorSender,
} from "./wallet-send"
import {
  clearSpookDraft,
  readSpookDraft,
  saveSpookDraft,
  type SpookDraft,
} from "./spook-draft"
import {
  acknowledgeSponsor,
  clearPendingSponsor,
  readPendingSponsor,
} from "./sponsor-pending"

export async function prepareSpookCreation(
  client: SignerClient,
  book: Book | null,
  vault: LinkVault | null,
  amount: bigint,
  days: number
): Promise<SpookDraft> {
  const account = client.account.address
  const previous = readSpookDraft(account)
  if (previous) {
    if (previous.amount !== String(amount) || previous.days !== days)
      throw new Error(
        "A previous spook is still being checked. Retry the same amount and expiry first."
      )
    return previous
  }
  if (!FACTORY) throw new Error("Spook creation is unavailable.")
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
  const sealed = vault ? await sealSpookKey(vault, key) : "0x"
  const data = book
    ? encodeFunctionData({
        abi: spookBookAbi,
        functionName: "fundAndSpook",
        args: [signer, amount, expiry, FEE_ALLOWANCE, pull, permit, sealed],
      })
    : encodeFunctionData({
        abi: factoryAbi,
        functionName: "createAndSpook",
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
  saveSpookDraft(account, draft)
  return draft
}

export async function prepareNativeSpookCreation(
  client: SignerClient,
  draft: SpookDraft
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
    await sendValidated(
      client,
      USDC,
      encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [draft.to, pull],
      })
    )
}

// Funding and Spook creation share the same persisted signer and receipt recovery.
export async function createSpook(
  wallet: { account: Address; client: SignerClient; book: Book | null },
  amount: bigint,
  days: number,
  vault: LinkVault | null,
  sponsor?: SponsorSender
) {
  const { account, client, book } = wallet
  const draft = await prepareSpookCreation(client, book, vault, amount, days)
  const { key, signer } = draft
  try {
    if (
      book?.spooks.some(
        (spook) => spook.signer.toLowerCase() === signer.toLowerCase()
      )
    ) {
      // Reconcile an already created spook after a lost submission response.
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
      await sendValidated(
        client,
        draft.to,
        draft.data,
        BigInt(draft.value),
        sponsor,
        () => prepareNativeSpookCreation(client, draft),
        (hash) => saveSpookDraft(account, { ...draft, hash })
      )
    }
  } catch (error) {
    if (error instanceof FinalTransactionError && !readPendingSponsor(account))
      clearSpookDraft(account)
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
  clearSpookDraft(account)
  return { signer, bookAddress, key }
}
