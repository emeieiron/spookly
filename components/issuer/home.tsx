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
import { DAYS } from "@/lib/spook-book"
import { FACTORY, IS_MAINNET } from "@/lib/chain"
import { spookLink } from "@/lib/spook-link"
import { formatMon, formatUsdc, parseUsdc } from "@/lib/money"
import { FundingFlow } from "@/components/funding/flow"
import { ChainName } from "@/components/chain-name"
import { useFundingSession } from "@/components/funding/use-session"
import { fundingTargets } from "@/lib/funding/requirements"
import { createSpook } from "@/lib/issuer-spook"
import { readSpookDraft, type SpookDraft } from "@/lib/spook-draft"
import { readPendingSponsor } from "@/lib/sponsor-pending"
import { fetchWallet, useIssuer, type Wallet } from "./app"
import { Bar, SpookRow, ErrorLine, Page } from "./ui"

export function Home() {
  const { wallet, busy, run, setCopied, vault, sponsor } = useIssuer()
  const router = useRouter()

  if (!wallet) return <HomeSkeleton />
  const { book, account } = wallet
  const pendingSpook = readSpookDraft(account)
  // Active holds every spook that still holds money or fees; history holds closed ones.
  const open = book?.spooks.filter((c) => c.active) ?? []
  const closedCount = (book?.spooks.length ?? 0) - open.length
  const spook = (amount: bigint, days: number) =>
    run("spook", async ({ account, client }) => {
      // Read after settlement, so funding never uses a stale wallet or book balance.
      const current = await fetchWallet(account, client)
      const result = await createSpook(current, amount, days, vault, sponsor)
      const copied = await navigator.clipboard
        ?.writeText(
          spookLink(window.location.origin, result.bookAddress, result.key)
        )
        .then(() => true)
        .catch(() => false)
      setCopied(copied ? result.signer : null)
      return result.signer
    })

  return (
    <Page className="[scrollbar-width:thin] overflow-y-auto">
      <div className="flex h-5 shrink-0 items-center justify-between text-sm text-muted-foreground">
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

      <CreateSpook
        key={`${account}:${pendingSpook?.signer ?? "new"}`}
        pendingSpook={pendingSpook}
        verifying={!!readPendingSponsor(account) || !!pendingSpook?.hash}
        busy={busy === "spook"}
        disabled={!!busy || !FACTORY}
        wallet={wallet}
        onSpook={async (amount, days) => {
          const signer = await spook(amount, days)
          if (signer)
            router.push(`/app/spooks/${signer}`, {
              transitionTypes: ["nav-forward"],
            })
          return !!signer
        }}
      />
      <ErrorLine />
      <VaultStatus />

      <section className="flex min-h-24 flex-1 flex-col">
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
            <SpookRow key={c.signer} spook={c} now={wallet.refreshedAt} />
          ))}
          {open.length === 0 && (
            <li className="py-6 text-center text-xs text-muted-foreground">
              No active Spooks
            </li>
          )}
        </ul>
      </section>
    </Page>
  )
}

// One passkey protects every spook link, so links created here open on any device the passkey syncs to.
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
                  "Open your Spook links on any device",
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

function CreateSpook({
  busy,
  disabled,
  wallet,
  pendingSpook,
  verifying,
  onSpook,
}: {
  busy: boolean
  disabled: boolean
  wallet: Wallet
  pendingSpook: SpookDraft | null
  verifying: boolean
  onSpook: (amount: bigint, days: number) => Promise<boolean>
}) {
  const { session, loaded } = useFundingSession(wallet.account)
  const [fundingOpen, setFundingOpen] = useState(false)
  const [amountText, setAmountText] = useState(() =>
    pendingSpook ? formatUnits(BigInt(pendingSpook.amount), 6) : ""
  )
  const [days, setDays] = useState(() => pendingSpook?.days ?? 7)
  const draftAmount =
    session?.purpose === "spook"
      ? (session.draft?.amount ?? amountText)
      : amountText
  const draftDays =
    session?.purpose === "spook" ? (session.draft?.days ?? days) : days
  const amount = parseUsdc(draftAmount)
  const max = wallet.usdc + (wallet.book?.available ?? 0n)
  const resuming =
    !!pendingSpook &&
    amount?.toString() === pendingSpook.amount &&
    draftDays === pendingSpook.days
  const targets =
    amount && !resuming
      ? fundingTargets(
          amount,
          wallet.usdc,
          wallet.mon,
          wallet.book?.available,
          wallet.book?.spareGas,
          wallet.gasReserve,
          wallet.delegated
        )
      : []
  const shortfall = targets.length > 0
  const showFunding = IS_MAINNET && (!!session || (shortfall && fundingOpen))
  const pending = !!session || !!pendingSpook
  const tooMuch = !resuming && amount !== null && amount > max
  return (
    <section className="flex shrink-0 flex-col gap-4">
      <Label className="cursor-text border-b pb-2 tracking-normal normal-case select-auto">
        <ViewTransition name="spook-amount" share="morph" default="none">
          <span className="inline-flex items-baseline gap-2">
            <span className="text-4xl font-semibold text-muted-foreground">
              $
            </span>
            <Input
              aria-label="Spook amount in USDC"
              inputMode="decimal"
              placeholder="0.00"
              disabled={pending || busy}
              value={draftAmount}
              onChange={(e) => setAmountText(e.target.value)}
              className="field-sizing-content h-14 w-auto! min-w-[2ch] border-0 px-0 text-4xl font-semibold tabular-nums shadow-none focus-visible:ring-0 md:text-4xl"
            />
          </span>
        </ViewTransition>
      </Label>
      <ToggleGroup
        disabled={pending || busy}
        aria-label="Valid for"
        variant="outline"
        size="sm"
        value={[String(draftDays)]}
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
      {showFunding ? (
        <>
          {!session && (
            <Button
              variant="ghost"
              size="xs"
              className="self-start"
              onClick={() => setFundingOpen(false)}
            >
              Back to Spook
            </Button>
          )}
          <FundingFlow
            account={wallet.account}
            purpose="spook"
            targets={targets}
            draft={{ amount: draftAmount, days: draftDays }}
            actionLabel="Spook"
            disabled={disabled}
            onReady={async () => {
              if (session?.purpose === "receive") return true
              return !!amount && onSpook(amount, draftDays)
            }}
          />
        </>
      ) : (
        <Button
          size="lg"
          disabled={disabled || !loaded || amount === null || shortfall}
          onClick={() =>
            amount &&
            onSpook(amount, draftDays).then((ok) => ok && setAmountText(""))
          }
        >
          {busy ? (
            <Loader2 className="animate-spin" />
          ) : verifying && resuming ? (
            "Refresh Spook"
          ) : tooMuch ? (
            `Only ${formatUsdc(max)} available`
          ) : shortfall ? (
            "MON needed for fees"
          ) : (
            "Spook"
          )}
        </Button>
      )}
      {IS_MAINNET && loaded && shortfall && !showFunding && (
        <div className="flex flex-col gap-2 text-xs text-muted-foreground">
          <p>
            Your <ChainName chain="monad" /> balance needs{" "}
            {targets.map((target) => target.symbol).join(" and ")} to create
            this Spook.
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => setFundingOpen(true)}
          >
            Top up from another chain
          </Button>
        </div>
      )}
      {!FACTORY && (
        <p className="text-xs text-muted-foreground">
          Spook creation is unavailable right now.
        </p>
      )}
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
