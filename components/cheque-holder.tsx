"use client"

import { privateKeyToAccount } from "viem/accounts"
import { getAddress, isAddress, type Address, type Hash, type Hex } from "viem"
import { useCallback, useEffect, useState } from "react"
import { Check, Clock, Loader2 } from "lucide-react"
import { BackTitle } from "@/components/back-title"
import { ExternalLink } from "@/components/external-link"
import { NetworkSelect } from "@/components/network-select"
import { ChainName } from "@/components/chain-name"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { QrScanner } from "@/components/qr-scanner"
import { deliveryStatus, forwardingFee, type Delivery } from "@/lib/cctp"
import { readChequeFragment } from "@/lib/cheque-link"
import { EXPLORER, monad } from "@/lib/chain"
import {
  errorMessage,
  planPayment,
  readCheque,
  sendPayment,
  waitForPayment,
  type ChequeState,
  type PaymentPlan,
} from "@/lib/cheque-payment"
import { formatUsdc, parseUsdc, shortAddress } from "@/lib/money"
import { isLocal, networkByChainId, type Network } from "@/lib/networks"
import { parsePaymentRequest, type PaymentRequest } from "@/lib/payment-request"

type Cheque = { book: Address; key: Hex; signer: Address }

// Survives a refresh mid-payment so the holder sees the outcome instead of paying twice.
type Pending = {
  chainId: number
  recipient: Address
  amount: string
  fee: string
  userOpHash: Hash
  fromBlock: string
  transactionHash?: Hash
  forwardTxHash?: string
  delivered?: boolean
}

type Stage =
  | { kind: "scan" }
  | { kind: "confirm"; request: Partial<PaymentRequest> }
  | { kind: "payment"; pending: Pending }

const pendingKey = (signer: Address) => `pippo:pending:${monad.id}:${signer}`
const savePending = (signer: Address, pending: Pending | null) => {
  try {
    if (pending)
      localStorage.setItem(pendingKey(signer), JSON.stringify(pending))
    else localStorage.removeItem(pendingKey(signer))
  } catch {}
}
const loadPending = (signer: Address): Pending | null => {
  try {
    return JSON.parse(localStorage.getItem(pendingKey(signer)) ?? "null")
  } catch {
    return null
  }
}

export function ChequeHolder() {
  const [cheque, setCheque] = useState<Cheque | null>()
  const [state, setState] = useState<ChequeState | null>(null)
  const [stage, setStage] = useState<Stage>({ kind: "scan" })
  // The confirm step gets its own history entry, so the phone's back gesture returns to the scanner.
  const openConfirm = (request: Partial<PaymentRequest>) => {
    history.pushState({ pippo: "confirm" }, "")
    setStage({ kind: "confirm", request })
  }
  useEffect(() => {
    const onPop = () =>
      setStage((current) =>
        current.kind === "confirm" ? { kind: "scan" } : current
      )
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [])
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    const read = () => {
      const parsed = readChequeFragment(window.location.hash)
      if (!parsed) return setCheque(null)
      const signer = privateKeyToAccount(parsed.key).address
      setCheque({ ...parsed, signer })
      const pending = loadPending(signer)
      setStage(pending ? { kind: "payment", pending } : { kind: "scan" })
    }
    read()
    window.addEventListener("hashchange", read)
    return () => window.removeEventListener("hashchange", read)
  }, [])

  const refresh = useCallback(async () => {
    if (!cheque) return
    try {
      setState(await readCheque(cheque.book, cheque.signer))
      setLoadError(null)
    } catch {
      setLoadError("Couldn't load this cheque. Check your connection.")
    }
  }, [cheque])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading external chain state
    refresh()
  }, [refresh])

  // Loading renders the scanner layout itself, so the real content drops in without anything moving.
  const scanScreen = (current: ChequeState | null) => (
    <Shell>
      <div className="flex h-9 items-baseline justify-between gap-3">
        {current ? (
          <>
            <span className="text-3xl font-semibold tabular-nums">
              {formatUsdc(current.remaining)}
            </span>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="size-3.5" />
              until{" "}
              {new Date(current.expiry * 1000).toLocaleDateString(undefined, {
                day: "numeric",
                month: "short",
              })}
            </span>
          </>
        ) : (
          <span className="h-8 w-28 animate-pulse bg-muted" />
        )}
      </div>
      {current ? (
        <QrScanner
          onResult={(text) => openConfirm(parsePaymentRequest(text) ?? {})}
        />
      ) : (
        <div className="aspect-square w-full bg-black" />
      )}
      <p className="text-center text-sm text-muted-foreground">
        Point at a USDC payment QR code
      </p>
      <Button
        variant="outline"
        disabled={!current}
        onClick={() => openConfirm({})}
      >
        Enter address instead
      </Button>
      <p className="text-xs text-muted-foreground">
        Keep this link private. Anyone with it can spend it.
      </p>
    </Shell>
  )

  if (cheque === undefined) return scanScreen(null)
  if (cheque === null)
    return (
      <Shell>
        <Message title="This link isn't a cheque">
          Ask the issuer to share the full link again.
        </Message>
      </Shell>
    )

  if (stage.kind === "payment")
    return (
      <Shell>
        <PaymentProgress
          cheque={cheque}
          pending={stage.pending}
          onFinish={() => {
            savePending(cheque.signer, null)
            setStage({ kind: "scan" })
            if (history.state?.pippo === "payment") history.back()
            refresh()
          }}
        />
      </Shell>
    )

  if (!state)
    return loadError ? (
      <Shell>
        <Message title="Something went wrong">{loadError}</Message>
      </Shell>
    ) : (
      scanScreen(null)
    )

  const expired = state.expiry * 1000 <= state.checkedAt
  if (!state.active || expired || state.remaining === 0n)
    return (
      <Shell>
        <Message
          title={
            !state.active
              ? "This cheque was cancelled"
              : expired
                ? "This cheque has expired"
                : "This cheque is used up"
          }
        >
          Ask the issuer for a new one.
        </Message>
      </Shell>
    )

  if (stage.kind === "confirm")
    return (
      <Shell>
        <BackTitle title="Confirm payment" onBack={() => history.back()} />
        <ConfirmPayment
          cheque={cheque}
          state={state}
          request={stage.request}
          onSent={(pending) => {
            savePending(cheque.signer, pending)
            // The payment replaces the confirm entry: going back must not reopen a form for a sent payment.
            history.replaceState({ pippo: "payment" }, "")
            setStage({ kind: "payment", pending })
          }}
        />
      </Shell>
    )

  return scanScreen(state)
}

