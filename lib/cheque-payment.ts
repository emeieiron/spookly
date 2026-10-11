import {
  createPublicClient,
  encodeFunctionData,
  getAbiItem,
  http,
  pad,
  zeroHash,
  type Address,
  type Hash,
  type Hex,
} from "viem"
import { privateKeyToAccount } from "viem/accounts"
import {
  createBundlerClient,
  entryPoint07Abi,
  formatUserOperationRequest,
  getUserOperationHash,
  toSmartAccount,
  type UserOperation,
} from "viem/account-abstraction"
import { chequeBookAbi } from "./abi"
import { forwardingFee } from "./cctp"
import { ENTRY_POINT, monad } from "./chain"
import { isLocal, type Network } from "./networks"

export const publicClient = createPublicClient({
  chain: monad,
  transport: http(),
})

export type ChequeState = {
  remaining: bigint
  expiry: number
  active: boolean
  gasLeft: bigint
  gasBalance: bigint
  checkedAt: number
}

export async function readCheque(
  book: Address,
  signer: Address
): Promise<ChequeState> {
  const [[remaining, expiry, active, gasLeft], gasBalance] = await Promise.all([
    publicClient.readContract({
      address: book,
      abi: chequeBookAbi,
      functionName: "cheques",
      args: [signer],
    }),
    publicClient.readContract({
      address: book,
      abi: chequeBookAbi,
      functionName: "gasBalance",
    }),
  ])
  return {
    remaining,
    expiry: Number(expiry),
    active,
    gasLeft,
    gasBalance,
    checkedAt: Date.now(),
  }
}

export type PaymentPlan = {
  network: Network
  recipient: Address
  amount: bigint
  fee: bigint
  total: bigint
  callData: Hex
}

export async function planPayment(
  book: Address,
  signer: Address,
  network: Network,
  recipient: Address,
  amount: bigint
): Promise<PaymentPlan> {
  if (isLocal(network)) {
    const callData = encodeFunctionData({
      abi: chequeBookAbi,
      functionName: "pay",
      args: [signer, recipient, amount],
    })
    return { network, recipient, amount, fee: 0n, total: amount, callData }
  }
  const fee = await forwardingFee(network.domain)
  const total = amount + fee
  const callData = encodeFunctionData({
    abi: chequeBookAbi,
    functionName: "payCrossChain",
    args: [signer, network.domain, pad(recipient, { size: 32 }), total, fee],
  })
  return { network, recipient, amount, fee, total, callData }
}

function chequeAccount(book: Address, key: Hex) {
  const signer = privateKeyToAccount(key)
  return toSmartAccount({
    client: publicClient,
    entryPoint: { address: ENTRY_POINT, abi: entryPoint07Abi, version: "0.7" },
    getAddress: async () => book,
    getFactoryArgs: async () => ({
      factory: undefined,
      factoryData: undefined,
    }),
    // Each cheque has its own nonce sequence keyed by its signer address.
    getNonce: async () =>
      publicClient.readContract({
        address: ENTRY_POINT,
        abi: entryPoint07Abi,
        functionName: "getNonce",
        args: [book, BigInt(signer.address)],
      }),
    encodeCalls: async () => {
      throw new Error("Pass callData directly.")
    },
    getStubSignature: async () =>
      signer.signMessage({ message: { raw: zeroHash } }),
    signUserOperation: async ({ chainId = monad.id, ...operation }) =>
      signer.signMessage({
        message: {
          raw: getUserOperationHash({
            userOperation: { ...operation, sender: book },
            chainId,
            entryPointAddress: ENTRY_POINT,
            entryPointVersion: "0.7",
          }),
        },
      }),
    signMessage: async () => {
      throw new Error("Cheque keys only sign payments.")
    },
    signTypedData: async () => {
      throw new Error("Cheque keys only sign payments.")
    },
  })
}

