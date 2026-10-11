"use client"

import { PrivyProvider } from "@privy-io/react-auth"
import { useEffect, useState } from "react"
import { AppFrame } from "@/components/issuer/app"
import { monad } from "@/lib/chain"
import { WALLET_CHAINS } from "@/lib/funding/chains"

type LoginMethod = "email" | "google" | "wallet"

// Offer Google only when it is enabled for this Privy app; otherwise Privy shows "not allowed" on click.
async function enabledLoginMethods(appId: string): Promise<LoginMethod[]> {
  try {
    const response = await fetch(`https://auth.privy.io/api/v1/apps/${appId}`, {
      headers: { "privy-app-id": appId },
    })
    const app = await response.json()
    return app.google_oauth
      ? ["email", "google", "wallet"]
      : ["email", "wallet"]
  } catch {
    return ["email", "wallet"]
  }
}

export function Privy({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID
  const [loginMethods, setLoginMethods] = useState<LoginMethod[] | null>(null)

  useEffect(() => {
    if (appId) enabledLoginMethods(appId).then(setLoginMethods)
  }, [appId])

  if (!appId)
    return (
      <p className="p-6 text-sm text-destructive">
        Sign-in is unavailable right now.
      </p>
    )
  if (!loginMethods) return <AppFrame />
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods,
        defaultChain: monad,
        supportedChains: WALLET_CHAINS,
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
          // The app's own buttons are the confirmation; Privy's extra approval screens only add steps.
          showWalletUIs: false,
        },
        appearance: {
          theme: "dark",
          accentColor: "#1f5c45",
          landingHeader: "Sign in to write cheques",
          walletChainType: "ethereum-only",
        },
      }}
    >
      {children}
    </PrivyProvider>
  )
}
