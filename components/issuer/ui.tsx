"use client"

import { ViewTransition } from "react"
import Link from "next/link"
import { ArrowLeft, ChevronRight } from "lucide-react"
import { describe, type Cheque } from "@/lib/cheque-book"
import { formatUsdc } from "@/lib/money"
import { useIssuer } from "./app"

// Forward navigations slide in from the right, back ones from the left; browser back/forward crossfades.
export function Page({ children }: { children: React.ReactNode }) {
  const motion = {
    "nav-forward": "nav-forward",
    "nav-back": "nav-back",
    default: "page-fade",
  }
  return (
    <ViewTransition enter={motion} exit={motion} default="none">
      <div className="flex min-h-0 flex-1 flex-col gap-6">{children}</div>
    </ViewTransition>
  )
}

export function PageTitle({ title }: { title: string }) {
  const { goBack } = useIssuer()
  return (
    <button
      onClick={goBack}
      className="-my-2 flex h-9 shrink-0 items-center gap-2 self-start text-lg font-semibold"
    >
      <ArrowLeft className="size-5" />
      {title}
    </button>
  )
}

export function ErrorLine() {
  const { error } = useIssuer()
  return <p className="min-h-5 text-sm break-words text-destructive">{error}</p>
}

export function ChequeRow({ cheque, now }: { cheque: Cheque; now: number }) {
  const { live, status } = describe(cheque, now)
  return (
    <li>
      <Link
        href={`/app/cheques/${cheque.signer}`}
        transitionTypes={["nav-forward"]}
        className={`flex items-center gap-3 py-3 text-sm ${live ? "" : "text-muted-foreground"}`}
      >
        <span className="font-semibold tabular-nums">
          {formatUsdc(cheque.amount)}
        </span>
        <span className="flex-1 text-xs text-muted-foreground">{status}</span>
        <ChevronRight className="size-4 text-muted-foreground" />
      </Link>
    </li>
  )
}

export const Bar = ({ className }: { className: string }) => (
  <span className={`block animate-pulse bg-muted ${className}`} />
)
