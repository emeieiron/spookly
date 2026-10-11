import { IRIS_API, MONAD_DOMAIN } from "./chain"

// Circle Forwarding Service: "cctp-forward", version 0, no extra data. Circle submits the destination mint.
export const FORWARD_HOOK =
  "0x636374702d666f72776172640000000000000000000000000000000000000000"
export const STANDARD_FINALITY = 2000

export const tokenMessengerAbi = [
  {
    type: "function",
    name: "depositForBurnWithHook",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
      { name: "destinationCaller", type: "bytes32" },
      { name: "maxFee", type: "uint256" },
      { name: "minFinalityThreshold", type: "uint32" },
      { name: "hookData", type: "bytes" },
    ],
    outputs: [],
  },
] as const

// Standard transfers from Monad carry no protocol fee; Circle charges only the forwarding fee.
export async function forwardingFee(domain: number): Promise<bigint> {
  const response = await fetch(
    `${IRIS_API}/v2/burn/USDC/fees/${MONAD_DOMAIN}/${domain}?forward=true`
  )
  if (!response.ok) throw new Error("Couldn't get the network fee. Try again.")
  const quotes: {
    finalityThreshold: number
    minimumFee: number
    forwardFee?: { med: number }
  }[] = await response.json()
  const standard = quotes.find((q) => q.finalityThreshold === 2000)
  if (!standard?.forwardFee || standard.minimumFee !== 0)
    throw new Error("This network isn't available right now.")
  return BigInt(standard.forwardFee.med)
}

export type Delivery = {
  status: "pending" | "attested" | "forwarding" | "delivered" | "failed"
  forwardTxHash?: string
}

export async function deliveryStatus(burnTxHash: string): Promise<Delivery> {
  const response = await fetch(
    `${IRIS_API}/v2/messages/${MONAD_DOMAIN}?transactionHash=${burnTxHash}`
  )
  if (response.status === 404) return { status: "pending" }
  if (!response.ok) throw new Error("Couldn't check delivery status.")
  const message = (await response.json()).messages?.[0]
  if (!message) return { status: "pending" }
  const state = String(message.forwardState ?? "").toUpperCase()
  const forwardTxHash = message.forwardTxHash || undefined
  if (/FAIL/.test(state)) return { status: "failed", forwardTxHash }
  if (/CONFIRM|COMPLETE|SUCCE/.test(state))
    return { status: "delivered", forwardTxHash }
  if (forwardTxHash) return { status: "forwarding", forwardTxHash }
  return { status: message.status === "complete" ? "attested" : "pending" }
}
