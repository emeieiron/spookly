import {
  encodeFunctionData,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from "viem"
import { USDC, erc20Abi } from "./chain"

// This feature deliberately cannot inherit a future mainnet configuration.
export const SPONSOR_CHAIN_ID = 10143
export const SPONSOR_CAIP2 = "eip155:10143"
export const SPONSOR_REQUEST_TTL = 5 * 60_000

export type SponsorTransaction = {
  from: Address
  to: Address
  data: Hex
  value: Hex
}

export type SponsorRequest = {
  version: 1
  method: "POST"
  url: string
  headers: {
    "privy-app-id": string
    "privy-idempotency-key": string
    "privy-request-expiry": string
  }
  body: {
    method: "wallet_sendCalls"
    caip2: typeof SPONSOR_CAIP2
    sponsor: true
    params: { calls: { to: Address; data: Hex; value: Hex }[] }
  }
}

// This proof uses the wallet's private key through Privy's normal signing path,
// which enforces enrolled wallet MFA. An access token or user-key signature alone is insufficient.
export function sponsorProofMessage(request: SponsorRequest) {
  return `Spookly sponsorship\nNetwork: Monad testnet (10143)\nRequest: ${request.headers["privy-idempotency-key"]}\nExpires: ${request.headers["privy-request-expiry"]}\nDigest: ${keccak256(stringToHex(JSON.stringify(request)))}`
}

export function sponsorRequest(
  appId: string,
  walletId: string,
  id: string,
  transaction: SponsorTransaction,
  expiresAt: number,
  approval = 0n
): SponsorRequest {
  return {
    version: 1,
    method: "POST",
    url: `https://api.privy.io/v1/wallets/${encodeURIComponent(walletId)}/rpc`,
    headers: {
      "privy-app-id": appId,
      "privy-idempotency-key": id,
      "privy-request-expiry": String(expiresAt),
    },
    body: {
      method: "wallet_sendCalls",
      caip2: SPONSOR_CAIP2,
      sponsor: true,
      params: {
        calls: [
          // Delegated wallets authorize the exact USDC pull through an
          // approval in the same atomic batch as Spook creation.
          ...(approval > 0n
            ? [
                {
                  to: USDC,
                  value: "0x0" as Hex,
                  data: encodeFunctionData({
                    abi: erc20Abi,
                    functionName: "approve",
                    args: [transaction.to, approval],
                  }),
                },
              ]
            : []),
          {
            to: transaction.to,
            data: transaction.data,
            value: transaction.value,
          },
        ],
      },
    },
  }
}
