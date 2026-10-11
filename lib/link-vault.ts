import {
  createPasskeyWithPrfOutput,
  getPasskeyPrfOutput,
  isMeraError,
} from "@category-labs/mera"
import { bytesToHex, hexToBytes, type Address, type Hex } from "viem"

// "One passkey, many keys": a Pippo-specific PRF salt gives one 32-byte output per passkey, identical on every
// device the passkey syncs to. HKDF splits it into keys that never sign anything: an AES-GCM key that seals
// cheque links, and an id that tells a matching passkey from a different one.
const NAMESPACE = "pippo.v1.cheque-links"
const VERSION = 1
const AAD = new TextEncoder().encode(NAMESPACE)

export type LinkVault = { key: CryptoKey; id: Hex }

const prfSalt = async () =>
  new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(NAMESPACE))
  )

export async function deriveVault(prfOutput: Uint8Array): Promise<LinkVault> {
  const material = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(prfOutput),
    "HKDF",
    false,
    ["deriveKey", "deriveBits"]
  )
  const params = (info: string): HkdfParams => ({
    name: "HKDF",
    hash: "SHA-256",
    salt: new Uint8Array(0),
    info: new TextEncoder().encode(`${NAMESPACE}.${info}`),
  })
  const key = await crypto.subtle.deriveKey(
    params("seal"),
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  )
  const id = bytesToHex(
    new Uint8Array(await crypto.subtle.deriveBits(params("id"), material, 64))
  )
  prfOutput.fill(0)
  return { key, id }
}

// Sealed layout: version (1) | key id (8) | nonce (12) | AES-GCM ciphertext of the 32-byte cheque key (48).
export async function sealChequeKey(
  vault: LinkVault,
  chequeKey: Hex
): Promise<Hex> {
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: AAD },
      vault.key,
      new Uint8Array(hexToBytes(chequeKey))
    )
  )
  return bytesToHex(
    new Uint8Array([VERSION, ...hexToBytes(vault.id), ...nonce, ...ciphertext])
  )
}

export const sealedKeyId = (sealed: Hex): Hex | null => {
  const bytes = hexToBytes(sealed)
  return bytes.length > 9 && bytes[0] === VERSION
    ? bytesToHex(bytes.slice(1, 9))
    : null
}

export async function openChequeKey(
  vault: LinkVault,
  sealed: Hex
): Promise<Hex | null> {
  const bytes = hexToBytes(sealed)
  if (sealedKeyId(sealed) !== vault.id) return null
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(9, 21), additionalData: AAD },
      vault.key,
      bytes.slice(21)
    )
    return bytesToHex(new Uint8Array(plain))
  } catch {
    return null
  }
}

// The derived key is kept per device as a non-extractable CryptoKey, so sealing a new cheque needs no prompt.
const DB = "pippo"
const STORE = "link-vault"
const db = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
const tx = async <T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
) => {
  const store = (await db()).transaction(STORE, mode).objectStore(STORE)
  return new Promise<T>((resolve, reject) => {
    const request = run(store)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function loadVault(owner: Address): Promise<LinkVault | null> {
  try {
    return (
      ((await tx("readonly", (s) => s.get(owner))) as LinkVault | undefined) ??
      null
    )
  } catch {
    return null
  }
}
const saveVault = (owner: Address, vault: LinkVault) =>
  tx("readwrite", (s) => s.put(vault, owner))

const friendly = (e: unknown) => {
  if (isMeraError(e) && e.code === "PRF_UNAVAILABLE")
    return new Error(
      "This browser's passkeys can't protect links yet. Try Chrome or Safari with a synced passkey."
    )
  if (isMeraError(e) && e.code === "PASSKEY_OPERATION_FAILED")
    return new Error("Passkey request was cancelled.")
  return e instanceof Error ? e : new Error("Passkey request failed.")
}

export async function createVault(
  owner: Address,
  label: string
): Promise<LinkVault> {
  try {
    const { prfOutput } = await createPasskeyWithPrfOutput({
      rp: { id: location.hostname, name: "Pippo" },
      user: { name: label, displayName: "Pippo cheque links" },
      prfSalt: await prfSalt(),
    })
    const vault = await deriveVault(prfOutput)
    await saveVault(owner, vault)
    return vault
  } catch (e) {
    throw friendly(e)
  }
}

// `expectedId` comes from an existing sealed link: a different passkey derives a different id and is refused.
export async function unlockVault(
  owner: Address,
  expectedId: Hex | null
): Promise<LinkVault> {
  let vault: LinkVault
  try {
    const { prfOutput } = await getPasskeyPrfOutput({
      rpId: location.hostname,
      prfSalt: await prfSalt(),
    })
    vault = await deriveVault(prfOutput)
  } catch (e) {
    throw friendly(e)
  }
  if (expectedId && vault.id !== expectedId)
    throw new Error(
      "That passkey didn't lock these links. Choose the passkey you used to write them."
    )
  await saveVault(owner, vault)
  return vault
}