function ConfirmPayment({
  cheque,
  state,
  request,
  onSent,
}: {
  cheque: Cheque
  state: ChequeState
  request: Partial<PaymentRequest>
  onSent: (pending: Pending) => void
}) {
  const [recipient, setRecipient] = useState<string>(request.recipient ?? "")
  const [chainId, setChainId] = useState<number | undefined>(
    request.chainId && networkByChainId(request.chainId)
      ? request.chainId
      : undefined
  )
  const [amountText, setAmountText] = useState(
    request.amount ? (Number(request.amount) / 1e6).toString() : ""
  )
  const [fee, setFee] = useState<{ chainId: number; value: bigint } | null>(
    null
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const network = chainId ? networkByChainId(chainId) : undefined
  const amount = parseUsdc(amountText)
  const unknownChain =
    request.chainId !== undefined && !networkByChainId(request.chainId)
  const currentFee =
    network && isLocal(network)
      ? 0n
      : fee && fee.chainId === chainId
        ? fee.value
        : null
  const total =
    amount !== null && currentFee !== null ? amount + currentFee : null

  useEffect(() => {
    if (!network || isLocal(network)) return
    let cancelled = false
    forwardingFee(network.domain)
      .then(
        (value) => !cancelled && setFee({ chainId: network.chainId, value })
      )
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [network])

  const pay = async () => {
    if (!network || amount === null || !isAddress(recipient)) return
    setBusy(true)
    setError(null)
    try {
      const plan: PaymentPlan = await planPayment(
        cheque.book,
        cheque.signer,
        network,
        getAddress(recipient),
        amount
      )
      const base = {
        chainId: network.chainId,
        recipient: plan.recipient,
        amount: plan.amount.toString(),
        fee: plan.fee.toString(),
      }
      const { userOpHash, fromBlock } = await sendPayment(
        cheque.book,
        cheque.key,
        plan
      )
      onSent({ ...base, userOpHash, fromBlock: fromBlock.toString() })
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {request.wrongToken && (
        <Notice>
          This code asks for a different token. Only continue if the recipient
          accepts USDC.
        </Notice>
      )}
      {unknownChain && (
        <Notice>
          This code is for an unsupported network. Choose a supported one below.
        </Notice>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="recipient">Paying to</Label>
        <Input
          id="recipient"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value.trim())}
          placeholder="0x…"
          className="font-mono"
        />
        {recipient && !isAddress(recipient) && (
          <p className="text-xs text-destructive">
            That isn&apos;t a valid address.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="network">Network</Label>
        <NetworkSelect
          id="network"
          value={chainId}
          onChange={setChainId}
          placeholder="Choose the recipient's network"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="amount">Amount (USDC)</Label>
        <Input
          id="amount"
          inputMode="decimal"
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
          placeholder="0.00"
          className="h-14 text-2xl tabular-nums"
        />
      </div>

      <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm">
        <dt className="text-muted-foreground">Recipient receives</dt>
        <dd className="tabular-nums">
          {amount === null ? "—" : formatUsdc(amount)}
        </dd>
        <dt className="text-muted-foreground">Network fee</dt>
        <dd className="tabular-nums">
          {!network
            ? "—"
            : currentFee === null
              ? "…"
              : currentFee === 0n
                ? "Free"
                : formatUsdc(currentFee)}
        </dd>
        <dt className="font-semibold">From your cheque</dt>
        <dd className="font-semibold tabular-nums">
          {total === null ? "—" : formatUsdc(total)}
        </dd>
      </dl>
      {/* One reserved line, so a late fee quote or error never pushes the Pay button. */}
      <p className="min-h-5 text-sm break-words text-destructive">
        {error ??
          (total !== null && total > state.remaining
            ? `That's more than you have (${formatUsdc(state.remaining)}).`
            : "")}
      </p>

      <Button
        size="lg"
        className="h-14"
        disabled={
          busy ||
          !network ||
          !isAddress(recipient) ||
          total === null ||
          total > state.remaining
        }
        onClick={pay}
      >
        {busy ? (
          <Loader2 className="animate-spin" />
        ) : (
          `Pay ${amount ? formatUsdc(amount) : ""}`
        )}
      </Button>
    </div>
  )
}

function PaymentProgress({
  cheque,
  pending: initial,
  onFinish,
}: {
  cheque: Cheque
  pending: Pending
  onFinish: () => void
}) {
  const [pending, setPending] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const network = networkByChainId(pending.chainId) as Network
  const local = isLocal(network)
  const done = pending.transactionHash && (local || pending.delivered)

  useEffect(() => {
    if (done) return
    let cancelled = false
    const update = (next: Pending) => {
      if (cancelled) return
      savePending(cheque.signer, next)
      setPending(next)
    }
    ;(async () => {
      try {
        let current = pending
        if (!current.transactionHash) {
          current = {
            ...current,
            transactionHash: await waitForPayment(
              current.userOpHash,
              BigInt(current.fromBlock)
            ),
          }
          update(current)
        }
        if (local) return
        for (;;) {
          const delivery: Delivery = await deliveryStatus(
            current.transactionHash!
          ).catch(() => ({ status: "pending" as const }))
          if (cancelled) return
          if (delivery.status === "failed")
            throw new Error(
              "Circle couldn't deliver this payment yet. It will be retried."
            )
          if (
            delivery.forwardTxHash !== current.forwardTxHash ||
            delivery.status === "delivered"
          ) {
            current = {
              ...current,
              forwardTxHash: delivery.forwardTxHash,
              delivered: delivery.status === "delivered",
            }
            update(current)
            if (current.delivered) return
          }
          await new Promise((r) => setTimeout(r, 2500))
        }
      } catch (e) {
        if (!cancelled) setError(errorMessage(e))
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per pending payment and retry
  }, [pending.userOpHash, done, attempt])

  const amount = BigInt(pending.amount)
  const steps = local
    ? [{ label: "Payment sent", done: !!pending.transactionHash, chain: null }]
    : [
        {
          label: "Sent from your cheque",
          done: !!pending.transactionHash,
          chain: null,
        },
        {
          label: "Moving to",
          chain: network.chainId,
          done: !!pending.forwardTxHash || !!pending.delivered,
        },
        {
          label: "Delivered on",
          chain: network.chainId,
          done: !!pending.delivered,
        },
      ]

  return (
    <div className="flex flex-col items-center gap-6 py-6 text-center">
      <div
        className={`flex size-20 items-center justify-center rounded-full ${done ? "bg-emerald-500 text-white" : "bg-muted"}`}
      >
        {done ? (
          <Check className="size-10" strokeWidth={3} />
        ) : (
          <Loader2 className="size-10 animate-spin" />
        )}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-4xl font-semibold tabular-nums">
          {formatUsdc(amount)}
        </span>
        <span className="text-sm text-muted-foreground">
          {done ? "Paid" : "Paying"} to {shortAddress(pending.recipient)} on{" "}
          <ChainName chain={network.chainId} />
        </span>
      </div>
      <ol className="flex w-full flex-col gap-2 text-left text-sm">
        {steps.map((step) => (
          <li key={step.label} className="flex items-center gap-2">
            {step.done ? (
              <Check className="size-4 text-emerald-500" />
            ) : (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            )}
            <span>
              {step.label}
              {step.chain && (
                <>
                  {" "}
                  <ChainName chain={step.chain} />
                </>
              )}
            </span>
          </li>
        ))}
      </ol>
      {error && <p className="text-sm break-words text-destructive">{error}</p>}
      <div className="flex flex-col items-start gap-1">
        {pending.transactionHash && (
          <ExternalLink href={`${EXPLORER}/tx/${pending.transactionHash}`}>
            View payment
          </ExternalLink>
        )}
        {pending.forwardTxHash && !local && (
          <ExternalLink
            href={`${network.explorer}/tx/${pending.forwardTxHash}`}
          >
            View delivery on <ChainName chain={network.chainId} />
          </ExternalLink>
        )}
      </div>
      {error && !done && (
        <Button
          className="w-full"
          onClick={() => {
            setError(null)
            setAttempt((n) => n + 1)
          }}
        >
          Check again
        </Button>
      )}
      {(done || (error && pending.transactionHash)) && (
        <Button variant="outline" className="w-full" onClick={onFinish}>
          Done
        </Button>
      )}
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md min-w-0 flex-col gap-4 px-4 py-6">
      <header className="mb-2 text-sm font-semibold tracking-widest uppercase">
        Pippo cheque
      </header>
      {children}
    </main>
  )
}

function Message({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="mt-10 flex flex-col gap-2 text-center">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  )
}

const Notice = ({ children }: { children: React.ReactNode }) => (
  <p className="border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
    {children}
  </p>
)
