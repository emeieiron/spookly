"use client"

import { useEffect, useState } from "react"
import type { Address } from "viem"
import { ArrowUpRight, Check, Loader2 } from "lucide-react"
import {
  activityEnabled,
  chequePayments,
  type ChequePayment,
} from "@/lib/activity"
import { EXPLORER, monad } from "@/lib/chain"
import { formatUsdc, shortAddress } from "@/lib/money"
import { networkByChainId } from "@/lib/networks"

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })
function timeAgo(seconds: number) {
  const diff = seconds - Date.now() / 1000
  for (const [unit, size] of [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ] as const)
    if (Math.abs(diff) >= size)
      return relative.format(Math.round(diff / size), unit)
  return "just now"
}

// Payments made from a cheque's link, from the Envio indexer. Refetched whenever the app refreshes the book.
export function ChequePayments({
  signer,
  refreshKey,
}: {
  signer: Address
  refreshKey: number
}) {
  const [payments, setPayments] = useState<ChequePayment[] | null>(null)
  useEffect(() => {
    if (!activityEnabled) return
    let live = true
    chequePayments(signer).then((p) => live && p && setPayments(p))
    return () => {
      live = false
    }
  }, [signer, refreshKey])

  if (!payments?.length) return null
  return (
    <section className="flex flex-col">
      <h2 className="border-b py-3 text-xs font-semibold tracking-widest uppercase">
        Payments{" "}
        <span className="tabular-nums opacity-60">{payments.length}</span>
      </h2>
      <ul className="divide-y">
        {payments.map((p) => (
          <PaymentRow key={p.id} payment={p} />
        ))}
      </ul>
    </section>
  )
}

function PaymentRow({ payment: p }: { payment: ChequePayment }) {
  const network = networkByChainId(p.chainId)
  const delivered = p.status === "delivered"
  const crossChain = p.chainId !== monad.id
  // Link to where the money landed once it has, otherwise to the payment on Monad.
  const href =
    delivered && crossChain && p.deliveryTxHash && network
      ? `${network.explorer}/tx/${p.deliveryTxHash}`
      : `${EXPLORER}/tx/${p.txHash}`
  return (
    <li>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-3 py-3 text-sm"
      >
        <span className="font-semibold tabular-nums">
          {formatUsdc(p.amount)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col text-xs text-muted-foreground">
          <span className="truncate">
            to <span className="font-mono">{shortAddress(p.recipient)}</span> on{" "}
            {network?.name ?? "another network"}
          </span>
          <span className="flex items-center gap-1">
            {delivered ? (
              <Check className="size-3 text-emerald-500" />
            ) : (
              <Loader2 className="size-3 animate-spin" />
            )}
            {delivered
              ? crossChain
                ? "Delivered"
                : "Paid"
              : `On its way to ${network?.name ?? "the payee"}`}{" "}
            · {timeAgo(p.timestamp)}
          </span>
        </span>
        <ArrowUpRight className="size-4 text-muted-foreground" />
      </a>
    </li>
  )
}
