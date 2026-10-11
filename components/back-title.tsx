"use client"

import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"

export function BackTitle({
  title,
  onBack,
}: {
  title: string
  onBack: () => void
}) {
  return (
    <Button
      variant="ghost"
      onClick={onBack}
      className="-my-2 -ml-2 h-9 gap-2 self-start px-2 text-lg font-semibold tracking-normal normal-case"
    >
      <ArrowLeft className="size-5" />
      {title}
    </Button>
  )
}
