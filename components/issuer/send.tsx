"use client"

import {
  encodeFunctionData,
  formatUnits,
  getAddress,
  isAddress,
  pad,
  zeroHash,
  type Hash,
} from "viem"
import { useEffect, useState } from "react"
import { Check, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ExternalLink } from "@/components/external-link"
import { NetworkSelect } from "@/components/network-select"
import {
  FORWARD_HOOK,
  STANDARD_FINALITY,
  deliveryStatus,
  forwardingFee,
  tokenMessengerAbi,
} from "@/lib/cctp"
import { EXPLORER, TOKEN_MESSENGER, USDC, erc20Abi } from "@/lib/chain"
import { errorMessage, publicClient } from "@/lib/cheque-payment"
import { formatUsdc, parseUsdc, shortAddress } from "@/lib/money"
import {
  NETWORKS,
  isLocal,
  networkByChainId,
  type Network,
} from "@/lib/networks"
import {
  sendChecked,
  type SignerClient,
  type SponsorSender,
} from "@/lib/wallet-send"
import { useIssuer } from "./app"
import { readPendingTransfer } from "@/lib/sponsor-pending"
import { Bar, Page, PageTitle } from "./ui"

type Sent = {
  amount: bigint
  recipient: string
  network: Network
  hash: Hash
  forwardTxHash?: string
  delivered: boolean
}

export function Send() {
  const { wallet, refresh, goBack, sponsor } = useIssuer()
  if (!wallet)
    return (
      <Page>
        <PageTitle title="Send" />
        <Bar className="h-[65px]" />
      </Page>
    )
  return (
    <Page>
      <PageTitle title="Send" />
      <SendForm
        client={wallet.client}
        balance={wallet.usdc}
        onDone={goBack}
        onSent={refresh}
        sponsor={sponsor}
      />
    </Page>
  )
}

