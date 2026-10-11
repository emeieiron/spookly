"use client"

import { useState } from "react"
import { Check, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { QrCode } from "@/components/qr-code"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { FundingFlow } from "@/components/funding/flow"
import { useFundingSession } from "@/components/funding/use-session"
import { IS_MAINNET, monad } from "@/lib/chain"
import { fundingTargets } from "@/lib/funding/requirements"
import { parseUsdc } from "@/lib/money"
import { useIssuer } from "./app"
import { Bar, Page, PageTitle } from "./ui"

export function Receive() {
  const { wallet, refresh, goBack } = useIssuer()
  const [copied, setCopied] = useState(false)
  const [mode, setMode] = useState<string | null>(null)
  const [amountText, setAmountText] = useState("")
  const { session } = useFundingSession(wallet?.account ?? "")
  const amount = parseUsdc(amountText)
  const deposit = mode === "cross" || (mode === null && !!session)
  return (
    <Page>
      <PageTitle title="Receive" />
      <div className="flex min-h-0 flex-1 [scrollbar-width:thin] flex-col gap-6 overflow-y-auto">
        {IS_MAINNET && (
          <ToggleGroup
            aria-label="Receive funds"
            value={[deposit ? "cross" : "monad"]}
            onValueChange={(v) => v[0] && setMode(v[0])}
            variant="outline"
          >
            <ToggleGroupItem value="monad" className="flex-1">
              On Monad
            </ToggleGroupItem>
            <ToggleGroupItem value="cross" className="flex-1">
              From another chain
            </ToggleGroupItem>
          </ToggleGroup>
        )}
        {deposit && wallet ? (
          <section className="flex flex-col gap-4">
            {!session && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="deposit-amount">Receive USDC</Label>
                <Input
                  id="deposit-amount"
                  value={amountText}
                  inputMode="decimal"
                  placeholder="0.00"
                  onChange={(e) => setAmountText(e.target.value)}
                />
              </div>
            )}
            <FundingFlow
              key={wallet.account}
              account={wallet.account}
              purpose="receive"
              actionLabel="Deposit funds"
              targets={
                amount
                  ? fundingTargets(
                      amount,
                      0n,
                      wallet.mon,
                      0n,
                      wallet.book?.spareGas,
                      wallet.gasReserve
                    )
                  : []
              }
              onReady={async () => {
                await refresh()
                if (session?.purpose === "write") goBack()
                else {
                  setMode("monad")
                  setAmountText("")
                }
                return session?.purpose !== "write"
              }}
            />
            {session?.purpose === "write" && (
              <p className="text-xs text-muted-foreground">
                This deposit belongs to your cheque draft. Return to Write to
                finish creating the cheque.
              </p>
            )}
          </section>
        ) : (
          <section className="flex flex-col items-center gap-4">
            {wallet ? (
              <QrCode text={wallet.account} className="w-56 bg-white p-2" />
            ) : (
              <Bar className="aspect-square w-56" />
            )}
            <p className="h-10 text-center font-mono text-sm break-all">
              {wallet?.account}
            </p>
            <Button
              className="w-full"
              disabled={!wallet}
              onClick={() =>
                wallet &&
                navigator.clipboard
                  .writeText(wallet.account)
                  .then(() => setCopied(true))
              }
            >
              {copied ? (
                <Check data-icon="inline-start" />
              ) : (
                <Copy data-icon="inline-start" />
              )}
              {copied ? "Copied" : "Copy address"}
            </Button>
            <p className="text-center text-xs leading-relaxed text-muted-foreground">
              Send USDC or MON on {monad.name} only.
              {!IS_MAINNET && (
                <>
                  {" "}
                  Get test funds from the{" "}
                  <a
                    className="underline"
                    href="https://faucet.circle.com"
                    target="_blank"
                    rel="noreferrer"
                  >
                    USDC faucet
                  </a>{" "}
                  or{" "}
                  <a
                    className="underline"
                    href="https://faucet.monad.xyz"
                    target="_blank"
                    rel="noreferrer"
                  >
                    MON faucet
                  </a>
                  .
                </>
              )}
            </p>
          </section>
        )}
      </div>
    </Page>
  )
}
