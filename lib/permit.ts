import {
  parseSignature,
  zeroHash,
  type Account,
  type Address,
  type Chain,
  type Transport,
  type WalletClient,
} from "viem"
import { USDC, monadTestnet } from "./chain"
import { publicClient } from "./cheque-payment"

export const NO_PERMIT = { deadline: 0n, v: 0, r: zeroHash, s: zeroHash }

const noncesAbi = [
  {
    type: "function",
    name: "nonces",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const

// EIP-2612 permit for Circle's USDC (domain "USDC", version "2"), so funding needs no approve transaction.
export async function signPermit(
  client: WalletClient<Transport, Chain, Account>,
  spender: Address,
  value: bigint
) {
  const owner = client.account.address
  const nonce = await publicClient.readContract({
    address: USDC,
    abi: noncesAbi,
    functionName: "nonces",
    args: [owner],
  })
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
  const signature = await client.signTypedData({
    domain: {
      name: "USDC",
      version: "2",
      chainId: monadTestnet.id,
      verifyingContract: USDC,
    },
    types: {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Permit",
    message: { owner, spender, value, nonce, deadline },
  })
  const { r, s, v, yParity } = parseSignature(signature)
  return { deadline, v: Number(v ?? BigInt(yParity) + 27n), r, s }
}
