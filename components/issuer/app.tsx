"use client"

import {
  createWalletClient,
  custom,
  getAddress,
  type Address,
  type EIP1193Provider,
} from "viem"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { usePrivy, useWallets } from "@privy-io/react-auth"
import { Check, Copy, LogOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import { readBook, type Book } from "@/lib/cheque-book"
import {
  createVault,
  loadVault,
  sealedKeyId,
  unlockVault,
  type LinkVault,
} from "@/lib/link-vault"
import { FACTORY, USDC, erc20Abi, monadTestnet } from "@/lib/chain"
import { errorMessage, publicClient } from "@/lib/cheque-payment"
import { shortAddress } from "@/lib/money"
import type { SignerClient } from "@/lib/wallet-send"

export type Wallet = {
  account: Address
  client: SignerClient
  usdc: bigint
  mon: bigint
  book: Book | null
  checkedAt: number
}

type Issuer = {
  wallet: Wallet | null
  busy: string | null
  error: string | null
  setError: (error: string | null) => void
  // Runs a wallet action with a busy label and error capture, then refreshes balances. Resolves to null on failure.
  run: <T>(
    label: string,
    action: (w: Wallet) => Promise<T>
  ) => Promise<T | null>
  refresh: () => Promise<void>
  goBack: () => void
  copied: Address | null
  setCopied: (signer: Address | null) => void
  // Passkey-derived key that seals cheque links on-chain; null until set up or unlocked on this device.
  vault: LinkVault | null
  setUpVault: () => Promise<LinkVault | null>
  unlockVault: () => Promise<LinkVault | null>
}

const IssuerContext = createContext<Issuer | null>(null)
export const useIssuer = () => useContext(IssuerContext)!

const walletClientFor = (account: Address, provider: EIP1193Provider) =>
  createWalletClient({
    account,
    chain: monadTestnet,
    transport: custom(provider),
  })

async function fetchWallet(
  account: Address,
  client: SignerClient
): Promise<Wallet> {
  const [usdc, mon, book] = await Promise.all([
    publicClient.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account],
    }),
    publicClient.getBalance({ address: account }),
    FACTORY ? readBook(FACTORY, account) : null,
  ])
  return { account, client, usdc, mon, book, checkedAt: Date.now() }
}

