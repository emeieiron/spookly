import type { Metadata } from "next"
import { Geist_Mono, Inter } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { SITE_URL } from "@/lib/hosts"
import { cn } from "@/lib/utils"

const socialImage = {
  url: "/brand/spookly-social.jpg",
  width: 1200,
  height: 630,
  alt: "Spookly — Spendable links. USDC, ready to spend.",
}

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL, "https://spookly.xyz"),
  title: "Spookly",
  description:
    "Spendable links: USDC Spooks anyone can spend straight from a link, on Monad or nine other networks.",
  openGraph: {
    type: "website",
    siteName: "Spookly",
    images: [{ ...socialImage, type: "image/jpeg" }],
  },
  twitter: {
    card: "summary_large_image",
    images: [socialImage],
  },
}

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "antialiased",
        fontMono.variable,
        "font-sans",
        inter.variable
      )}
    >
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
