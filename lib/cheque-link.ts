import {
  bytesToHex,
  getAddress,
  hexToBytes,
  isAddress,
  type Address,
  type Hex,
} from "viem"

const encode = (hex: Hex) =>
  btoa(String.fromCharCode(...hexToBytes(hex)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
const decode = (text: string) =>
  bytesToHex(
    Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
      c.charCodeAt(0)
    )
  )

// The key lives in the URL fragment, which browsers never send to the server.
export const chequeLink = (origin: string, book: Address, key: Hex) =>
  `${origin}/c#${encode(book)}.${encode(key)}`

export function readChequeFragment(
  fragment: string
): { book: Address; key: Hex } | null {
  try {
    const [book, key] = fragment.replace(/^#/, "").split(".")
    const bookHex = decode(book)
    const keyHex = decode(key)
    if (!isAddress(bookHex) || keyHex.length !== 66) return null
    return { book: getAddress(bookHex), key: keyHex }
  } catch {
    return null
  }
}
