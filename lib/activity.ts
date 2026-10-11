import { monad } from "./chain"
import type { Address, Hash } from "viem"

// Envio indexer (HyperIndex) GraphQL endpoint. Optional: without it, payment history and live stats stay hidden.
const ENDPOINT = process.env.NEXT_PUBLIC_ENVIO_GRAPHQL_URL

export const activityEnabled = !!ENDPOINT

export type ChequePayment = {
  id: string
  recipient: Address
  chainId: number
  amount: bigint
  status: "delivered" | "in_transit"
  timestamp: number
  txHash: Hash
  deliveryTxHash: Hash | null
}

export type ActivityStats = {
  cheques: number
  written: bigint
  payments: number
  paidOut: bigint
  crossChainPayments: number
  delivered: number
}

// Resolves to null when the indexer is unset, unreachable or answers with errors, so callers can simply hide.
async function query<T>(
  document: string,
  variables: Record<string, unknown> = {}
): Promise<T | null> {
  if (!ENDPOINT) return null
  // An old endpoint must not show another environment's payment history or totals.
  if (!document.includes("Stats(")) {
    const profile = await query<{ Stats: { id: string }[] }>(
      `{ Stats(where: { id: { _eq: "global-${monad.id}" } }) { id } }`
    )
    if (!profile?.Stats.length) return null
  }
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: document, variables }),
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return null
    const { data, errors } = await response.json()
    return errors ? null : (data as T)
  } catch {
    return null
  }
}

type Numeric = string | number

export async function chequePayments(
  signer: Address
): Promise<ChequePayment[] | null> {
  const data = await query<{
    Payment: {
      id: string
      recipient: Address
      chainId: number
      amount: Numeric
      status: ChequePayment["status"]
      timestamp: Numeric
      txHash: Hash
      deliveryTxHash: Hash | null
    }[]
  }>(
    `query ($cheque: String!) {
      Payment(where: { cheque_id: { _eq: $cheque } }, order_by: { timestamp: desc }) {
        id recipient chainId amount status timestamp txHash deliveryTxHash
      }
    }`,
    // The indexer stores addresses lowercase.
    { cheque: signer.toLowerCase() }
  )
  return (
    data?.Payment.map((p) => ({
      ...p,
      amount: BigInt(p.amount),
      timestamp: Number(p.timestamp),
    })) ?? null
  )
}

export async function activityStats(): Promise<ActivityStats | null> {
  const data = await query<{
    Stats: {
      cheques: number
      written: Numeric
      payments: number
      paidOut: Numeric
      crossChainPayments: number
      delivered: number
    }[]
  }>(
    `{ Stats(where: { id: { _eq: "global-${monad.id}" } }) {
      cheques written payments paidOut crossChainPayments delivered
    } }`
  )
  const stats = data?.Stats[0]
  return stats
    ? {
        ...stats,
        written: BigInt(stats.written),
        paidOut: BigInt(stats.paidOut),
      }
    : null
}
