import { IS_MAINNET, monad } from "@/lib/chain"
import type { Metadata } from "next"
import Link from "next/link"
import {
  ArrowRight,
  Ban,
  CalendarClock,
  Check,
  EyeOff,
  Fuel,
  Gauge,
  KeyRound,
  Lock,
  Minus,
} from "lucide-react"
import { ExternalLink } from "@/components/external-link"
import { ProductMock } from "@/components/landing/product-mock"
import { buttonVariants } from "@/components/ui/button"
import { activityStats, type ActivityStats } from "@/lib/activity"
import { APP_URL } from "@/lib/hosts"
import { formatUsdc } from "@/lib/money"
import { NETWORKS } from "@/lib/networks"
import { cn } from "@/lib/utils"
import "./landing.css"

// Live stats come from the indexer, so the page is regenerated at most once a minute.
export const revalidate = 60

export const metadata: Metadata = {
  title: "Spookly · Spendable links",
  description:
    "Put USDC in a link. Whoever holds it pays any USDC address straight from the link, on Monad or nine other networks.",
}

const STATS = [
  ["1 tx", "to escrow and create"],
  ["≈ 10 s", "to pay on Monad"],
  ["10", "networks it pays out on"],
  ["0 gas", "for the person spending"],
]

const STEPS = [
  [
    "Spook",
    "Type an amount and how long it lasts. One transaction escrows the USDC and creates the Spook, so it can't bounce.",
    "One tap · ≈ 5 s",
  ],
  [
    "Share",
    "The link carries a one-off spending key in its fragment, the part of a URL that never reaches a server. Send it in any chat or show it as a QR code.",
    "Any chat · or a QR code",
  ],
  [
    "Spend",
    "The link opens straight to the camera. Scan a USDC payment code or enter an address, check the amount, pay.",
    "≈ 10 s on Monad · ≈ 30 s elsewhere",
  ],
]

const COMPARISON = [
  [
    "Before it's usable",
    "Set up a wallet or passkey to claim it",
    "Nothing to set up. The link already pays",
  ],
  [
    "Paying someone",
    "Claim it, then send it again from the new wallet",
    "Scan their payment code, tap Pay",
  ],
  [
    "Payee on another network",
    "Stuck on the network it was sent on",
    "Delivered on 10 networks through Circle CCTP",
  ],
  [
    "Gas",
    "Someone funds or sponsors the new wallet",
    "Paid from the issuer's capped fee allowance",
  ],
  [
    "Money left over",
    "Sits in a wallet that may never be opened again",
    "Cancel any time; it returns in one transaction",
  ],
  [
    "If the link leaks",
    "Whoever claims first takes everything",
    "Capped, dated and cancellable until spent",
  ],
]

const CONTROLS = [
  [
    Lock,
    "Escrowed",
    "Funds are set aside when the Spook is created. It always clears.",
  ],
  [Gauge, "Capped", "A link can never spend more than the amount on it."],
  [
    CalendarClock,
    "Dated",
    "Every Spook expires. Reclaim what's left with one tap.",
  ],
  [
    Ban,
    "Cancellable",
    "Stop a Spook instantly; unspent USDC and fees come back.",
  ],
  [
    Fuel,
    "Fee-fenced",
    "Each Spook has its own gas allowance, and requests that would fail are refused before they cost anything.",
  ],
  [
    EyeOff,
    "Private by design",
    "The spending key lives only in the link. Spookly's server never sees it.",
  ],
  [
    KeyRound,
    "Backed up to your passkey",
    "Links are sealed on-chain with a key only your passkey can derive, so they open on any device it syncs to.",
  ],
] as const

const STACK = [
  [
    "ERC-4337 Spook book",
    "Each issuer gets a smart account. Every Spook is a one-off key that can only spend its own escrow, before its date, within its own fee allowance.",
  ],
  [
    "One-transaction Spooks",
    "A USDC permit replaces the approval step. The first Spook deploys the book, funds it, deposits fees and creates the Spook in a single transaction.",
  ],
  [
    "Circle CCTP + forwarding",
    "Cross-network payments burn on Monad and Circle mints on the destination, so nobody needs a wallet or gas there.",
  ],
  [
    "Passkey-sealed links",
    "One passkey's PRF output derives the key that seals every link on-chain. A new device restores them all with a single prompt.",
  ],
  [
    "Privy sign-in",
    "Google or email creates an embedded wallet with no seed phrase and no pop-ups.",
  ],
  [
    "Gas-checked sends",
    "Monad charges gas by limit, so every transaction is checked against the balance before it's sent.",
  ],
]

