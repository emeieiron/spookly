import { privateKeyToAccount } from "viem/accounts"
import { readSpookFragment } from "./spook-link"

// Only the fragment is used. A pasted link never navigates to another origin.
export function spenderLinkFragment(text: string, origin: string) {
  try {
    const url = new URL(text.trim())
    if (
      url.origin !== origin ||
      !["https:", "http:"].includes(url.protocol) ||
      url.pathname !== "/spook" ||
      url.search ||
      url.username ||
      url.password
    )
      return null
    const spook = readSpookFragment(url.hash)
    if (!spook) return null
    privateKeyToAccount(spook.key)
    return url.hash
  } catch {
    return null
  }
}
