import Image from "next/image"
import { Coins } from "lucide-react"
import { assetIcon } from "@/lib/asset-catalog"

export function AssetName({ symbol }: { symbol: string }) {
  const icon = assetIcon(symbol)
  return (
    <span className="inline-flex items-center gap-1.5 align-middle whitespace-nowrap">
      {icon ? (
        <Image
          src={icon}
          alt=""
          aria-hidden="true"
          width={20}
          height={20}
          className="size-5 shrink-0 rounded-full object-contain"
        />
      ) : (
        <Coins
          aria-hidden="true"
          className="size-5 shrink-0 text-muted-foreground"
        />
      )}
      <span>{symbol}</span>
    </span>
  )
}
