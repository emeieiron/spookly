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
import {
  forgetSealedKeys,
  isLive,
  readBook,
  readLinks,
  type Book,
  type Links,
} from "@/lib/spook-book"
import {
  createVault,
  forgetVault,
  loadVault,
  passkeysSupported,
  unlockVault,
  type LinkVault,
} from "@/lib/link-vault"
import { FACTORY, USDC, erc20Abi, monad } from "@/lib/chain"
import { errorMessage, publicClient } from "@/lib/spook-payment"
import { shortAddress } from "@/lib/money"
import type { SignerClient, SponsorSender } from "@/lib/wallet-send"
import { creationGasReserve } from "@/lib/funding/requirements"
import { isDelegated } from "@/lib/monad-reserve"
import { WalletProtection } from "./wallet-protection"
import { useSponsorship } from "./use-sponsorship"

export type Wallet = {
  account: Address
  client: SignerClient
  usdc: bigint
  mon: bigint
  gasReserve: bigint
  delegated: boolean
  book: Book | null
  refreshedAt: number
}

type Issuer = {
  wallet: Wallet | null
  sponsor: SponsorSender
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
  // Passkey-derived key that seals spook links on-chain; null until set up or unlocked on this device.
  vault: LinkVault | null
  // Null until this device's passkey support is known.
  passkeys: boolean | null
  links: Links | null
  // False while links are being restored for the current spooks and vault.
  linksReady: boolean
  // Set after an unlock fails, so a lost passkey can be replaced.
  unlockFailed: boolean
  setUpVault: () => Promise<LinkVault | null>
  unlockVault: () => Promise<LinkVault | null>
}

const IssuerContext = createContext<Issuer | null>(null)
export const useIssuer = () => useContext(IssuerContext)!

const walletClientFor = (account: Address, provider: EIP1193Provider) =>
  createWalletClient({
    account,
    chain: monad,
    transport: custom(provider),
  })

