import type { Metadata, Viewport } from "next"
import { SpookHolder } from "@/components/spook-holder"

export const metadata: Metadata = {
  title: "USDC Spook",
  robots: { index: false },
  manifest: "/pwa/spender.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Spookly Spend",
    statusBarStyle: "default",
  },
}

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
}

export default function SpookPage() {
  return <SpookHolder />
}