export function IssuerApp({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, login, logout, user } = usePrivy()
  const { wallets, ready: walletsReady } = useWallets()
  const router = useRouter()
  const pathname = usePathname()
  // The user's primary wallet: the embedded wallet after an email or social sign-in, or the wallet they signed in with.
  const active =
    wallets.find(
      (w) => w.address.toLowerCase() === user?.wallet?.address?.toLowerCase()
    ) ?? wallets[0]
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<Address | null>(null)
  const [vault, setVault] = useState<LinkVault | null>(null)

  const load = useCallback(
    async (account: Address, client: SignerClient) =>
      setWallet(await fetchWallet(account, client)),
    []
  )

  const activeAddress = active?.address
  useEffect(() => {
    const target = wallets.find((w) => w.address === activeAddress)
    if (!authenticated || !target) return
    let live = true
    ;(async () => {
      try {
        await target.switchChain(monadTestnet.id)
        const provider = (await target.getEthereumProvider()) as EIP1193Provider
        const account = getAddress(target.address)
        if (live) await load(account, walletClientFor(account, provider))
      } catch (e) {
        if (live) setError(errorMessage(e))
      }
    })()
    return () => {
      live = false
    }
    // Privy can hand back a new wallets array on every render; reconnect only when the signing wallet changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, activeAddress, load])

  // Keep balances current, so funds arriving from a faucet or another wallet show up without a reload.
  const account = wallet?.account
  const client = wallet?.client
  useEffect(() => {
    if (!account || !client || busy) return
    const refresh = () => load(account, client).catch(() => {})
    const timer = setInterval(refresh, 10_000)
    window.addEventListener("focus", refresh)
    return () => {
      clearInterval(timer)
      window.removeEventListener("focus", refresh)
    }
  }, [account, client, busy, load])

  // In-app history, so a back arrow returns where the user came from and only falls back to /app on a direct visit.
  const trail = useRef<string[]>([])
  useEffect(() => {
    const t = trail.current
    if (t[t.length - 2] === pathname) t.pop()
    else if (t[t.length - 1] !== pathname) t.push(pathname)
  }, [pathname])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- errors belong to the page they happened on
    setError(null)
  }, [pathname])
  const goBack = useCallback(() => {
    if (trail.current.length > 1) router.back()
    else router.replace("/app", { transitionTypes: ["nav-back"] })
  }, [router])

  const run = async <T,>(
    label: string,
    action: (w: Wallet) => Promise<T>
  ): Promise<T | null> => {
    if (!wallet) return null
    setBusy(label)
    setError(null)
    try {
      const result = await action(wallet)
      await load(wallet.account, wallet.client)
      return result
    } catch (e) {
      setError(errorMessage(e))
      return null
    } finally {
      setBusy(null)
    }
  }

  const vaultOwner = wallet?.account
  useEffect(() => {
    if (!vaultOwner) return
    let live = true
    loadVault(vaultOwner).then((v) => live && setVault(v))
    return () => {
      live = false
    }
  }, [vaultOwner])

  const withVault = async (label: string, open: () => Promise<LinkVault>) => {
    setBusy(label)
    setError(null)
    try {
      const v = await open()
      setVault(v)
      return v
    } catch (e) {
      setError(errorMessage(e))
      return null
    } finally {
      setBusy(null)
    }
  }
  const setUpVault = () =>
    withVault("vault", () =>
      createVault(
        wallet!.account,
        user?.email?.address ?? user?.google?.email ?? wallet!.account
      )
    )
  const unlock = () =>
    withVault("vault", () => {
      const sealed = wallet?.book?.cheques.find(
        (c) => c.sealedKey !== "0x"
      )?.sealedKey
      return unlockVault(wallet!.account, sealed ? sealedKeyId(sealed) : null)
    })

  const signOut = async () => {
    await logout()
    setWallet(null)
    router.replace("/app")
  }

  const signedIn = ready && authenticated
  const connected =
    wallet && wallet.account.toLowerCase() === active?.address.toLowerCase()

  return (
    <IssuerContext.Provider
      value={{
        wallet: connected ? wallet : null,
        busy,
        error,
        setError,
        run,
        refresh: () =>
          wallet ? load(wallet.account, wallet.client) : Promise.resolve(),
        goBack,
        copied,
        setCopied,
        vault,
        setUpVault,
        unlockVault: unlock,
      }}
    >
      <AppFrame
        account={connected ? wallet.account : undefined}
        onSignOut={signedIn ? signOut : undefined}
      >
        {!ready ? null : !authenticated ? (
          <div className="flex flex-col gap-6">
            <h1 className="text-3xl font-semibold">Write USDC cheques</h1>
            <Button size="lg" onClick={() => login()}>
              Sign in
            </Button>
          </div>
        ) : walletsReady && !active ? (
          <p className="text-sm text-destructive">
            No wallet connected. Sign out and try again.
          </p>
        ) : (
          children
        )}
      </AppFrame>
    </IssuerContext.Provider>
  )
}

// The header stays put across page transitions; pages slide beneath it.
export function AppFrame({
  children,
  account,
  onSignOut,
}: {
  children?: React.ReactNode
  account?: Address
  onSignOut?: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  return (
    <main className="mx-auto flex h-svh w-full max-w-md flex-col gap-6 px-4 py-6">
      <header className="flex h-9 shrink-0 items-center justify-between gap-3 [view-transition-name:app-header]">
        <Link
          href={onSignOut ? "/app" : "/"}
          className="flex h-9 items-center text-sm font-semibold tracking-widest uppercase"
        >
          Pippo
        </Link>
        {confirming ? (
          <div className="flex items-center gap-1 text-sm">
            <span className="mr-1 text-muted-foreground">Sign out?</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirming(false)}
            >
              Stay
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                setConfirming(false)
                onSignOut?.()
              }}
            >
              Sign out
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            {account && <CopyAddress account={account} />}
            {onSignOut && (
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => setConfirming(true)}
                aria-label="Sign out"
                title="Sign out"
              >
                <LogOut />
              </Button>
            )}
          </div>
        )}
      </header>
      {children}
    </main>
  )
}

function CopyAddress({ account }: { account: Address }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="flex h-9 items-center gap-1.5 font-mono text-xs text-muted-foreground hover:text-foreground"
      aria-label="Copy wallet address"
      title="Copy wallet address"
      onClick={() =>
        navigator.clipboard.writeText(account).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }
    >
      {shortAddress(account)}
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  )
}
