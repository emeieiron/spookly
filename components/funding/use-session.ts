"use client"

import { useEffect, useState } from "react"
import { monad } from "@/lib/chain"
import {
  canCloseUnpaid,
  readSession,
  sessionKey,
  type FundingSession,
} from "@/lib/funding/model"

export function useFundingSession(account: string) {
  const [session, setSession] = useState<FundingSession | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [closed, setClosed] = useState<FundingSession[]>([])
  useEffect(() => {
    const load = () => {
      setSession(readSession(localStorage, monad.id, account))
      try {
        const values: unknown = JSON.parse(
          localStorage.getItem(`${sessionKey(monad.id, account)}:closed`) ??
            "[]"
        )
        setClosed(
          Array.isArray(values)
            ? values.flatMap((v) => {
                const s = readSession(
                  { getItem: () => JSON.stringify(v) },
                  monad.id,
                  account
                )
                return s ? [s] : []
              })
            : []
        )
      } catch {
        setClosed([])
      }
      setLoaded(true)
    }
    load()
    window.addEventListener("storage", load)
    window.addEventListener("spookly-funding", load)
    return () => {
      window.removeEventListener("storage", load)
      window.removeEventListener("spookly-funding", load)
    }
  }, [account])
  const save = (value: FundingSession | null) => {
    // Storage must succeed before a wallet is opened or a deposit address is shown.
    const key = sessionKey(monad.id, account)
    if (value) {
      localStorage.setItem(key, JSON.stringify(value))
      localStorage.setItem(
        `${key}:closed`,
        JSON.stringify(closed.filter((s) => s.createdAt !== value.createdAt))
      )
    } else localStorage.removeItem(key)
    setSession(value)
    window.dispatchEvent(new Event("spookly-funding"))
  }
  const close = () => {
    if (!session || !canCloseUnpaid(session, Date.now())) return
    const key = `${sessionKey(monad.id, account)}:closed`
    localStorage.setItem(
      key,
      JSON.stringify(
        [
          session,
          ...closed.filter((s) => s.createdAt !== session.createdAt),
        ].slice(0, 5)
      )
    )
    save(null)
  }
  return { session, loaded, save, closed, close }
}
