"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { NETWORKS } from "@/lib/networks"
import { ChainName } from "@/components/chain-name"

const items = NETWORKS.map((n) => ({ value: n.chainId, label: n.name }))

export function NetworkSelect({
  id,
  value,
  onChange,
  placeholder,
}: {
  id: string
  value: number | undefined
  onChange: (chainId: number) => void
  placeholder?: string
}) {
  return (
    <Select
      items={items}
      value={value ?? null}
      onValueChange={(v) => v !== null && onChange(v)}
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={placeholder}>
          {(chainId) =>
            chainId ? (
              <ChainName chain={chainId} />
            ) : (
              (placeholder ?? "Choose chain")
            )
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {items.map((n) => (
          <SelectItem key={n.value} value={n.value}>
            <ChainName chain={n.value} label={n.label} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