export async function fetchWallet(
  account: Address,
  client: SignerClient
): Promise<Wallet> {
  if ((await publicClient.getChainId()) !== monad.id)
    throw new Error("The wallet service is on the wrong network.")
  const [usdc, mon, book, fees, code] = await Promise.all([
    publicClient.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account],
    }),
    publicClient.getBalance({ address: account }),
    FACTORY ? readBook(FACTORY, account) : null,
    publicClient.estimateFeesPerGas(),
    publicClient.getCode({ address: account }),
  ])
  return {
    account,
    client,
    usdc,
    mon,
    book,
    gasReserve: creationGasReserve(fees.maxFeePerGas, !!book),
    delegated: isDelegated(code),
    refreshedAt: Date.now(),
  }
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
  const embedded = active?.walletClientType === "privy"
  const embeddedAccount = user?.linkedAccounts.find(
    (w) =>
      w.type === "wallet" &&
      w.walletClientType === "privy" &&
      w.address.toLowerCase() === active?.address.toLowerCase()
  )
  const sponsor = useSponsorship(
    embeddedAccount?.type === "wallet"
      ? (embeddedAccount.id ?? undefined)
      : undefined
  )
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<Address | null>(null)
  const [vault, setVault] = useState<LinkVault | null>(null)
  // The account whose stored vault has been read, so links aren't judged locked before the vault loads.
  const [vaultFor, setVaultFor] = useState<Address | null>(null)
  const [passkeys, setPasskeys] = useState<boolean | null>(null)
  const [links, setLinks] = useState<
    (Links & { owner: Address; sig: string }) | null
  >(null)
  const [unlockFailed, setUnlockFailed] = useState(false)

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
        await target.switchChain(monad.id)
        const provider = (await target.getEthereumProvider()) as EIP1193Provider
        const account = getAddress(target.address)
        if ((await publicClient.getChainId()) !== monad.id)
          throw new Error("The wallet service is on the wrong network.")
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
      // A refresh failure must not turn a successful transaction into a failed action.
      await load(wallet.account, wallet.client).catch(() => {})
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
    loadVault(vaultOwner).then((v) => {
      if (!live) return
      setVault(v)
      setVaultFor(vaultOwner)
    })
    return () => {
      live = false
    }
  }, [vaultOwner])

  useEffect(() => {
    passkeysSupported().then(setPasskeys)
  }, [])

  // Restores every live link the vault can open whenever the spooks, their seals or the vault change.
  const book = wallet?.book
  const linksSig =
    book && vaultFor === wallet.account
      ? `${vault?.id}|${book.spooks.map((c) => `${c.signer}${c.sealedKey}${isLive(c, wallet.refreshedAt)}`).join()}`
      : ""
  useEffect(() => {
    if (!linksSig || !wallet?.book) return
    const owner = wallet.account
    let live = true
    readLinks(
      wallet.account,
      wallet.book.spooks,
      vault,
      wallet.refreshedAt
    ).then((l) => live && setLinks({ ...l, owner, sig: linksSig }))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the signature covers every input that matters
  }, [linksSig])

  const withVault = async (open: () => Promise<LinkVault>) => {
    setBusy("vault")
    setError(null)
    try {
      const v = await open()
      setVault(v)
      setUnlockFailed(false)
      return v
    } catch (e) {
      setError(errorMessage(e))
      return null
    } finally {
      setBusy(null)
    }
  }
  const setUpVault = () =>
    withVault(() =>
      createVault(
        wallet!.account,
        user?.email?.address ?? user?.google?.email ?? wallet!.account
      )
    )
  // Locked links decide which passkey is wanted; with none locked, any passkey already used by this book will do.
  const unlock = () =>
    withVault(async () => {
      const locked = links?.locked.map((l) => l.id) ?? []
      try {
        return await unlockVault(
          wallet!.account,
          locked.length > 0 ? locked : (links?.ids ?? [])
        )
      } catch (e) {
        setUnlockFailed(true)
        throw e
      }
    })

  const signOut = async () => {
    if (wallet) {
      await forgetVault(wallet.account)
      forgetSealedKeys(wallet.account, wallet.book?.spooks ?? [])
    }
    setVault(null)
    setVaultFor(null)
    setLinks(null)
    setUnlockFailed(false)
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
        sponsor,
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
        passkeys,
        // Stale links stay visible while new ones restore, but never another account's.
        links: links?.owner === wallet?.account ? links : null,
        linksReady: !!linksSig && links?.sig === linksSig,
        unlockFailed,
        setUpVault,
        unlockVault: unlock,
      }}
    >
      <AppFrame
        account={connected ? wallet.account : undefined}
        onSignOut={signedIn ? signOut : undefined}
        protection={
          signedIn && embedded ? (
            <WalletProtection disabled={!!busy || !connected} />
          ) : undefined
        }
      >
        {!ready ? null : !authenticated ? (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <h1 className="text-3xl font-semibold tracking-tight">
                Spendable links
              </h1>
              <p className="text-sm text-muted-foreground">
                Create USDC Spooks anyone can spend straight from a link.
              </p>
            </div>
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
  protection,
}: {
  children?: React.ReactNode
  account?: Address
  onSignOut?: () => void
  protection?: React.ReactNode
}) {
  const [confirming, setConfirming] = useState(false)
  return (
    <main className="mx-auto flex h-svh w-full max-w-md flex-col gap-6 px-4 py-6">
      <header className="flex h-9 shrink-0 items-center justify-between gap-3 [view-transition-name:app-header]">
        <Link
          href={onSignOut ? "/app" : "/"}
          className="flex h-9 items-center text-sm font-semibold tracking-widest uppercase"
        >
          Spookly
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
            {protection}
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
    <Button
      variant="ghost"
      size="sm"
      className="px-2 font-mono tracking-normal text-muted-foreground normal-case"
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
      {copied ? <Check /> : <Copy />}
    </Button>
  )
}
