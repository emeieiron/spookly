"use client"

import { useMemo } from "react"
import { getAccessToken, useAuthorizationSignature } from "@privy-io/react-auth"
import { createSponsorSender } from "@/lib/sponsor-client"

export function useSponsorship(walletId: string | undefined) {
  const { generateAuthorizationSignature } = useAuthorizationSignature()
  return useMemo(
    () =>
      createSponsorSender({
        walletId,
        getAccessToken,
        generateAuthorizationSignature,
      }),
    [walletId, generateAuthorizationSignature]
  )
}
