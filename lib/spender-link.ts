import { privateKeyToAccount } from "viem/accounts"
import { readChequeFragment } from "./cheque-link"

// Only the fragment is used. A pasted link never navigates to another origin.
export function spenderLinkFragment(text: string, origin: string) {
  try {
    const url = new URL(text.trim())
    if (
      url.origin !== origin ||
      !["https:", "http:"].includes(url.protocol) ||
      url.pathname !== "/c" ||
      url.search ||
      url.username ||
      url.password
    )
      return null
    const cheque = readChequeFragment(url.hash)
    if (!cheque) return null
    privateKeyToAccount(cheque.key)
    return url.hash
  } catch {
    return null
  }
}
