import type { Metadata } from "next"
import { IssuerApp } from "@/components/issuer/app"
import { Privy } from "@/components/privy-provider"

export const metadata: Metadata = { title: "Spookly" }

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Privy>
      <IssuerApp>{children}</IssuerApp>
    </Privy>
  )
}
