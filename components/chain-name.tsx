import Image from "next/image"
import { Network } from "lucide-react"
import { cn } from "cn"
import { chainMetadata } from "@/lib/chain-catalog"

export function ChainName({
  chain,
  label,
  className,
}: {
  chain: string | number
  label?: string
  className?: string
}) {
  const metadata = chainMetadata(chain)
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 align-middle whitespace-nowrap",
        className
      )}
    >
      {metadata.icon ? (
        <Image
          src={metadata.icon}
          alt=""
          aria-hidden="true"
          width={20}
          height={20}
          className="size-5 shrink-0 rounded-full object-contain"
        />
      ) : (
        <Network
          aria-hidden="true"
          className="size-5 shrink-0 text-muted-foreground"
        />
      )}
      <span>{label ?? metadata.name}</span>
    </span>
  )
}
