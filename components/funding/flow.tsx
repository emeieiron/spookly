"use client"

import { useId } from "react"
import { formatUnits } from "viem"
import { Loader2 } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  depositAmount,
  canCloseUnpaid,
  quoteExpiry,
  terminal,
} from "@/lib/funding/model"
import { sourceChain } from "@/lib/funding/chains"
import { chainLabel } from "@/lib/chain-catalog"
import { APP_HOME } from "@/lib/hosts"
import { ChainName } from "@/components/chain-name"
import { AssetName } from "@/components/asset-name"
import { useFunding, type FundingOptions } from "./use-funding"
import { Deposit } from "./deposit"

export function FundingFlow({
  account,
  purpose,
  targets,
  draft,
  actionLabel,
  onReady,
  disabled = false,
}: FundingOptions) {
  const id = useId()
  const {
    session,
    loaded,
    save,
    closed,
    close,
    tokens,
    chain,
    setChain,
    asset,
    setAsset,
    refund,
    setRefund,
    busy,
    error,
    clock,
    token,
    ready,
    persist,
    review,
    pay,
    finish,
    connected,
  } = useFunding({
    account,
    purpose,
    targets,
    draft,
    actionLabel,
    onReady,
    disabled,
  })
  if (!loaded)
    return <p className="text-xs text-muted-foreground">Loading funding…</p>
  const chains = [...new Set(tokens.map((t) => t.blockchain))]
    .map((c) => ({ value: c, label: chainLabel(c) }))
    .sort((a, b) => a.label.localeCompare(b.label))
  const assets = tokens
    .filter((t) => t.blockchain === chain)
    .map((t) => ({ value: t.assetId, label: t.symbol }))
  return (
    <div className="flex flex-col gap-4 border-t pt-4">
      {!session ? (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${id}-chain`}>Pay from</Label>
              <Select
                items={chains}
                value={chain}
                onValueChange={(v) => {
                  setChain(v)
                  setAsset(null)
                  setRefund(v && sourceChain({ blockchain: v }) ? account : "")
                }}
              >
                <SelectTrigger id={`${id}-chain`} className="w-full">
                  <SelectValue placeholder="Choose chain">
                    {(value) =>
                      value ? <ChainName chain={value} /> : "Choose chain"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {chains.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      <ChainName chain={c.value} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${id}-asset`}>Asset</Label>
              <Select
                items={assets}
                value={asset}
                onValueChange={setAsset}
                disabled={!chain}
              >
                <SelectTrigger id={`${id}-asset`} className="w-full">
                  <SelectValue placeholder="Choose asset">
                    {(value) => {
                      const selected = assets.find((a) => a.value === value)
                      return selected ? (
                        <AssetName symbol={selected.label} />
                      ) : (
                        "Choose asset"
                      )
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {assets.map((a) => (
                    <SelectItem key={a.value} value={a.value}>
                      <AssetName symbol={a.label} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-refund`}>
              Refund address on{" "}
              {chain ? <ChainName chain={chain} /> : "source chain"}
            </Label>
            <Input
              id={`${id}-refund`}
              value={refund}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setRefund(e.target.value.trim())}
            />
            <p className="text-xs text-muted-foreground">
              Use an address you control. Any refund returns here.
            </p>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Receive USDC on <ChainName chain="monad" />. Any missing MON for
            Spook fees is included in the quote; unused MON stays in your
            wallet.
          </p>
          <Button
            size="lg"
            disabled={disabled || busy || !token || !refund || !targets.length}
            onClick={review}
          >
            {busy ? <Loader2 className="animate-spin" /> : "Review funding"}
          </Button>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between text-xs font-semibold tracking-widest uppercase">
            <span>
              Pay from <ChainName chain={session.token.blockchain} />
            </span>
            <AssetName symbol={session.token.symbol} />
          </div>
          <dl className="grid grid-cols-[1fr_auto] gap-2 text-sm">
            <dt className="text-muted-foreground">Source cost, up to</dt>
            <dd className="text-right tabular-nums">
              {formatUnits(
                session.legs.reduce(
                  (a, l) => a + BigInt(depositAmount(l.quote)),
                  0n
                ),
                session.token.decimals
              )}{" "}
              <AssetName symbol={session.token.symbol} />
            </dd>
            <dt className="text-muted-foreground">
              Receive on <ChainName chain="monad" />
            </dt>
            <dd className="text-right">
              {session.legs.map((l, i) => (
                <span key={l.target.symbol}>
                  {i > 0 && " + "}
                  {formatUnits(
                    BigInt(l.target.amount),
                    l.target.symbol === "USDC" ? 6 : 18
                  )}{" "}
                  <AssetName symbol={l.target.symbol} />
                </span>
              ))}
            </dd>
          </dl>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Quote includes conversion and delivery fees, with 1% slippage
            tolerance. Source network gas is extra. Excess input returns to{" "}
            {session.refundTo}.
          </p>
          {!session.confirmed ? (
            <>
              <Button
                size="lg"
                disabled={
                  disabled ||
                  busy ||
                  session.legs.some((l) => quoteExpiry(l.quote) <= clock)
                }
                onClick={() => persist({ ...session, confirmed: true })}
              >
                {actionLabel}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => save(null)}
              >
                Change funding
              </Button>
            </>
          ) : (
            session.legs.map((leg, i) => (
              <Deposit
                key={leg.quote.quote.depositAddress}
                leg={leg}
                token={session.token}
                expired={quoteExpiry(leg.quote) <= clock}
                busy={busy || disabled}
                canPay={
                  !!connected &&
                  !!sourceChain(session.token) &&
                  session.refundTo.toLowerCase() ===
                    connected.address.toLowerCase() &&
                  !leg.quote.quote.depositMemo
                }
                onPay={() => pay(i)}
              />
            ))
          )}
          {ready &&
            (purpose === "receive" && session.purpose === "spook" ? (
              <Link
                href={APP_HOME}
                className="py-3 text-center text-sm font-semibold underline"
              >
                Finish creating Spook
              </Link>
            ) : (
              <Button size="lg" disabled={disabled || busy} onClick={finish}>
                {busy ? (
                  <Loader2 className="animate-spin" />
                ) : session.purpose === "spook" ? (
                  "Finish creating Spook"
                ) : (
                  "Done"
                )}
              </Button>
            ))}
          {session.confirmed &&
            session.legs.every((l) => terminal(l.status)) &&
            !ready && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => save(null)}
              >
                Start new funding
              </Button>
            )}
          {!session.confirmed &&
            session.legs.some((l) => quoteExpiry(l.quote) <= clock) && (
              <p className="text-xs text-muted-foreground">
                Quote expired. Change funding to get a new quote.
              </p>
            )}
          {canCloseUnpaid(session, clock) && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">
                If you already sent funds, keep tracking this request. Close it
                only if you haven&apos;t paid.
              </p>
              <Button variant="ghost" size="sm" disabled={busy} onClick={close}>
                Close unpaid request
              </Button>
            </div>
          )}
        </>
      )}
      {!session && closed.length > 0 && (
        <details className="border-t pt-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer">Closed funding requests</summary>
          <div className="mt-2 flex flex-col gap-2">
            {closed.map((s) => (
              <Button
                key={s.createdAt}
                variant="ghost"
                size="sm"
                onClick={() => save(s)}
              >
                Track <ChainName chain={s.token.blockchain} /> deposit ·{" "}
                {new Date(s.createdAt).toLocaleDateString()}
              </Button>
            ))}
          </div>
        </details>
      )}
      <p
        role={error ? "alert" : "status"}
        aria-live="polite"
        className="text-xs break-words text-destructive"
      >
        {error}
      </p>
      <p className="text-xs text-muted-foreground">Powered by Aurora Intents</p>
    </div>
  )
}
