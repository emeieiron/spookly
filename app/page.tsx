import Link from "next/link"
import {
  Hanken_Grotesk,
  IBM_Plex_Mono,
  Instrument_Serif,
} from "next/font/google"
import { HeroCheque } from "@/components/landing/cheque"
import { NETWORKS } from "@/lib/networks"
import "./landing.css"

const display = Instrument_Serif({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-display",
})
const body = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-body" })
const micr = IBM_Plex_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  variable: "--font-micr",
})

const COMPARISON = [
  [
    "Before the money is usable",
    "The recipient sets up a wallet or passkey to claim it",
    "Nothing to set up. The link is already spendable",
  ],
  [
    "Paying a shop",
    "Claim it, then send it again from the new wallet",
    "Scan the shop's QR code, tap Pay",
  ],
  [
    "Shop on another network",
    "Usually stuck on the network it was sent on",
    "Delivered on 10 networks through Circle CCTP",
  ],
  [
    "Gas",
    "Someone has to fund or sponsor the new wallet",
    "Paid from the issuer's capped fee allowance",
  ],
  [
    "Money left over",
    "Stays in a wallet the recipient may never open again",
    "Cancel any time; it's back in your wallet in one transaction",
  ],
  [
    "If the link leaks",
    "Whoever claims first takes all of it",
    "Capped, dated and cancellable until it's spent",
  ],
]

const STEPS = [
  {
    n: "01",
    title: "Write",
    text: "Type an amount and pick how long it lasts. One transaction escrows the USDC, tops up the fee allowance and writes the cheque, so it can't bounce.",
    detail: "One tap · ≈ 5 s",
  },
  {
    n: "02",
    title: "Share",
    text: "Pippo mints a one-off key and tucks it into the link's fragment, the part of a URL browsers never send to a server. Send it in any chat, or show the QR.",
    detail: "Any chat · or a QR code",
  },
  {
    n: "03",
    title: "Spend",
    text: "The link opens straight to the camera. Scan the shop's payment code, check the amount, pay. The person spending sees dollars, a camera and a Pay button.",
    detail: "≈ 10 s on Monad · ≈ 30 s to Base",
  },
]

const STACK = [
  [
    "ERC-4337 cheque book",
    "Each issuer gets a smart account. Every cheque is a one-off key that can only spend its own escrow, before its date, within its own fee allowance. Holders sign, a bundler submits, the issuer's deposit pays gas.",
  ],
  [
    "One-transaction writes",
    "A USDC permit replaces the approval step. A first cheque deploys the book, funds it, deposits fees and writes the cheque in a single transaction.",
  ],
  [
    "Circle CCTP + forwarding",
    "Cross-network payments burn on Monad and Circle mints on the destination, so nobody needs a wallet or gas there. Monad attests in about a block.",
  ],
  [
    "Privy sign-in",
    "Google or email creates an embedded wallet with no seed phrase and no pop-ups: the app's own button is the confirmation.",
  ],
]

const CONTROLS = [
  [
    "Escrowed",
    "Funds are set aside when the cheque is written. It always clears.",
  ],
  ["Capped", "A link can never spend more than the amount written on it."],
  ["Dated", "Every cheque expires. Reclaim whatever is left with one tap."],
  [
    "Cancellable",
    "Stop a cheque instantly; unspent USDC and fees return to your wallet.",
  ],
  [
    "Fee-fenced",
    "Each cheque has its own gas allowance, and doomed requests are refused before they cost anything.",
  ],
  [
    "Private by design",
    "The spending key lives only in the link. Pippo's server never sees it.",
  ],
  [
    "Sign in your way",
    "Write cheques with Google, email or your own wallet, powered by Privy.",
  ],
]

const PROOF = [
  ["Cheque amount paid", "0.500000 USDC"],
  ["From", "Monad testnet"],
  ["To", "Base Sepolia"],
  ["Circle forwarding fee", "0.063284 USDC"],
  ["Burn → mint", "≈ 15 seconds"],
  ["Gas paid by the holder", "0 MON"],
]