const PROOF = [
  ["Paid from the link", "0.500000 USDC"],
  ["From", "Monad testnet"],
  ["To", "Base Sepolia"],
  ["Circle forwarding fee", "0.063284 USDC"],
  ["Burn → mint", "≈ 15 s"],
  ["Gas paid by the holder", "0 MON"],
]

const Eyebrow = ({ children }: { children: React.ReactNode }) => (
  <span className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
    {children}
  </span>
)

function SectionHead({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string
  title: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="mb-10 flex flex-col justify-between gap-4 md:flex-row md:items-end">
      <div className="flex flex-col gap-3">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          {title}
        </h2>
      </div>
      <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
        {children}
      </p>
    </div>
  )
}

const OpenApp = ({
  children,
  size = "lg",
}: {
  children: React.ReactNode
  size?: "sm" | "lg"
}) => (
  <a
    href={APP_URL}
    target="_blank"
    rel="noreferrer"
    className={cn(buttonVariants({ size }), size === "lg" && "h-12 px-7")}
  >
    {children}
    <ArrowRight data-icon="inline-end" />
  </a>
)

export default async function Landing() {
  const stats = await activityStats()
  return (
    <div className="min-h-svh overflow-x-clip">
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
        <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link
            href="/"
            className="text-sm font-semibold tracking-widest uppercase"
          >
            Spookly
          </Link>
          <div className="flex items-center gap-1">
            {[
              ["#how", "How it works"],
              ["#different", "What's different"],
              ["#safety", "Safety"],
            ].map(([href, label]) => (
              <a
                key={href}
                href={href}
                className={cn(
                  buttonVariants({ variant: "ghost", size: "sm" }),
                  "hidden text-muted-foreground md:inline-flex"
                )}
              >
                {label}
              </a>
            ))}
            <OpenApp size="sm">Open app</OpenApp>
          </div>
        </nav>
      </header>

      <main>
        <section className="relative mx-auto grid max-w-6xl items-center gap-14 px-4 pt-14 pb-16 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-10 lg:pt-24 lg:pb-24">
          <div className="reveal flex flex-col gap-6">
            <Eyebrow>USDC Spooks · Monad</Eyebrow>
            <h1 className="text-[clamp(3.25rem,9vw,6.25rem)] leading-[0.92] font-semibold tracking-tighter">
              Spendable
              <br />
              <span className="mt-[0.12em] inline-block bg-primary px-[0.12em] pb-[0.04em] text-primary-foreground">
                links.
              </span>
            </h1>
            <p className="max-w-md text-lg leading-relaxed text-muted-foreground">
              Put USDC in a link and send it anywhere. Whoever holds it pays
              straight from the link: scan a payment code, tap Pay. No app, no
              wallet, no gas.
            </p>
            <div className="grid gap-3 sm:flex sm:flex-wrap sm:items-center">
              <OpenApp>Spook</OpenApp>
              <a
                href="#how"
                className={cn(
                  buttonVariants({ variant: "outline", size: "lg" }),
                  "h-12 px-7"
                )}
              >
                How it works
              </a>
            </div>
            <span className="font-mono text-xs text-muted-foreground">
              Sign in with Google or email · {IS_MAINNET ? "Monad" : "testnet"}
            </span>
          </div>
          <div className="relative">
            <div className="absolute inset-[10%] -z-10 bg-primary/25 blur-3xl" />
            <ProductMock />
          </div>
        </section>

        <section aria-label="At a glance" className="border-y">
          <dl className="mx-auto grid max-w-6xl grid-cols-2 gap-px bg-border md:grid-cols-4">
            {STATS.map(([value, label]) => (
              <div
                key={label}
                className="flex flex-col gap-1 bg-background px-4 py-6 sm:px-6"
              >
                <dt className="order-2 text-xs text-muted-foreground">
                  {label}
                </dt>
                <dd className="text-3xl font-semibold tracking-tight tabular-nums">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section
          id="how"
          className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6 lg:py-28"
        >
          <SectionHead eyebrow="How it works" title="Spook. Share. Spend.">
            Two people, one link. From a funded wallet to a paid address in
            under a minute.
          </SectionHead>
          <ol className="grid gap-px border bg-border md:grid-cols-3">
            {STEPS.map(([title, text, detail], i) => (
              <li
                key={title}
                className="flex flex-col gap-4 bg-background p-6 sm:p-8"
              >
                <span className="font-mono text-sm text-muted-foreground">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="text-2xl font-semibold tracking-tight">
                  {title}
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {text}
                </p>
                <span className="mt-auto border-t border-dashed pt-4 font-mono text-xs text-muted-foreground">
                  {detail}
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section id="different" className="scroll-mt-20 border-y bg-muted/40">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
            <SectionHead eyebrow="What's different" title="Spend, don't claim.">
              Most payment links make the receiver claim the money into a new
              wallet first. A spendable link skips that step: the link itself
              pays.
            </SectionHead>
            <div className="border bg-background">
              <div className="hidden grid-cols-[1fr_1.2fr_1.2fr] border-b text-xs font-semibold tracking-widest uppercase md:grid">
                <span className="p-5" />
                <span className="p-5 text-muted-foreground">
                  Typical claim link
                </span>
                <span className="bg-primary p-5 text-primary-foreground">
                  Spendable link
                </span>
              </div>
              {COMPARISON.map(([label, claim, spookly]) => (
                <div
                  key={label}
                  className="grid gap-2 border-b p-5 text-sm last:border-b-0 md:grid-cols-[1fr_1.2fr_1.2fr] md:gap-0 md:p-0"
                >
                  <span className="font-semibold md:p-5">{label}</span>
                  <span className="flex gap-2.5 leading-relaxed text-muted-foreground md:p-5">
                    <Minus className="mt-0.5 size-4 shrink-0" />
                    {claim}
                  </span>
                  <span className="flex gap-2.5 leading-relaxed md:bg-primary/10 md:p-5">
                    <Check className="mt-0.5 size-4 shrink-0" />
                    {spookly}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section
          aria-labelledby="networks"
          className="mx-auto max-w-6xl px-4 py-20 sm:px-6"
        >
          <div className="mb-8 flex flex-col gap-3">
            <Eyebrow>Pays out on</Eyebrow>
            <h2 id="networks" className="text-2xl font-semibold tracking-tight">
              Any USDC address on 10 networks
            </h2>
          </div>
          <ul className="grid grid-cols-2 gap-px border bg-border sm:grid-cols-5">
            {NETWORKS.map((n, i) => (
              <li
                key={n.chainId}
                className="flex flex-col gap-1 bg-background p-4"
              >
                <span className="font-medium">{n.name}</span>
                <span className="font-mono text-[11px] text-muted-foreground uppercase">
                  {i === 0 ? "Direct" : "Circle CCTP"}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section
          id="safety"
          className="mx-auto grid max-w-6xl scroll-mt-20 gap-12 border-t px-4 py-20 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:py-28"
        >
          <div className="flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start">
            <Eyebrow>Safety</Eyebrow>
            <h2 className="text-4xl font-semibold tracking-tight sm:text-5xl">
              Built like a Spook.
              <br />
              Safer than one.
            </h2>
            <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
              Each Spook is a narrow permission, not a wallet. Its key can only
              move its own escrowed USDC, only until its date, and only within
              the fee allowance you set.
            </p>
          </div>
          <dl className="flex flex-col border-t">
            {CONTROLS.map(([Icon, title, text]) => (
              <div
                key={title}
                className="grid grid-cols-[2.5rem_1fr] gap-x-3 gap-y-1 border-b py-5 sm:grid-cols-[2.5rem_12rem_1fr]"
              >
                <span className="grid size-8 place-items-center border">
                  <Icon className="size-4" />
                </span>
                <dt className="self-center font-semibold">{title}</dt>
                <dd className="col-start-2 text-sm leading-relaxed text-muted-foreground sm:col-start-3 sm:self-center">
                  {text}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="border-y bg-muted/40">
          <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-20 sm:px-6 lg:py-28">
            <SectionHead
              eyebrow="Under the hood"
              title="Simple on top. Solid underneath."
            >
              The hard parts live in a smart account, a permit, a passkey and
              Circle&apos;s cross-chain rails.
            </SectionHead>
            <ol className="grid gap-3 font-mono text-xs md:grid-cols-[1fr_auto_1.2fr_auto_1.4fr] md:items-center">
              <li className="border bg-background p-4">
                <span className="block text-muted-foreground">ISSUER</span>
                Google sign-in · creates in one tx
              </li>
              <li aria-hidden className="text-center text-muted-foreground">
                <span className="md:hidden">↓</span>
                <span className="hidden md:inline">→</span>
              </li>
              <li className="border border-primary/50 bg-primary/10 p-4">
                <span className="block text-muted-foreground">
                  Spook BOOK · MONAD
                </span>
                ERC-4337 account · escrow · per-Spook keys
              </li>
              <li aria-hidden className="text-center text-muted-foreground">
                <span className="md:hidden">↓</span>
                <span className="hidden md:inline">→</span>
              </li>
              <li className="flex flex-col gap-2">
                <span className="border bg-background p-4">
                  <span className="block text-muted-foreground">
                    PAYEE ON MONAD
                  </span>
                  USDC transfer · ≈ 10 s
                </span>
                <span className="border bg-background p-4">
                  <span className="block text-muted-foreground">
                    PAYEE ON 9 OTHER NETWORKS
                  </span>
                  CCTP burn → Circle mints · ≈ 30 s
                </span>
              </li>
            </ol>
            <dl className="grid gap-px border bg-border sm:grid-cols-2 lg:grid-cols-3">
              {STACK.map(([title, text]) => (
                <div
                  key={title}
                  className="flex flex-col gap-2 bg-background p-6"
                >
                  <dt className="font-semibold">{title}</dt>
                  <dd className="text-sm leading-relaxed text-muted-foreground">
                    {text}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:py-28">
          <div className="flex flex-col gap-4">
            <Eyebrow>Verified testnet payment</Eyebrow>
            <h2 className="text-4xl font-semibold tracking-tight sm:text-5xl">
              A link on Monad.
              <br />A payment on Base.
            </h2>
            <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
              A Spook key paid half a dollar to an address on Base Sepolia.
              Circle&apos;s Forwarding Service burned it on Monad and minted it
              on Base, while the issuer&apos;s deposit covered every fee.
            </p>
            {!IS_MAINNET && stats && <LiveStats stats={stats} />}
          </div>
          <div className="flex flex-col gap-5 border bg-card p-6 shadow-xl sm:p-8">
            <span className="text-sm font-semibold tracking-widest uppercase">
              Spookly Spook
            </span>
            <ol className="flex flex-col gap-2 text-sm">
              {[
                "Paid from the link on Monad",
                "Burned on Monad, minted by Circle",
                "Delivered on Base Sepolia",
              ].map((step) => (
                <li key={step} className="flex items-center gap-2">
                  <Check className="size-4 text-emerald-500" />
                  {step}
                </li>
              ))}
            </ol>
            <dl className="grid grid-cols-[1fr_auto] gap-y-2 border-t pt-5 text-sm">
              {PROOF.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-right font-mono tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              <ExternalLink href="https://testnet.monadexplorer.com/tx/0x46309070f65d48d8574d28098e5f37458fa24d6becaa999ddd9a2738d0fa27a3">
                Burn on Monad ↗
              </ExternalLink>
              <ExternalLink href="https://sepolia.basescan.org/tx/0xa4120e50e6ee672e427dcdf3e2348102bc190b8ce509aed21f8fe924b8fc5446">
                Mint on Base Sepolia ↗
              </ExternalLink>
            </div>
          </div>
        </section>

        <section className="border-t">
          <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-4 py-24 text-center sm:px-6 lg:py-32">
            <h2 className="text-[clamp(2.5rem,7vw,4.5rem)] leading-[0.95] font-semibold tracking-tighter">
              Make your first
              <br />
              <span className="mt-[0.12em] inline-block bg-primary px-[0.12em] pb-[0.04em] text-primary-foreground">
                spendable link.
              </span>
            </h2>
            <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
              Sign in with Google or email, type an amount, share the link. The
              person holding it only needs a camera.
            </p>
            <OpenApp>Open Spookly</OpenApp>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col justify-between gap-2 px-4 py-6 font-mono text-xs text-muted-foreground sm:flex-row sm:px-6">
          <span>Monad · Circle CCTP · ERC-4337 · Privy · Mera</span>
          <span>
            {IS_MAINNET
              ? "Monad mainnet · USDC"
              : "Testnet only. Test USDC has no value."}
          </span>
        </div>
      </footer>
    </div>
  )
}

function LiveStats({ stats }: { stats: ActivityStats }) {
  return (
    <div className="mt-4 flex flex-col gap-3">
      <span className="flex items-center gap-2 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
        <span className="size-1.5 animate-pulse bg-emerald-500" />
        Live on {monad.name}
      </span>
      <dl className="grid grid-cols-3 gap-px border bg-border">
        {[
          ["Spooks created", stats.spooks.toLocaleString("en-US")],
          ["Paid from links", formatUsdc(stats.paidOut)],
          ["Delivered cross-network", stats.delivered.toLocaleString("en-US")],
        ].map(([label, value]) => (
          <div key={label} className="flex flex-col gap-1 bg-background p-4">
            <dt className="order-2 text-xs text-muted-foreground">{label}</dt>
            <dd className="text-2xl font-semibold tracking-tight tabular-nums">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <span className="font-mono text-xs text-muted-foreground">
        Indexed across Monad and nine networks with Envio
      </span>
    </div>
  )
}
