import {
  createPasskeyWithPrfOutput,
  getPasskeyPrfOutput,
  isMeraError,
} from "@category-labs/mera"
import { bytesToHex, hexToBytes, isHex, type Address, type Hex } from "viem"
import { privateKeyToAddress } from "viem/accounts"

// "One passkey, many keys": a Spookly-specific PRF salt gives one 32-byte output per passkey, identical on every
// device the passkey syncs to. HKDF splits it into keys that never sign anything: an AES-GCM key that seals
// spook links, and an id that tells a matching passkey from a different one.
const NAMESPACE = "spookly.v1.spook-links"
const VERSION = 1
const AAD = new TextEncoder().encode(NAMESPACE)
const SEALED_LENGTH = 1 + 8 + 12 + 32 + 16

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

// Sealed layout: version (1) | key id (8) | nonce (12) | AES-GCM ciphertext of the 32-byte spook key (48).
// The seal is opened again before it is returned, so a broken one never reaches the chain.
export async function sealSpookKey(
  vault: LinkVault,
  spookKey: Hex
): Promise<Hex> {
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: AAD },
      vault.key,
      new Uint8Array(hexToBytes(spookKey))
    )
  )
  const sealed = bytesToHex(
    new Uint8Array([VERSION, ...hexToBytes(vault.id), ...nonce, ...ciphertext])
  )
  const signer = privateKeyToAddress(spookKey)
  if ((await openSpookKey(vault, sealed, signer)) !== spookKey)
    throw new Error("Couldn't back up this link. Try again.")
  return sealed
}

export const sealedKeyId = (sealed: Hex): Hex | null => {
  if (!isHex(sealed) || (sealed.length - 2) / 2 !== SEALED_LENGTH) return null
  const bytes = hexToBytes(sealed)
  return bytes[0] === VERSION ? bytesToHex(bytes.slice(1, 9)) : null
}

// Resolves to the spook key only when it decrypts and controls `signer`, so a damaged or misplaced seal reads as null.
export async function openSpookKey(
  vault: LinkVault,
  sealed: Hex,
  signer: Address
): Promise<Hex | null> {
  if (sealedKeyId(sealed) !== vault.id) return null
  const bytes = hexToBytes(sealed)
  try {
    const key = bytesToHex(
      new Uint8Array(
        await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: bytes.slice(9, 21), additionalData: AAD },
          vault.key,
          bytes.slice(21)
        )
      )
    )
    return privateKeyToAddress(key) === signer ? key : null
  } catch {
    return null
  }
}

// The derived key is kept per device as a non-extractable CryptoKey, so sealing a new spook needs no prompt.
const DB = "spookly"
const STORE = "link-vault"
let opening: Promise<IDBDatabase> | null = null
const db = () =>
  (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => {
      // Let a newer tab upgrade the database instead of blocking on this connection.
      request.result.onversionchange = () => {
        request.result.close()
        opening = null
      }
      resolve(request.result)
    }
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error("Vault storage is busy"))
  }).catch((e) => {
    opening = null
    throw e
  }))
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

const isVault = (v: unknown): v is LinkVault =>
  typeof v === "object" &&
  v !== null &&
  "key" in v &&
  "id" in v &&
  v.key instanceof CryptoKey &&
  v.key.algorithm.name === "AES-GCM" &&
  typeof v.id === "string" &&
  /^0x[0-9a-f]{16}$/.test(v.id)

export async function loadVault(owner: Address): Promise<LinkVault | null> {
  try {
    const stored = await tx("readonly", (s) => s.get(owner))
    if (stored === undefined || isVault(stored)) return stored ?? null
    await forgetVault(owner)
    return null
  } catch {
    return null
  }
}

// A failed save only costs a prompt on the next visit; the vault still works for this session.
const saveVault = (owner: Address, vault: LinkVault) =>
  tx("readwrite", (s) => s.put(vault, owner)).catch(() => {})

export const forgetVault = (owner: Address) =>
  tx("readwrite", (s) => s.delete(owner)).catch(() => {})

// Creating a passkey on an authenticator without PRF would leave an unusable passkey behind, so check first.
export async function passkeysSupported(): Promise<boolean> {
  if (typeof PublicKeyCredential === "undefined" || !window.isSecureContext)
    return false
  try {
    const capabilities = await PublicKeyCredential.getClientCapabilities?.()
    return capabilities?.["extension:prf"] !== false
  } catch {
    return true
  }
}

const friendly = (e: unknown) => {
  if (isMeraError(e) && e.code === "PRF_UNAVAILABLE")
    return new Error(
      "This passkey can't protect links. Try Chrome or Safari with a synced passkey."
    )
  if (isMeraError(e) && e.code === "PASSKEY_OPERATION_FAILED") {
    const cause = e.cause instanceof DOMException ? e.cause.name : null
    if (cause === "NotAllowedError")
      return new Error("Passkey request was cancelled or timed out.")
    if (cause === "SecurityError")
      return new Error("Passkeys don't work on this address.")
    if (!globalThis.navigator?.credentials)
      return new Error("This browser doesn't support passkeys.")
    return new Error("Passkey request failed. Try again.")
  }
  return e instanceof Error ? e : new Error("Passkey request failed.")
}

export async function createVault(
  owner: Address,
  label: string
): Promise<LinkVault> {
  let vault: LinkVault
  try {
    const { prfOutput } = await createPasskeyWithPrfOutput({
      rp: { id: location.hostname, name: "Spookly" },
      // The date tells passkeys apart in the browser's picker if a lost one is ever replaced.
      user: {
        name: `${label} · ${new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`,
        displayName: "Spookly spook links",
      },
      prfSalt: await prfSalt(),
    })
    vault = await deriveVault(prfOutput)
  } catch (e) {
    throw friendly(e)
  }
  await saveVault(owner, vault)
  return vault
}

// `knownIds` are the ids sealed into the spook book. Any of them is accepted, since each spook opens only with
// the passkey that sealed it; a passkey matching none of them belongs to someone or something else.
export async function unlockVault(
  owner: Address,
  knownIds: Hex[]
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
  if (knownIds.length > 0 && !knownIds.includes(vault.id))
    throw new Error(
      "That passkey didn't lock these links. Choose the passkey you used to create them."
    )
  await saveVault(owner, vault)
  return vault
}