export default function Landing() {
  return (
    <div
      className={`landing ${display.variable} ${body.variable} ${micr.variable} min-h-svh overflow-x-clip`}
    >
      <header className="sticky top-0 z-40 border-b border-[var(--rule)] bg-[var(--paper)]/85 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <Link href="/" className="font-display text-2xl italic">
            Pippo
          </Link>
          <div className="flex items-center gap-5 text-sm">
            <a
              href="#different"
              className="hidden opacity-70 transition hover:opacity-100 sm:inline"
            >
              What&apos;s different
            </a>
            <a
              href="#how"
              className="hidden opacity-70 transition hover:opacity-100 md:inline"
            >
              How it works
            </a>
            <a
              href="#stack"
              className="hidden opacity-70 transition hover:opacity-100 md:inline"
            >
              Under the hood
            </a>
            <Link
              href="/app"
              className="group inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-4 py-2 font-medium text-[var(--paper)] transition hover:bg-[var(--green)]"
            >
              Open app <span className="cta-arrow">→</span>
            </Link>
          </div>
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-14 pb-20 sm:px-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.25fr)] lg:gap-6 lg:pt-24 lg:pb-28">
          <div className="reveal flex flex-col gap-7">
            <span className="micr text-xs tracking-[0.3em] text-[var(--green)] uppercase">
              Spend, don&apos;t claim
            </span>
            <h1 className="font-display text-[clamp(3rem,6.4vw,5.6rem)] leading-[0.94] tracking-[-0.01em]">
              Money you can
              <br />
              <em className="text-[var(--green)]">hand over</em>
              <br />
              as a link.
            </h1>
            <p className="max-w-md text-lg leading-relaxed opacity-80">
              Most payment links make people claim the money into a wallet
              first. A Pippo cheque is spent straight from the link: scan a
              shop&apos;s QR code and pay, on Monad or nine other networks. No
              app, no wallet, no gas.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <Link
                href="/app"
                className="inline-flex items-center gap-3 rounded-full bg-[var(--ink)] px-7 py-4 text-base font-medium text-[var(--paper)] shadow-[0_10px_30px_-12px_rgb(20_35_28/0.6)] transition hover:bg-[var(--green)]"
              >
                Write a cheque <span className="cta-arrow">→</span>
              </Link>
              <a
                href="#different"
                className="inline-flex min-h-11 items-center text-base underline decoration-[var(--ink)]/40 underline-offset-4 transition hover:decoration-[var(--ink)]"
              >
                See what&apos;s different
              </a>
            </div>
          </div>
          <div className="relative lg:-mr-20">
            <div className="absolute -inset-10 -z-10 rounded-full bg-[var(--green-wash)] opacity-60 blur-3xl" />
            <HeroCheque />
          </div>
        </section>

        <section
          id="different"
          className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6 lg:py-28"
        >
          <div className="mb-12 flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <h2 className="font-display text-5xl leading-[0.95] sm:text-6xl">
              Spend, <em className="text-[var(--green)]">don&apos;t claim.</em>
            </h2>
            <p className="max-w-sm leading-relaxed opacity-75">
              A payment link is only as easy as its last step. Pippo removes the
              step where the person receiving it has to become a crypto user.
            </p>
          </div>
          <div className="overflow-hidden rounded-2xl border border-[var(--rule)]">
            <div className="hidden grid-cols-[1fr_1.2fr_1.2fr] border-b border-[var(--rule)] bg-[var(--paper-deep)]/60 md:grid">
              <span className="p-5" />
              <span className="micr p-5 text-xs tracking-[0.25em] uppercase opacity-60">
                Typical claim link
              </span>
              <span className="micr p-5 text-xs tracking-[0.25em] text-[var(--green)] uppercase">
                Pippo cheque
              </span>
            </div>
            {COMPARISON.map(([label, claim, pippo]) => (
              <div
                key={label}
                className="grid gap-2 border-b border-[var(--rule)] p-5 last:border-b-0 md:grid-cols-[1fr_1.2fr_1.2fr] md:gap-0 md:p-0"
              >
                <span className="font-display text-2xl md:p-5">{label}</span>
                <span className="flex gap-3 text-sm leading-relaxed opacity-55 md:p-5">
                  <span aria-hidden className="micr">
                    –
                  </span>
                  <span>
                    <span className="micr mr-1 text-[10px] tracking-[0.2em] uppercase md:sr-only">
                      Claim link:
                    </span>
                    {claim}
                  </span>
                </span>
                <span className="flex gap-3 text-sm leading-relaxed md:bg-[var(--green-wash)]/35 md:p-5">
                  <span aria-hidden className="text-[var(--green)]">
                    ✓
                  </span>
                  <span>
                    <span className="micr mr-1 text-[10px] tracking-[0.2em] text-[var(--green)] uppercase md:sr-only">
                      Pippo:
                    </span>
                    {pippo}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </section>

        <section
          id="how"
          className="scroll-mt-20 border-y border-[var(--rule)] bg-[var(--paper-deep)]/60"
        >
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
            <div className="mb-14 flex flex-col justify-between gap-4 md:flex-row md:items-end">
              <h2 className="font-display text-5xl leading-none sm:text-6xl">
                How a cheque <em>moves</em>
              </h2>
              <p className="max-w-sm opacity-70">
                Three steps, two people, one link. From a funded wallet to a
                paid shop in under a minute.
              </p>
            </div>
            <ol className="grid gap-px overflow-hidden rounded-2xl border border-[var(--rule)] bg-[var(--rule)] md:grid-cols-3">
              {STEPS.map((step) => (
                <li
                  key={step.n}
                  className="flex flex-col gap-6 bg-[var(--paper)] p-7 sm:p-9"
                >
                  <span className="micr text-5xl font-medium tracking-tight text-[var(--green)]">
                    {step.n}
                  </span>
                  <h3 className="font-display text-4xl">{step.title}</h3>
                  <p className="leading-relaxed opacity-75">{step.text}</p>
                  <span className="micr mt-auto border-t border-dashed border-[var(--rule)] pt-4 text-xs tracking-wider opacity-70">
                    {step.detail}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section
          aria-label="Supported networks"
          className="overflow-hidden py-14"
        >
          <p className="micr mb-6 text-center text-xs tracking-[0.3em] uppercase opacity-60">
            Pays out on
          </p>
          <div className="marquee">
            {[0, 1].map((copy) => (
              <div
                key={copy}
                className="flex shrink-0 items-center"
                aria-hidden={copy === 1}
              >
                {NETWORKS.map((n) => (
                  <span
                    key={n.chainId}
                    className="font-display flex items-center px-6 text-5xl whitespace-nowrap italic sm:text-6xl"
                  >
                    {n.name}
                    <span className="micr ml-12 text-base text-[var(--stamp)] not-italic">
                      ✦
                    </span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </section>

        <section
          id="controls"
          className="mx-auto grid max-w-6xl gap-14 px-4 py-20 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:py-28"
        >
          <div className="flex flex-col gap-6 lg:sticky lg:top-28 lg:self-start">
            <h2 className="font-display text-5xl leading-[0.95] sm:text-6xl">
              Built like a cheque.
              <br />
              <em className="text-[var(--green)]">Safer</em> than one.
            </h2>
            <p className="max-w-md leading-relaxed opacity-75">
              Each cheque is a narrow permission, not a wallet. Its key can only
              move its own escrowed USDC, only until its date, and only within
              the fee allowance you set.
            </p>
          </div>
          <dl className="flex flex-col">
            {CONTROLS.map(([title, text], i) => (
              <div
                key={title}
                className="grid grid-cols-[3rem_1fr] gap-x-4 border-b border-[var(--rule)] py-6 first:border-t sm:grid-cols-[3rem_11rem_1fr]"
              >
                <span className="micr pt-1 text-sm opacity-50">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <dt className="font-display text-2xl">{title}</dt>
                <dd className="col-start-2 leading-relaxed opacity-75 sm:col-start-3">
                  {text}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section
          id="stack"
          className="scroll-mt-20 border-t border-[var(--rule)] bg-[var(--paper-deep)]/60"
        >
          <div className="mx-auto flex max-w-6xl flex-col gap-12 px-4 py-20 sm:px-6 lg:py-28">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
              <h2 className="font-display text-5xl leading-[0.95] sm:text-6xl">
                Under the <em>hood</em>
              </h2>
              <p className="max-w-sm leading-relaxed opacity-75">
                Simple on the surface because the hard parts live in a smart
                account, a permit and Circle&apos;s cross-chain rails.
              </p>
            </div>
            <ol className="micr grid gap-3 text-xs tracking-wide md:grid-cols-[1fr_auto_1.2fr_auto_1.4fr] md:items-center">
              <li className="rounded-xl border border-[var(--rule)] bg-[var(--paper)] p-4">
                <span className="block opacity-50">ISSUER</span>
                Google sign-in · writes in one tx
              </li>
              <li aria-hidden className="text-center text-[var(--green)]">
                <span className="md:hidden">↓</span>
                <span className="hidden md:inline">→</span>
              </li>
              <li className="rounded-xl border border-[var(--green)]/40 bg-[var(--green-wash)]/50 p-4">
                <span className="block opacity-50">CHEQUE BOOK · MONAD</span>
                ERC-4337 account · escrow · per-cheque keys
              </li>
              <li aria-hidden className="text-center text-[var(--green)]">
                <span className="md:hidden">↓</span>
                <span className="hidden md:inline">→</span>
              </li>
              <li className="flex flex-col gap-2">
                <span className="rounded-xl border border-[var(--rule)] bg-[var(--paper)] p-4">
                  <span className="block opacity-50">SHOP ON MONAD</span>
                  USDC transfer · ≈ 10 s
                </span>
                <span className="rounded-xl border border-[var(--rule)] bg-[var(--paper)] p-4">
                  <span className="block opacity-50">
                    SHOP ON BASE + 8 MORE
                  </span>
                  CCTP burn → Circle mints · ≈ 30 s
                </span>
              </li>
            </ol>
            <dl className="grid gap-px overflow-hidden rounded-2xl border border-[var(--rule)] bg-[var(--rule)] sm:grid-cols-2">
              {STACK.map(([title, text]) => (
                <div
                  key={title}
                  className="flex flex-col gap-3 bg-[var(--paper)] p-7"
                >
                  <dt className="font-display text-3xl">{title}</dt>
                  <dd className="leading-relaxed opacity-75">{text}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="bg-[var(--ink)] text-[var(--paper)]">
          <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:py-28">
            <div className="flex flex-col gap-6">
              <span className="micr text-xs tracking-[0.3em] text-[var(--green-wash)] uppercase">
                Cleared on testnet
              </span>
              <h2 className="font-display text-5xl leading-[0.95] sm:text-6xl">
                A link on Monad.
                <br />
                <em>A payment on Base.</em>
              </h2>
              <p className="max-w-md leading-relaxed opacity-75">
                A cheque key paid half a dollar to an address on Base Sepolia.
                Circle&apos;s Forwarding Service burned it on Monad and minted
                it on Base, while the issuer&apos;s deposit covered every fee.
              </p>
              <div className="micr flex flex-col gap-2 text-xs opacity-70">
                <a
                  className="inline-flex min-h-11 items-center underline-offset-4 hover:underline"
                  href="https://testnet.monadexplorer.com/tx/0x46309070f65d48d8574d28098e5f37458fa24d6becaa999ddd9a2738d0fa27a3"
                  target="_blank"
                  rel="noreferrer"
                >
                  Burn on Monad · 0x4630…7a3 ↗
                </a>
                <a
                  className="inline-flex min-h-11 items-center underline-offset-4 hover:underline"
                  href="https://sepolia.basescan.org/tx/0xa4120e50e6ee672e427dcdf3e2348102bc190b8ce509aed21f8fe924b8fc5446"
                  target="_blank"
                  rel="noreferrer"
                >
                  Mint on Base Sepolia · 0xa412…446 ↗
                </a>
              </div>
            </div>
            <div className="receipt mx-auto w-full max-w-sm rotate-[1.5deg] px-8 py-9 text-[var(--ink)]">
              <p className="font-display text-center text-3xl italic">Pippo</p>
              <p className="micr mt-1 text-center text-[10px] tracking-[0.3em] opacity-60">
                PAYMENT RECEIPT
              </p>
              <dl className="micr mt-7 flex flex-col gap-3 text-sm">
                {PROOF.map(([label, value]) => (
                  <div
                    key={label}
                    className="flex justify-between gap-4 border-b border-dashed border-[var(--rule)] pb-3"
                  >
                    <dt className="opacity-60">{label}</dt>
                    <dd className="text-right font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="micr mt-6 text-center text-xs tracking-[0.25em] text-[var(--green)]">
                ✓ DELIVERED
              </p>
            </div>
          </div>
        </section>

        <section className="mx-auto flex max-w-6xl flex-col items-center gap-8 px-4 py-24 text-center sm:px-6 lg:py-32">
          <h2 className="font-display text-[clamp(3rem,8vw,6rem)] leading-[0.92]">
            Write your <em className="text-[var(--green)]">first</em> cheque.
          </h2>
          <p className="max-w-md opacity-75">
            Sign in with Google, type an amount, send the link. The person you
            send it to only needs a camera.
          </p>
          <Link
            href="/app"
            className="inline-flex items-center gap-3 rounded-full bg-[var(--ink)] px-8 py-4 text-lg font-medium text-[var(--paper)] shadow-[0_10px_30px_-12px_rgb(20_35_28/0.6)] transition hover:bg-[var(--green)]"
          >
            Open Pippo <span className="cta-arrow">→</span>
          </Link>
        </section>
      </main>

      <footer className="border-t border-[var(--rule)]">
        <div className="micr mx-auto flex max-w-6xl flex-col justify-between gap-2 px-4 py-6 text-xs opacity-60 sm:flex-row sm:px-6">
          <span>Monad · Circle CCTP · ERC-4337 · Privy</span>
          <span>Testnet only. Test USDC has no value.</span>
        </div>
      </footer>
    </div>
  )
}