// Rundler recommends a 50% base-fee buffer; a slightly higher tip lets a stale quote be replaced.
async function estimateFees(priority: () => Promise<Hex>) {
  const [fees, block, quoted] = await Promise.all([
    publicClient.estimateFeesPerGas(),
    publicClient.getBlock({ blockTag: "latest" }),
    priority(),
  ])
  const tip =
    BigInt(quoted) > fees.maxPriorityFeePerGas
      ? BigInt(quoted)
      : fees.maxPriorityFeePerGas
  const maxPriorityFeePerGas = (tip * 120n + 99n) / 100n
  const buffered =
    ((block.baseFeePerGas ?? 0n) * 150n) / 100n + maxPriorityFeePerGas
  const ordinary = fees.maxFeePerGas + maxPriorityFeePerGas
  return {
    maxPriorityFeePerGas,
    maxFeePerGas: buffered > ordinary ? buffered : ordinary,
  }
}

export type Sent = { userOpHash: Hash; fromBlock: bigint }

export async function sendPayment(
  book: Address,
  key: Hex,
  plan: PaymentPlan,
  bundlerUrl = "/api/bundler"
): Promise<Sent> {
  const state = await readCheque(book, privateKeyToAccount(key).address)
  if (!state.active) throw new Error("This cheque has been cancelled.")
  if (state.expiry * 1000 <= Date.now())
    throw new Error("This cheque has expired.")
  if (plan.total > state.remaining)
    throw new Error("That's more than this cheque has left.")
  try {
    await publicClient.call({
      account: ENTRY_POINT,
      to: book,
      data: plan.callData,
    })
  } catch {
    throw new Error(
      "This payment can't go through. Check the amount and try again."
    )
  }

  const account = await chequeAccount(book, key)
  const bundler = createBundlerClient({
    account,
    client: publicClient,
    chain: monad,
    transport: http(bundlerUrl, { retryCount: 0 }),
    userOperation: {
      estimateFeesPerGas: async ({ bundlerClient }) =>
        estimateFees(() =>
          // rundler_maxPriorityFeePerGas is Alchemy-specific; other bundlers fall back to the node's estimate.
          (
            bundlerClient.request({
              method: "rundler_maxPriorityFeePerGas" as never,
            }) as Promise<Hex>
          ).catch(() => "0x0" as Hex)
        ),
    },
  })
  const prepared = await bundler.prepareUserOperation({
    callData: plan.callData,
  })
  const cost =
    (prepared.verificationGasLimit +
      prepared.callGasLimit +
      prepared.preVerificationGas) *
    prepared.maxFeePerGas
  if (cost > state.gasLeft || cost > state.gasBalance)
    throw new Error(
      "This cheque's fee allowance has run out. Ask the issuer to top it up."
    )

  const signature = await account.signUserOperation(prepared)
  const fromBlock = await publicClient.getBlockNumber()
  const userOpHash = (await bundler.request({
    method: "eth_sendUserOperation",
    params: [
      formatUserOperationRequest({
        ...prepared,
        signature,
      } as UserOperation<"0.7">),
      ENTRY_POINT,
    ],
  })) as Hash
  return { userOpHash, fromBlock }
}

const userOperationEvent = getAbiItem({
  abi: entryPoint07Abi,
  name: "UserOperationEvent",
})

// Reads EntryPoint logs directly so confirmation doesn't depend on the bundler. Public Monad RPC caps
// eth_getLogs at 100 blocks, so scan in chunks from the block before submission.
export async function waitForPayment(
  userOpHash: Hash,
  fromBlock: bigint,
  timeoutMs = 120_000
): Promise<Hash> {
  const deadline = Date.now() + timeoutMs
  let from = fromBlock
  while (Date.now() < deadline) {
    const latest = await publicClient.getBlockNumber()
    while (from <= latest) {
      const to = from + 99n < latest ? from + 99n : latest
      const [log] = await publicClient.getLogs({
        address: ENTRY_POINT,
        event: userOperationEvent,
        args: { userOpHash },
        fromBlock: from,
        toBlock: to,
      })
      if (log) {
        if (!log.args.success)
          throw new Error("The payment didn't go through. No USDC was sent.")
        return log.transactionHash
      }
      from = to + 1n
    }
    await new Promise((r) => setTimeout(r, 1_500))
  }
  throw new Error("Still waiting for the network to confirm this payment.")
}

export const errorMessage = (e: unknown) =>
  e instanceof Error
    ? ((e as { shortMessage?: string }).shortMessage ?? e.message).split(
        "\n"
      )[0]
    : "Something went wrong."
