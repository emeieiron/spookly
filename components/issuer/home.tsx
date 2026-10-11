"use client"

import { ViewTransition, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowDownLeft, ArrowUpRight, KeyRound, Loader2 } from "lucide-react"
import { formatUnits } from "viem"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { factoryAbi } from "@/lib/abi"
import { DAYS } from "@/lib/cheque-book"
import { FACTORY } from "@/lib/chain"
import { chequeLink } from "@/lib/cheque-link"
import { publicClient } from "@/lib/cheque-payment"
import { formatMon, formatUsdc, parseUsdc } from "@/lib/money"
import { FinalTransactionError, sendChecked } from "@/lib/wallet-send"
import {
  clearWriteDraft,
  readWriteDraft,
  saveWriteDraft,
  type WriteDraft,
} from "@/lib/write-draft"
import {
  acknowledgeSponsor,
  clearPendingSponsor,
  readPendingSponsor,
} from "@/lib/sponsor-pending"
import {
  prepareChequeWrite,
  prepareNativeChequeWrite,
} from "@/lib/issuer-write"
import { useIssuer } from "./app"
import { Bar, ChequeRow, ErrorLine, Page } from "./ui"

export function Home() {
  const { wallet, busy, run, setCopied, vault, sponsor } = useIssuer()
  const router = useRouter()

  if (!wallet) return <HomeSkeleton />
  const { book, account } = wallet
  const pendingWrite = readWriteDraft(account)
  // Active holds every cheque that still holds money or fees; history holds the closed ones.
  const open = book?.cheques.filter((c) => c.active) ?? []
  const closedCount = (book?.cheques.length ?? 0) - open.length

  const write = (amount: bigint, days: number) =>
    run("write", async ({ client }) => {
      const draft = await prepareChequeWrite(client, book, vault, amount, days)
      const { key, signer } = draft
      try {
        if (book?.cheques.some((cheque) => cheque.signer === signer)) {
          // A lost HTTP response must not keep an already written cheque stuck in the form.
          const pending = readPendingSponsor(account)
          if (pending?.transaction.data === draft.data)
            clearPendingSponsor(account)
        } else if (draft.hash) {
          const receipt = await publicClient.waitForTransactionReceipt({
            hash: draft.hash,
          })
          acknowledgeSponsor(account, draft.hash)
          if (receipt.status !== "success")
            throw new FinalTransactionError("The transaction failed.")
        } else
          await sendChecked(
            client,
            draft.to,
            draft.data,
            BigInt(draft.value),
            sponsor,
            () => prepareNativeChequeWrite(client, draft),
            (hash) => saveWriteDraft(account, { ...draft, hash })
          )
      } catch (error) {
        if (
          error instanceof FinalTransactionError &&
          !readPendingSponsor(account)
        )
          clearWriteDraft(account)
        throw error
      }
      clearWriteDraft(account)
      const bookAddress =
        book?.address ??
        (await publicClient.readContract({
          address: FACTORY!,
          abi: factoryAbi,
          functionName: "bookOf",
          args: [account],
        }))
      const copied = await navigator.clipboard
        ?.writeText(chequeLink(window.location.origin, bookAddress, key))
        .then(() => true)
        .catch(() => false)
      setCopied(copied ? signer : null)
      return signer
    })

  return (
    <Page>
      <div className="flex h-5 items-center justify-between text-sm text-muted-foreground">
        <span>
          Wallet {formatUsdc(wallet.usdc)} · {formatMon(wallet.mon)}
        </span>
        <span className="flex gap-4">
          {/* Negative margins keep 36px tap targets without changing the row height. */}
          <Link
            href="/app/receive"
            transitionTypes={["nav-forward"]}
            className="-my-2 flex items-center gap-1 py-2 text-xs font-semibold tracking-widest text-foreground uppercase"
          >
            <ArrowDownLeft className="size-3.5" /> Receive
          </Link>
          <Link
            href="/app/send"
            transitionTypes={["nav-forward"]}
            className="-my-2 flex items-center gap-1 py-2 text-xs font-semibold tracking-widest text-foreground uppercase"
          >
            <ArrowUpRight className="size-3.5" /> Send
          </Link>
        </span>
      </div>

      <WriteCheque
        key={account}
        pending={pendingWrite}
        checking={!!readPendingSponsor(account) || !!pendingWrite?.hash}
        busy={busy === "write"}
        disabled={!!busy || !FACTORY}
        max={wallet.usdc + (book?.available ?? 0n)}
        onWrite={async (amount, days) => {
          const signer = await write(amount, days)
          if (signer)
            router.push(`/app/cheques/${signer}`, {
              transitionTypes: ["nav-forward"],
            })
          return !!signer
        }}
      />
      <ErrorLine />
      <VaultStatus />

      <section className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b text-xs font-semibold tracking-widest uppercase">
          <span className="py-3">
            Active{" "}
            <span className="tabular-nums opacity-60">{open.length}</span>
          </span>
          <Link
            href="/app/history"
            transitionTypes={["nav-forward"]}
            className="py-3 text-muted-foreground hover:text-foreground"
          >
            History{" "}
            <span className="tabular-nums opacity-60">{closedCount}</span>
          </Link>
        </div>
        <ul className="min-h-0 flex-1 [scrollbar-width:thin] divide-y overflow-y-auto">
          {open.map((c) => (
            <ChequeRow key={c.signer} cheque={c} now={wallet.checkedAt} />
          ))}
          {open.length === 0 && (
            <li className="py-6 text-center text-xs text-muted-foreground">
              No active cheques
            </li>
          )}
        </ul>
      </section>
    </Page>
  )
}

