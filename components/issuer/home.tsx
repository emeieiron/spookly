"use client"

import { encodeFunctionData } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { ViewTransition, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowDownLeft, ArrowUpRight, KeyRound, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { chequeBookAbi, factoryAbi } from "@/lib/abi"
import { DAYS, FEE_ALLOWANCE, keyStorage } from "@/lib/cheque-book"
import { FACTORY } from "@/lib/chain"
import { chequeLink } from "@/lib/cheque-link"
import { publicClient } from "@/lib/cheque-payment"
import { formatMon, formatUsdc, parseUsdc } from "@/lib/money"
import { NO_PERMIT, signPermit } from "@/lib/permit"
import { sealChequeKey } from "@/lib/link-vault"
import { sendChecked } from "@/lib/wallet-send"
import { useIssuer } from "./app"
import { Bar, ChequeRow, ErrorLine, Page } from "./ui"

export function Home() {
  const { wallet, busy, run, setCopied, vault } = useIssuer()
  const router = useRouter()

  if (!wallet) return <HomeSkeleton />
  const { book, account } = wallet
  const spareGas = book?.spareGas ?? 0n
  // Active holds every cheque that still holds money or fees; history holds the closed ones.
  const open = book?.cheques.filter((c) => c.active) ?? []
  const closedCount = (book?.cheques.length ?? 0) - open.length

  const write = (amount: bigint, days: number) =>
    run("write", async ({ client }) => {
      const key = generatePrivateKey()
      const signer = privateKeyToAccount(key).address
      // Keep the key before the transaction so the link is never lost.
      localStorage.setItem(keyStorage(account, signer), key)
      const expiry = BigInt(Math.floor(Date.now() / 1000) + days * 86400)
      const pull = !book
        ? amount
        : amount > book.available
          ? amount - book.available
          : 0n
      const topUp = FEE_ALLOWANCE > spareGas ? FEE_ALLOWANCE - spareGas : 0n
      const permit =
        pull > 0n
          ? await signPermit(client, book?.address ?? FACTORY!, pull)
          : NO_PERMIT
      // With a passkey vault, the link's key is sealed on-chain so it can be restored on any device.
      const sealed = vault ? await sealChequeKey(vault, key) : "0x"
      await sendChecked(
        client,
        book?.address ?? FACTORY!,
        book
          ? encodeFunctionData({
              abi: chequeBookAbi,
              functionName: "fundAndWrite",
              args: [
                signer,
                amount,
                expiry,
                FEE_ALLOWANCE,
                pull,
                permit,
                sealed,
              ],
            })
          : encodeFunctionData({
              abi: factoryAbi,
              functionName: "createAndWrite",
              args: [signer, amount, expiry, FEE_ALLOWANCE, permit, sealed],
            }),
        topUp
      )
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
  const { wallet, vault, busy, setUpVault, unlockVault } = useIssuer()
  const locked = !!wallet?.book?.cheques.some((c) => c.sealedKey !== "0x")
  return (
    <div className="-mt-4 flex h-5 items-center justify-between gap-3 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <KeyRound className="size-3.5" />
        {vault
          ? "Links backed up to your passkey"
          : locked
            ? "Your cheque links are locked to your passkey"
            : "Open your cheque links on any device"}
      </span>
      {!vault && (
        <button
          className="-my-2 py-2 font-semibold tracking-widest text-foreground uppercase disabled:opacity-50"
          disabled={!!busy}
          onClick={() => (locked ? unlockVault() : setUpVault())}
        >
          {busy === "vault" ? "Waiting…" : locked ? "Unlock" : "Use passkey"}
        </button>
      )}
    </div>
  )
}

function WriteCheque({
  busy,
  disabled,
  max,
  onWrite,
}: {
  busy: boolean
  disabled: boolean
  max: bigint
  onWrite: (amount: bigint, days: number) => Promise<boolean>
}) {
  const [amountText, setAmountText] = useState("")
  const [days, setDays] = useState(7)
  const amount = parseUsdc(amountText)
  const tooMuch = amount !== null && amount > max
  return (
    <section className="flex flex-col gap-4">
      <label className="flex cursor-text border-b pb-2">
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
      </label>
      <div className="flex gap-2" role="radiogroup" aria-label="Valid for">
        {DAYS.map((d) => (
          <Button
            key={d}
            size="sm"
            variant={days === d ? "default" : "outline"}
            role="radio"
            aria-checked={days === d}
            onClick={() => setDays(d)}
          >
            {d}d
          </Button>
        ))}
      </div>
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
