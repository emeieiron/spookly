import type { Metadata } from "next"
import { Receive } from "@/components/issuer/receive"

export const metadata: Metadata = { title: "Receive · Pippo" }

export default function ReceivePage() {
  return <Receive />
}
