import type { Metadata } from "next"
import { SpookDetail } from "@/components/issuer/spook"

export const metadata: Metadata = { title: "Spook · Spookly" }

export default async function SpookPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <SpookDetail id={id} />
}
