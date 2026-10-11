import type { Metadata } from "next"
import { Send } from "@/components/issuer/send"

export const metadata: Metadata = { title: "Send · Pippo" }

export default function SendPage() {
  return <Send />
}
