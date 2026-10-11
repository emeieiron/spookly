import type { Metadata } from "next"
import { ChequeHolder } from "@/components/cheque-holder"

export const metadata: Metadata = {
  title: "USDC cheque",
  robots: { index: false },
}

export default function ChequePage() {
  return <ChequeHolder />
}
