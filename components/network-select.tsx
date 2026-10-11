"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { NETWORKS } from "@/lib/networks"

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
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {items.map((n) => (
          <SelectItem key={n.value} value={n.value}>
            {n.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
