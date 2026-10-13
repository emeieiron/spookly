import type { Metadata, Viewport } from "next"
import { ChequeHolder } from "@/components/cheque-holder"

export const metadata: Metadata = {
  title: "USDC cheque",
  robots: { index: false },
  manifest: "/pwa/spender.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Pippo Spend",
    statusBarStyle: "default",
  },
  icons: { apple: "/pwa/apple-touch-icon.png" },
}

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
}

export default function ChequePage() {
  return <ChequeHolder />
}
