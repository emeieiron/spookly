"use client"

import { encodeFunctionData, getAddress, isAddress } from "viem"
import { ViewTransition, useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Copy, KeyRound, Loader2, Share2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { QrCode } from "@/components/qr-code"
import { spookBookAbi } from "@/lib/abi"
import { describe, storedKey } from "@/lib/spook-book"
import { spookLink } from "@/lib/spook-link"
import { formatUsdc } from "@/lib/money"
import { sendValidated } from "@/lib/wallet-send"
import { useIssuer } from "./app"
import { SpookPayments } from "./payments"
import { Bar, ErrorLine, Page, PageTitle } from "./ui"

export function SpookDetail({ id }: { id: string }) {
  const {
    wallet,
    sponsor,
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
  const spook = wallet?.book?.spooks.find((c) => c.signer === signer)
  const localKey =
    wallet && spook ? storedKey(wallet.account, spook.signer) : null

  if (!wallet)
    return (
      <Page>
        <PageTitle title="Spook" />
        <div className="flex flex-col items-center gap-4">
          <Bar className="h-10 w-28" />
          <Bar className="aspect-square w-56" />
        </div>
      </Page>
    )

  if (!spook || !wallet.book)
    return (
      <Page>
        <PageTitle title="Spook" />
        <p className="text-sm text-muted-foreground">
          This Spook isn&apos;t in your Spook book.
        </p>
      </Page>
    )

  const book = wallet.book
  const { live, status } = describe(spook, wallet.refreshedAt)
  // Links created elsewhere are restored from their sealed copies by the app, with this device's passkey vault.
  const key = live ? (localKey ?? links?.keys[spook.signer] ?? null) : null
  const locked =
    live && !key && !!links?.locked.some((l) => l.signer === spook.signer)
  const link = key ? spookLink(window.location.origin, book.address, key) : null
  const isCopied = justCopied || copied === spook.signer
  const canShare = typeof navigator !== "undefined" && "share" in navigator

  const cancel = async () => {
    const ok = await run("cancel", ({ client }) =>
      sendValidated(
        client,
        book.address,
        encodeFunctionData({
          abi: spookBookAbi,
          functionName: "cancel",
          args: [spook.signer],
        }),
        0n,
        sponsor
      )
    )
    setConfirming(false)
    // The spook is over, so leave its page rather than keep showing a dead link.
    if (ok) router.replace("/app", { transitionTypes: ["nav-back"] })
  }

  return (
    <Page>
      <PageTitle title="Spook" />
      {/* The spook and its payments scroll together; the cancel action stays at the bottom. */}
      <div className="flex min-h-0 flex-1 [scrollbar-width:thin] flex-col gap-6 overflow-y-auto">
        <section className="flex flex-col items-center gap-4">
          <ViewTransition name="spook-amount" share="morph" default="none">
            <span className="text-4xl font-semibold tabular-nums">
              {formatUsdc(live ? spook.remaining : spook.amount)}
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
                      setCopied(spook.signer)
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
                        .share({ title: "USDC Spook", url: link })
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
                Lost the passkey? Cancelling the Spook returns its money.
              </p>
            </div>
          ) : live ? (
            <p className="text-center text-sm text-muted-foreground">
              This Spook&apos;s link is saved on the device that wrote it.
            </p>
          ) : null}
        </section>

        <SpookPayments signer={spook.signer} refreshKey={wallet.refreshedAt} />
      </div>

      {spook.active && (
        <section className="flex shrink-0 flex-col gap-2">
          <ErrorLine />
          {confirming ? (
            <div className="flex flex-col gap-3 border p-4">
              <p className="text-sm">
                {live
                  ? `Cancel this spook? The link stops working and ${formatUsdc(spook.remaining)} returns to your wallet.`
                  : "Close this Spook and return its unused fees to your wallet?"}
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
                    "Cancel Spook"
                  ) : (
                    "Close Spook"
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
              {live ? "Cancel Spook" : "Reclaim leftovers"}
            </Button>
          )}
        </section>
      )}
    </Page>
  )
}
