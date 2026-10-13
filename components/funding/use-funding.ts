"use client"

import { useEffect, useRef, useState } from "react"
import { useWallets } from "@privy-io/react-auth"
import { type EIP1193Provider } from "viem"
import { monad } from "@/lib/chain"
import { errorMessage } from "@/lib/spook-payment"
import { getQuote, getStatus, getTokens } from "@/lib/funding/client"
import {
  fundingComplete,
  terminal,
  type FundingLeg,
  type FundingSession,
  type FundingTarget,
  type FundingToken,
} from "@/lib/funding/model"
import { payDeposit, walletRejected } from "@/lib/funding/source-wallet"
import { useFundingSession } from "./use-session"

export type FundingOptions = {
  account: string
  purpose: "spook" | "receive"
  targets: FundingTarget[]
  draft?: { amount: string; days: number }
  actionLabel: string
  onReady: () => Promise<boolean>
  disabled?: boolean
}
export function useFunding({
  account,
  purpose,
  targets,
  draft,
  onReady,
  disabled = false,
}: FundingOptions) {
  const { session, loaded, save, closed, close } = useFundingSession(account)
  const current = useRef(session)
  useEffect(() => {
    current.current = session
  }, [session])
  const { wallets } = useWallets()
  const connected = wallets.find(
    (w) => w.address.toLowerCase() === account.toLowerCase()
  )
  const [tokens, setTokens] = useState<FundingToken[]>([])
  const [chain, setChain] = useState<string | null>(null)
  const [asset, setAsset] = useState<string | null>(null)
  const [refund, setRefund] = useState(account)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clock, setClock] = useState(() => Date.now())
  const lock = useRef(false)
  const completionAttempt = useRef<string | null>(null)
  const token = tokens.find((t) => t.assetId === asset)
  const ready = session && fundingComplete(session)
  const persist = (s: FundingSession) => {
    save(s)
    current.current = s
  }

  useEffect(() => {
    const controller = new AbortController()
    getTokens(controller.signal)
      .then(setTokens)
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e))
      })
    return () => controller.abort()
  }, [])
  const tracking = session?.legs
    .map((l) => `${l.quote.quote.depositAddress}:${l.status}`)
    .join()
  useEffect(() => {
    if (!tracking) return
    const controller = new AbortController()
    let polling = false
    const poll = async () => {
      setClock(Date.now())
      const s = current.current
      if (!s || polling) return
      polling = true
      try {
        const statuses = await Promise.all(
          s.legs.map((leg) =>
            terminal(leg.status)
              ? leg.status
              : getStatus(leg.quote, controller.signal)
          )
        )
        if (
          controller.signal.aborted ||
          current.current?.createdAt !== s.createdAt
        )
          return
        // Preserve hashes created while this request was in flight.
        const latest = current.current
        if (latest && statuses.some((v, i) => v !== latest.legs[i].status))
          persist({
            ...latest,
            legs: latest.legs.map((l, i) => ({ ...l, status: statuses[i] })),
          })
        setError(null)
      } catch {
        if (!controller.signal.aborted)
          setError(
            "Couldn't check funding yet. Your deposit is saved; do not send it again."
          )
      } finally {
        polling = false
      }
    }
    void poll()
    const interval = setInterval(poll, 5000)
    return () => {
      controller.abort()
      clearInterval(interval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- session refs preserve concurrent wallet updates
  }, [tracking])

  const finish = async () => {
    if (lock.current || disabled) return
    // A completed spook deposit remains attached to its draft when visited from Receive.
    if (current.current?.purpose === "spook" && purpose === "receive") return
    lock.current = true
    setBusy(true)
    setError(null)
    try {
      if (await onReady()) save(null)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  useEffect(() => {
    if (!ready || !session.confirmed || session.purpose !== purpose || disabled)
      return
    const key = String(session.createdAt)
    if (completionAttempt.current === key) return
    completionAttempt.current = key
    void finish()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- automatically finish once; retries are explicit
  }, [ready, session?.confirmed, session?.createdAt, disabled])

  const review = async () => {
    if (!token || lock.current || targets.length === 0) return
    lock.current = true
    setBusy(true)
    setError(null)
    try {
      const legs: FundingLeg[] = []
      // Quotes have no deposits yet; only show addresses after the complete plan is saved.
      for (const target of targets) {
        const quote = await getQuote(token, target, account, refund, false)
        legs.push({
          target,
          quote,
          status: "PENDING_DEPOSIT",
          payment: "unpaid",
        })
      }
      persist({
        version: 1,
        account,
        chainId: monad.id,
        purpose,
        token,
        refundTo: refund,
        legs,
        createdAt: Date.now(),
        confirmed: false,
        draft,
      })
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  const pay = async (index: number) => {
    const s = current.current
    if (!s || !connected || lock.current) return
    const leg = s.legs[index]
    if (leg.payment !== "unpaid" || leg.status !== "PENDING_DEPOSIT") return
    lock.current = true
    setBusy(true)
    setError(null)
    try {
      const hash = await payDeposit(
        {
          ...connected,
          getEthereumProvider: async () =>
            (await connected.getEthereumProvider()) as EIP1193Provider,
        },
        s.token,
        leg,
        () => {
          const latest = current.current!
          persist({
            ...latest,
            confirmed: true,
            legs: latest.legs.map((l, i) =>
              i === index ? { ...l, payment: "signing" } : l
            ),
          })
        }
      )
      const latest = current.current!
      persist({
        ...latest,
        legs: latest.legs.map((l, i) =>
          i === index
            ? { ...l, payment: "submitted", transactionHash: hash }
            : l
        ),
      })
    } catch (e) {
      // Only a proven wallet rejection is safe to reset; RPC timeouts can hide a broadcast transaction.
      const rejected = walletRejected(e)
      if (rejected && current.current)
        persist({
          ...current.current,
          legs: current.current.legs.map((l, i) =>
            i === index ? { ...l, payment: "unpaid" } : l
          ),
        })
      setError(errorMessage(e))
    } finally {
      await connected.switchChain(monad.id).catch(() => {})
      lock.current = false
      setBusy(false)
    }
  }

  return {
    session,
    loaded,
    save,
    closed,
    close,
    tokens,
    chain,
    setChain,
    asset,
    setAsset,
    refund,
    setRefund,
    busy,
    error,
    clock,
    token,
    ready,
    persist,
    review,
    pay,
    finish,
    connected,
  }
}
