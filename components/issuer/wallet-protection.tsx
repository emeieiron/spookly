"use client"

import { useMfaEnrollment, usePrivy } from "@privy-io/react-auth"
import { Shield, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"

export function WalletProtection({ disabled }: { disabled: boolean }) {
  const { user } = usePrivy()
  const { showMfaEnrollmentModal } = useMfaEnrollment()
  const protectedWallet = !!user?.mfaMethods?.length
  const label = protectedWallet ? "Manage wallet protection" : "Protect wallet"
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      disabled={disabled}
      aria-label={label}
      title={label}
      onClick={showMfaEnrollmentModal}
    >
      {protectedWallet ? <ShieldCheck className="text-primary" /> : <Shield />}
    </Button>
  )
}