// One passkey protects every cheque link, so links written here open on any device the passkey syncs to.
function VaultStatus() {
  const {
    vault,
    passkeys,
    links,
    busy,
    unlockFailed,
    setUpVault,
    unlockVault,
  } = useIssuer()
  if (!links) return <div className="-mt-4 h-5" />
  const locked = links.locked.length
  const known = !vault && links.ids.length > 0
  const [text, actions]: [string, [string, () => void][]] =
    (locked > 0 || known) && !vault && unlockFailed
      ? [
          "Passkey lost?",
          [
            ["New passkey", setUpVault],
            ["Try again", unlockVault],
          ],
        ]
      : locked > 0
        ? [
            `${locked} link${locked === 1 ? "" : "s"} locked to your passkey`,
            [["Unlock", unlockVault]],
          ]
        : known
          ? [
              "Back up new links with your passkey",
              [["Use passkey", unlockVault]],
            ]
          : vault
            ? ["Links backed up to your passkey", []]
            : passkeys
              ? [
                  "Open your cheque links on any device",
                  [["Use passkey", setUpVault]],
                ]
              : passkeys === false
                ? ["Links are saved on this device only", []]
                : ["", []]
  return (
    <div className="-mt-4 flex h-5 items-center justify-between gap-3 text-xs text-muted-foreground">
      <span className="flex min-w-0 items-center gap-1.5">
        {text && <KeyRound className="size-3.5 shrink-0" />}
        <span className="truncate">{text}</span>
      </span>
      <span className="-mr-2 flex shrink-0">
        {busy === "vault" && actions.length > 0 ? (
          <span className="px-2 font-semibold tracking-widest uppercase">
            Waiting…
          </span>
        ) : (
          actions.map(([label, onClick]) => (
            <Button
              key={label}
              variant="ghost"
              size="xs"
              className="-my-1 px-2"
              disabled={!!busy}
              onClick={onClick}
            >
              {label}
            </Button>
          ))
        )}
      </span>
    </div>
  )
}

function WriteCheque({
  busy,
  disabled,
  max,
  pending,
  checking,
  onWrite,
}: {
  busy: boolean
  disabled: boolean
  max: bigint
  pending: WriteDraft | null
  checking: boolean
  onWrite: (amount: bigint, days: number) => Promise<boolean>
}) {
  const [amountText, setAmountText] = useState(
    pending ? formatUnits(BigInt(pending.amount), 6) : ""
  )
  const [days, setDays] = useState(pending?.days ?? 7)
  const amount = parseUsdc(amountText)
  const resuming =
    pending && amount?.toString() === pending.amount && days === pending.days
  const tooMuch = !resuming && amount !== null && amount > max
  return (
    <section className="flex flex-col gap-4">
      <Label className="cursor-text border-b pb-2 tracking-normal normal-case select-auto">
        <ViewTransition name="cheque-amount" share="morph" default="none">
          <span className="inline-flex items-baseline gap-2">
            <span className="text-4xl font-semibold text-muted-foreground">
              $
            </span>
            <Input
              aria-label="Cheque amount in USDC"
              inputMode="decimal"
              placeholder="0.00"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              className="field-sizing-content h-14 w-auto! min-w-[2ch] border-0 px-0 text-4xl font-semibold tabular-nums shadow-none focus-visible:ring-0 md:text-4xl"
            />
          </span>
        </ViewTransition>
      </Label>
      <ToggleGroup
        aria-label="Valid for"
        variant="outline"
        size="sm"
        value={[String(days)]}
        onValueChange={(v) => v[0] && setDays(Number(v[0]))}
      >
        {DAYS.map((d) => (
          <ToggleGroupItem
            key={d}
            value={String(d)}
            className="aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary/80"
          >
            {d}d
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Button
        size="lg"
        disabled={disabled || amount === null || tooMuch}
        onClick={() =>
          amount && onWrite(amount, days).then((ok) => ok && setAmountText(""))
        }
      >
        {busy ? (
          <Loader2 className="animate-spin" />
        ) : tooMuch ? (
          `Only ${formatUsdc(max)} available`
        ) : checking && resuming ? (
          "Check cheque"
        ) : (
          "Write cheque"
        )}
      </Button>
    </section>
  )
}

function HomeSkeleton() {
  return (
    <Page>
      <Bar className="h-5 w-48" />
      <section className="flex flex-col gap-4">
        <div className="flex h-[65px] items-center border-b pb-2">
          <Bar className="h-10 w-32" />
        </div>
        <div className="flex gap-2">
          {DAYS.map((d) => (
            <Bar key={d} className="h-9 w-14" />
          ))}
        </div>
        <Bar className="h-11" />
      </section>
    </Page>
  )
}
