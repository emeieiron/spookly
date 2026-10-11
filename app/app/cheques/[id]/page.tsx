import type { Metadata } from "next"
import { ChequeDetail } from "@/components/issuer/cheque"

export const metadata: Metadata = { title: "Cheque · Pippo" }

export default async function ChequePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <ChequeDetail id={id} />
}
