"use client"

import { useState } from "react"
import { Check, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { QrCode } from "@/components/qr-code"
import { useIssuer } from "./app"
import { Bar, Page, PageTitle } from "./ui"

export function Receive() {
  const { wallet } = useIssuer()
  const [copied, setCopied] = useState(false)
  return (
    <Page>
      <PageTitle title="Receive" />
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
          Send USDC or MON on Monad testnet only. Get test funds from the{" "}
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
        </p>
      </section>
    </Page>
  )
}
