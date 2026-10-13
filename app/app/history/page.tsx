import type { Metadata } from "next"
import { History } from "@/components/issuer/history"

export const metadata: Metadata = { title: "History · Spookly" }

export default function HistoryPage() {
  return <History />
}
