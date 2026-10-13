import { PrivyClient, isEmbeddedWalletLinkedAccount } from "@privy-io/node"

let instance: PrivyClient | undefined
export function serverPrivy() {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID
  const appSecret = process.env.PRIVY_APP_SECRET
  if (!appId || !appSecret)
    throw new Error("Wallet sponsorship is unavailable.")
  return (instance ??= new PrivyClient({
    appId,
    appSecret,
    maxRetries: 0,
    timeout: 10_000,
  }))
}

export async function authenticatedSponsorUser(request: Request) {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer (\S+)$/)?.[1]
  if (!token) throw new Error("Please sign in again.")
  const privy = serverPrivy()
  const claims = await privy.utils().auth().verifyAccessToken(token)
  const user = await privy.users()._get(claims.user_id)
  return {
    user,
    wallets: user.linked_accounts.filter(isEmbeddedWalletLinkedAccount),
  }
}