function SendForm({
  client,
  balance,
  onDone,
  onSent,
  sponsor,
}: {
  client: SignerClient
  balance: bigint
  onDone: () => void
  onSent: () => void
  sponsor: SponsorSender
}) {
  const pending = readPendingTransfer(client.account.address)
  const [amountText, setAmountText] = useState(
    pending ? formatUnits(pending.amount, 6) : ""
  )
  const [recipient, setRecipient] = useState(pending?.recipient ?? "")
  const [chainId, setChainId] = useState(NETWORKS[0].chainId)
  const [fee, setFee] = useState<{ chainId: number; value: bigint } | null>(
    null
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<Sent | null>(null)

  const network = networkByChainId(chainId)!
  const local = isLocal(network)
  const amount = parseUsdc(amountText)
  const currentFee = local
    ? 0n
    : fee && fee.chainId === chainId
      ? fee.value
      : null
  const total =
    amount !== null && currentFee !== null ? amount + currentFee : null
  const max =
    currentFee === null
      ? null
      : balance > currentFee
        ? balance - currentFee
        : 0n
  const validRecipient = isAddress(recipient)
  const resuming =
    pending &&
    local &&
    amount === pending.amount &&
    recipient.toLowerCase() === pending.recipient.toLowerCase()
  const problem =
    error ??
    (recipient && !validRecipient
      ? "That isn't a valid address."
      : !resuming && total !== null && total > balance
        ? `Your wallet has ${formatUsdc(balance)}.`
        : "")

  useEffect(() => {
    if (local) return
    let cancelled = false
    forwardingFee(network.domain)
      .then((value) => !cancelled && setFee({ chainId, value }))
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [chainId, local, network.domain])

  // Cross-chain sends are tracked until Circle confirms the mint on the destination network.
  useEffect(() => {
    if (!sent || isLocal(sent.network) || sent.delivered) return
    let cancelled = false
    const poll = async () => {
      while (!cancelled) {
        const delivery = await deliveryStatus(sent.hash).catch(() => null)
        if (cancelled) return
        if (delivery?.forwardTxHash || delivery?.status === "delivered") {
          setSent(
            (s) =>
              s && {
                ...s,
                forwardTxHash: delivery.forwardTxHash,
                delivered: delivery.status === "delivered",
              }
          )
          if (delivery.status === "delivered") return
        }
        await new Promise((r) => setTimeout(r, 2500))
      }
    }
    poll()
    return () => {
      cancelled = true
    }
  }, [sent?.hash, sent?.delivered, sent?.network]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (amount === null || total === null || !validRecipient) return
    setBusy(true)
    setError(null)
    try {
      const to = getAddress(recipient)
      let hash: Hash
      if (local) {
        hash = await sendChecked(
          client,
          USDC,
          encodeFunctionData({
            abi: erc20Abi,
            functionName: "transfer",
            args: [to, amount],
          }),
          0n,
          sponsor
        )
      } else {
        const allowance = await publicClient.readContract({
          address: USDC,
          abi: erc20Abi,
          functionName: "allowance",
          args: [client.account.address, TOKEN_MESSENGER],
        })
        if (allowance < total)
          await sendChecked(
            client,
            USDC,
            encodeFunctionData({
              abi: erc20Abi,
              functionName: "approve",
              args: [TOKEN_MESSENGER, total],
            }),
            0n,
            sponsor
          )
        hash = await sendChecked(
          client,
          TOKEN_MESSENGER,
          encodeFunctionData({
            abi: tokenMessengerAbi,
            functionName: "depositForBurnWithHook",
            args: [
              total,
              network.domain,
              pad(to, { size: 32 }),
              USDC,
              zeroHash,
              currentFee!,
              STANDARD_FINALITY,
              FORWARD_HOOK,
            ],
          }),
          0n,
          sponsor
        )
      }
      setSent({ amount, recipient: to, network, hash, delivered: local })
      onSent()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    const done = sent.delivered
    const steps = isLocal(sent.network)
      ? [{ label: "Sent", done: true }]
      : [
          { label: "Sent from your wallet", done: true },
          {
            label: `Moving to ${sent.network.name}`,
            done: !!sent.forwardTxHash || done,
          },
          { label: `Delivered on ${sent.network.name}`, done },
        ]
    return (
      <section className="flex flex-col items-center gap-4">
        <div
          className={`flex size-16 items-center justify-center rounded-full ${done ? "bg-emerald-500 text-white" : "bg-muted"}`}
        >
          {done ? (
            <Check className="size-8" strokeWidth={3} />
          ) : (
            <Loader2 className="size-8 animate-spin" />
          )}
        </div>
        <div className="flex flex-col items-center gap-1">
          <span className="text-4xl font-semibold tabular-nums">
            {formatUsdc(sent.amount)}
          </span>
          <span className="text-sm text-muted-foreground">
            to {shortAddress(sent.recipient)} on {sent.network.name}
          </span>
        </div>
        <ol className="flex w-full flex-col gap-2 text-sm">
          {steps.map((step) => (
            <li key={step.label} className="flex items-center gap-2">
              {step.done ? (
                <Check className="size-4 text-emerald-500" />
              ) : (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              )}
              {step.label}
            </li>
          ))}
        </ol>
        <div className="flex gap-4">
          <ExternalLink href={`${EXPLORER}/tx/${sent.hash}`}>
            View on Monad
          </ExternalLink>
          {sent.forwardTxHash && (
            <ExternalLink
              href={`${sent.network.explorer}/tx/${sent.forwardTxHash}`}
            >
              View on {sent.network.name}
            </ExternalLink>
          )}
        </div>
        <Button variant="outline" className="w-full" onClick={onDone}>
          Done
        </Button>
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between border-b pb-2">
        <Label className="cursor-text items-baseline tracking-normal normal-case select-auto">
          <span className="text-4xl font-semibold text-muted-foreground">
            $
          </span>
          <Input
            aria-label="Amount to send in USDC"
            inputMode="decimal"
            placeholder="0.00"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            className="field-sizing-content h-14 w-auto! min-w-[2ch] border-0 px-0 text-4xl font-semibold tabular-nums shadow-none focus-visible:ring-0 md:text-4xl"
          />
        </Label>
        <Button
          size="xs"
          variant="outline"
          disabled={!max}
          onClick={() => max && setAmountText(formatUnits(max, 6))}
        >
          Max
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="send-to">To</Label>
        <Input
          id="send-to"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value.trim())}
          placeholder="0x…"
          autoComplete="off"
          spellCheck={false}
          className="font-mono"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="send-network">Network</Label>
        <NetworkSelect
          id="send-network"
          value={chainId}
          onChange={(id) => {
            setError(null)
            setChainId(id)
          }}
        />
      </div>

      <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm">
        <dt className="text-muted-foreground">Recipient receives</dt>
        <dd className="tabular-nums">
          {amount === null ? "—" : formatUsdc(amount)}
        </dd>
        <dt className="text-muted-foreground">Network fee</dt>
        <dd className="tabular-nums">
          {currentFee === null
            ? "…"
            : currentFee === 0n
              ? "Free"
              : formatUsdc(currentFee)}
        </dd>
      </dl>

      <p className="min-h-5 text-sm break-words text-destructive">{problem}</p>

      <div className="flex">
        <Button
          size="lg"
          className="flex-1"
          disabled={
            busy ||
            amount === null ||
            total === null ||
            (!resuming && total > balance) ||
            !validRecipient
          }
          onClick={submit}
        >
          {busy ? (
            <Loader2 className="animate-spin" />
          ) : resuming ? (
            "Check transaction"
          ) : (
            `Send ${amount ? formatUsdc(amount) : ""}`
          )}
        </Button>
      </div>
    </section>
  )
}
