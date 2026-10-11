"use client"

import { encodeFunctionData, getAddress, isAddress } from "viem"
import { ViewTransition, useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Copy, KeyRound, Loader2, Share2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { QrCode } from "@/components/qr-code"
import { chequeBookAbi } from "@/lib/abi"
import { describe, storedKey } from "@/lib/cheque-book"
import { chequeLink } from "@/lib/cheque-link"
import { formatUsdc } from "@/lib/money"
import { sendChecked } from "@/lib/wallet-send"
import { useIssuer } from "./app"
import { ChequePayments } from "./payments"
import { Bar, ErrorLine, Page, PageTitle } from "./ui"

export function ChequeDetail({ id }: { id: string }) {
  const {
    wallet,
    busy,
    run,
    copied,
    setCopied,
    links,
    linksReady,
    unlockVault,
  } = useIssuer()
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [justCopied, setJustCopied] = useState(false)

  const signer = isAddress(id) ? getAddress(id) : null
  const cheque = wallet?.book?.cheques.find((c) => c.signer === signer)
  const localKey =
    wallet && cheque ? storedKey(wallet.account, cheque.signer) : null

  if (!wallet)
    return (
      <Page>
        <PageTitle title="Cheque" />
        <div className="flex flex-col items-center gap-4">
          <Bar className="h-10 w-28" />
          <Bar className="aspect-square w-56" />
        </div>
      </Page>
    )

  if (!cheque || !wallet.book)
    return (
      <Page>
        <PageTitle title="Cheque" />
        <p className="text-sm text-muted-foreground">
          This cheque isn&apos;t in your cheque book.
        </p>
      </Page>
    )

  const book = wallet.book
  const { live, status } = describe(cheque, wallet.checkedAt)
  // Links written elsewhere are restored from their sealed copies by the app, with this device's passkey vault.
  const key = live ? (localKey ?? links?.keys[cheque.signer] ?? null) : null
  const locked =
    live && !key && !!links?.locked.some((l) => l.signer === cheque.signer)
  const link = key
    ? chequeLink(window.location.origin, book.address, key)
    : null
  const isCopied = justCopied || copied === cheque.signer
  const canShare = typeof navigator !== "undefined" && "share" in navigator

  const cancel = async () => {
    const ok = await run("cancel", ({ client }) =>
      sendChecked(
        client,
        book.address,
        encodeFunctionData({
          abi: chequeBookAbi,
          functionName: "cancel",
          args: [cheque.signer],
        })
      )
    )
    setConfirming(false)
    // The cheque is over, so leave its page rather than keep showing a dead link.
    if (ok) router.replace("/app", { transitionTypes: ["nav-back"] })
  }

  return (
    <Page>
      <PageTitle title="Cheque" />
      {/* The cheque and its payments scroll together; the cancel action stays at the bottom. */}
      <div className="flex min-h-0 flex-1 [scrollbar-width:thin] flex-col gap-6 overflow-y-auto">
        <section className="flex flex-col items-center gap-4">
          <ViewTransition name="cheque-amount" share="morph" default="none">
            <span className="text-4xl font-semibold tabular-nums">
              {formatUsdc(live ? cheque.remaining : cheque.amount)}
            </span>
          </ViewTransition>
          <span className="-mt-2 text-sm text-muted-foreground">{status}</span>

          {link ? (
            <>
              <div className="qr-print">
                <QrCode text={link} className="w-56 bg-white p-2" />
              </div>
              <div className="share-actions flex w-full gap-2">
                <Button
                  className="flex-1"
                  onClick={() =>
                    navigator.clipboard.writeText(link).then(() => {
                      setJustCopied(true)
                      setCopied(cheque.signer)
                    })
                  }
                >
                  {isCopied ? (
                    <Check data-icon="inline-start" />
                  ) : (
                    <Copy data-icon="inline-start" />
                  )}
                  {isCopied ? "Copied" : "Copy link"}
                </Button>
                {canShare && (
                  <Button
                    variant="outline"
                    aria-label="Share"
                    onClick={() =>
                      navigator
                        .share({ title: "USDC cheque", url: link })
                        .catch(() => {})
                    }
                  >
                    <Share2 />
                  </Button>
                )}
              </div>
              <p className="share-actions text-xs text-muted-foreground">
                Anyone with this link can spend it.
              </p>
            </>
          ) : live && !linksReady ? (
            <Bar className="aspect-square w-56" />
          ) : locked ? (
            <div className="flex w-full flex-col items-center gap-3 border border-dashed p-6 text-center">
              <KeyRound className="size-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                This link is locked to your passkey. Unlock it to show the QR
                code on this device.
              </p>
              <Button
                className="w-full"
                disabled={!!busy}
                onClick={() => unlockVault()}
              >
                {busy === "vault" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  "Unlock with passkey"
                )}
              </Button>
              <p className="text-xs text-muted-foreground">
                Lost the passkey? Cancelling the cheque returns its money.
              </p>
            </div>
          ) : live ? (
            <p className="text-center text-sm text-muted-foreground">
              This cheque&apos;s link is saved on the device that wrote it.
            </p>
          ) : null}
        </section>

        <ChequePayments signer={cheque.signer} refreshKey={wallet.checkedAt} />
      </div>

      {cheque.active && (
        <section className="flex shrink-0 flex-col gap-2">
          <ErrorLine />
          {confirming ? (
            <div className="flex flex-col gap-3 border p-4">
              <p className="text-sm">
                {live
                  ? `Cancel this cheque? The link stops working and ${formatUsdc(cheque.remaining)} returns to your wallet.`
                  : "Close this cheque and return its unused fees to your wallet?"}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  className="flex-1"
                  disabled={!!busy}
                  onClick={cancel}
                >
                  {busy === "cancel" ? (
                    <Loader2 className="animate-spin" />
                  ) : live ? (
                    "Cancel cheque"
                  ) : (
                    "Close cheque"
                  )}
                </Button>
                <Button
                  variant="ghost"
                  disabled={!!busy}
                  onClick={() => setConfirming(false)}
                >
                  Keep
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              disabled={!!busy}
              onClick={() => setConfirming(true)}
            >
              {live ? "Cancel cheque" : "Reclaim leftovers"}
            </Button>
          )}
        </section>
      )}
    </Page>
  )
}
