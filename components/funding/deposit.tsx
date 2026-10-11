"use client"

import { useState } from "react"
import { formatUnits } from "viem"
import { Check, Copy, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { QrCode } from "@/components/qr-code"
import {
  depositAmount,
  quoteExpiry,
  terminal,
  type FundingLeg,
  type FundingToken,
} from "@/lib/funding/model"

const STATUS: Record<FundingLeg["status"], string> = {
  PENDING_DEPOSIT: "Waiting for payment",
  KNOWN_DEPOSIT_TX: "Confirming payment",
  INCOMPLETE_DEPOSIT:
    "Deposit is below the required amount. Awaiting refund at the deadline.",
  PROCESSING: "Arriving on Monad",
  SUCCESS: "Received on Monad",
  REFUNDED: "Refunded to your source address",
  FAILED: "Funding failed. Check the source transaction before trying again.",
}
const CHAIN_LABELS: Record<string, string> = {
  eth: "Ethereum",
  arb: "Arbitrum",
  op: "Optimism",
  avax: "Avalanche",
  sol: "Solana",
  btc: "Bitcoin",
  pol: "Polygon",
}
export const chainLabel = (chain: string) =>
  CHAIN_LABELS[chain] ?? chain.charAt(0).toUpperCase() + chain.slice(1)

export function Deposit({
  leg,
  token,
  expired,
  busy,
  canPay,
  onPay,
}: {
  leg: FundingLeg
  token: FundingToken
  expired: boolean
  busy: boolean
  canPay: boolean
  onPay: () => void
}) {
  const [copied, setCopied] = useState(false)
  const pending = leg.status === "PENDING_DEPOSIT" && leg.payment === "unpaid"
  const address = leg.quote.quote.depositAddress!
  return (
    <section className="flex flex-col gap-3 border-t pt-3">
      <p
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 text-sm"
      >
        {leg.status === "SUCCESS" ? (
          <Check className="size-4" />
        ) : (
          !terminal(leg.status) && <Loader2 className="size-4 animate-spin" />
        )}
        {leg.target.symbol}: {STATUS[leg.status]}
      </p>
      {pending && !expired && (
        <>
          {canPay && (
            <Button variant="outline" disabled={busy} onClick={onPay}>
              Pay{" "}
              {formatUnits(BigInt(depositAmount(leg.quote)), token.decimals)}{" "}
              {token.symbol} in wallet
            </Button>
          )}
          <p className="text-xs text-muted-foreground">
            {canPay ? "Or send" : "Send"} exactly{" "}
            {formatUnits(BigInt(depositAmount(leg.quote)), token.decimals)}{" "}
            {token.symbol} on {chainLabel(token.blockchain)} to this address
            before{" "}
            {new Date(quoteExpiry(leg.quote)).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
            .
          </p>
          <QrCode text={address} className="mx-auto w-32 bg-white p-1" />
          <p className="font-mono text-xs break-all">{address}</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              navigator.clipboard
                .writeText(address)
                .then(() => setCopied(true))
                .catch(() => setCopied(false))
            }
          >
            <Copy />
            {copied ? "Copied" : "Copy deposit address"}
          </Button>
          {leg.quote.quote.depositMemo && (
            <p className="text-sm break-all">
              Required memo:{" "}
              <span className="font-mono">{leg.quote.quote.depositMemo}</span>
            </p>
          )}
          {!!leg.quote.quote.refundFee && (
            <p className="text-xs text-muted-foreground">
              If refunded, the service deducts{" "}
              {formatUnits(BigInt(leg.quote.quote.refundFee), token.decimals)}{" "}
              {token.symbol}.
            </p>
          )}
        </>
      )}
      {pending && expired && (
        <p className="text-xs text-muted-foreground">
          Deposit window closed. Do not send more funds. We’ll keep checking for
          a payment or refund.
        </p>
      )}
      {leg.payment === "signing" && (
        <p className="text-xs text-muted-foreground">
          Payment confirmation is unknown. Check your source wallet before
          sending anything else. This deposit remains saved.
        </p>
      )}
      {leg.transactionHash && (
        <p className="font-mono text-xs break-all">
          Source transaction: {leg.transactionHash}
        </p>
      )}
      {!terminal(leg.status) && (
        <p className="text-xs text-muted-foreground">
          You can leave this page. Return to Receive or Write to resume
          tracking.
        </p>
      )}
    </section>
  )
}
