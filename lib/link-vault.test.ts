import assert from "node:assert/strict"
import { beforeEach, describe, test } from "node:test"
import { hexToBytes, bytesToHex, type Hex } from "viem"
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts"
import {
  forgetSealedKeys,
  keyStorage,
  readLinks,
  storedKey,
  type Spook,
} from "./spook-book"
import {
  deriveVault,
  openSpookKey,
  sealSpookKey,
  sealedKeyId,
} from "./link-vault"

const prf = (fill: number) => new Uint8Array(32).fill(fill)
const owner = privateKeyToAddress(generatePrivateKey())
const now = Date.now()

const flip = (sealed: Hex, index: number) => {
  const bytes = hexToBytes(sealed)
  bytes[index] ^= 1
  return bytesToHex(bytes)
}

const spook = (key: Hex, sealedKey: Hex = "0x", live = true): Spook => ({
  signer: privateKeyToAddress(key),
  amount: 1_000_000n,
  remaining: 1_000_000n,
  expiry: Math.floor(now / 1000) + (live ? 86400 : -60),
  active: true,
  gasLeft: 0n,
  sealedKey,
})

describe("passkey vault", () => {
  test("one passkey derives the same vault on every device", async () => {
    const [a, b, other] = await Promise.all([
      deriveVault(prf(7)),
      deriveVault(prf(7)),
      deriveVault(prf(8)),
    ])
    assert.equal(a.id, b.id)
    assert.notEqual(a.id, other.id)
    const key = generatePrivateKey()
    const sealed = await sealSpookKey(a, key)
    assert.equal(await openSpookKey(b, sealed, privateKeyToAddress(key)), key)
  })

  test("the PRF output is wiped after use", async () => {
    const output = prf(9)
    await deriveVault(output)
    assert.ok(output.every((byte) => byte === 0))
  })

  test("a seal fits the contract's 128-byte limit and carries the vault id", async () => {
    const vault = await deriveVault(prf(1))
    const sealed = await sealSpookKey(vault, generatePrivateKey())
    assert.equal(hexToBytes(sealed).length, 69)
    assert.equal(sealedKeyId(sealed), vault.id)
  })

  test("sealing the same key twice gives different ciphertexts", async () => {
    const vault = await deriveVault(prf(1))
    const key = generatePrivateKey()
    assert.notEqual(
      await sealSpookKey(vault, key),
      await sealSpookKey(vault, key)
    )
  })

  test("a different passkey cannot open a seal", async () => {
    const [mine, theirs] = await Promise.all([
      deriveVault(prf(1)),
      deriveVault(prf(2)),
    ])
    const key = generatePrivateKey()
    const sealed = await sealSpookKey(mine, key)
    assert.equal(
      await openSpookKey(theirs, sealed, privateKeyToAddress(key)),
      null
    )
    // Even with the id rewritten to match, the ciphertext doesn't authenticate.
    const relabelled = bytesToHex(
      new Uint8Array([
        1,
        ...hexToBytes(theirs.id),
        ...hexToBytes(sealed).slice(9),
      ])
    )
    assert.equal(
      await openSpookKey(theirs, relabelled, privateKeyToAddress(key)),
      null
    )
  })

  test("tampering with the nonce or ciphertext is detected", async () => {
    const vault = await deriveVault(prf(1))
    const key = generatePrivateKey()
    const signer = privateKeyToAddress(key)
    const sealed = await sealSpookKey(vault, key)
    for (const index of [9, 20, 21, 52, 68])
      assert.equal(await openSpookKey(vault, flip(sealed, index), signer), null)
  })

  test("a seal only opens for the spook it belongs to", async () => {
    const vault = await deriveVault(prf(1))
    const sealed = await sealSpookKey(vault, generatePrivateKey())
    const elsewhere = privateKeyToAddress(generatePrivateKey())
    assert.equal(await openSpookKey(vault, sealed, elsewhere), null)
  })

  test("unknown or malformed seals have no id", async () => {
    const vault = await deriveVault(prf(1))
    const sealed = await sealSpookKey(vault, generatePrivateKey())
    assert.equal(sealedKeyId("0x"), null)
    assert.equal(sealedKeyId(`0x${"ab".repeat(9)}`), null)
    assert.equal(sealedKeyId(`${sealed}00`), null)
    assert.equal(sealedKeyId(flip(sealed, 0)), null)
  })
})

describe("link restore", () => {
  const storage = new Map<string, string>()
  beforeEach(() => {
    storage.clear()
    globalThis.localStorage = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    } as Storage
  })

  test("every live link the vault sealed comes back in one pass and is kept", async () => {
    const vault = await deriveVault(prf(1))
    const keys = [generatePrivateKey(), generatePrivateKey()]
    const spooks = await Promise.all(
      keys.map(async (k) => spook(k, await sealSpookKey(vault, k)))
    )
    const links = await readLinks(owner, spooks, vault, now)
    assert.deepEqual(
      spooks.map((c) => links.keys[c.signer]),
      keys
    )
    assert.deepEqual(links.locked, [])
    assert.deepEqual(links.ids, [vault.id])
    for (const [i, c] of spooks.entries())
      assert.equal(storedKey(owner, c.signer), keys[i])
  })

  test("without the vault, sealed links are locked and unsealed ones are missing", async () => {
    const vault = await deriveVault(prf(1))
    const sealedKey = generatePrivateKey()
    const sealed = spook(sealedKey, await sealSpookKey(vault, sealedKey))
    const unsealed = spook(generatePrivateKey())
    const links = await readLinks(owner, [sealed, unsealed], null, now)
    assert.deepEqual(links.keys, {})
    assert.deepEqual(links.locked, [{ signer: sealed.signer, id: vault.id }])
  })

  test("links sealed by another passkey stay locked, the rest open", async () => {
    const [current, old] = await Promise.all([
      deriveVault(prf(1)),
      deriveVault(prf(2)),
    ])
    const [a, b] = [generatePrivateKey(), generatePrivateKey()]
    const mine = spook(a, await sealSpookKey(current, a))
    const older = spook(b, await sealSpookKey(old, b))
    const links = await readLinks(owner, [mine, older], current, now)
    assert.equal(links.keys[mine.signer], a)
    assert.deepEqual(links.locked, [{ signer: older.signer, id: old.id }])
    assert.deepEqual(links.ids.sort(), [current.id, old.id].sort())
  })

  test("a corrupted local key is ignored and replaced from the seal", async () => {
    const vault = await deriveVault(prf(1))
    const key = generatePrivateKey()
    const c = spook(key, await sealSpookKey(vault, key))
    storage.set(keyStorage(owner, c.signer), generatePrivateKey())
    assert.equal(storedKey(owner, c.signer), null)
    storage.set(keyStorage(owner, c.signer), "not a key")
    assert.equal(storedKey(owner, c.signer), null)
    const links = await readLinks(owner, [c], vault, now)
    assert.equal(links.keys[c.signer], key)
    assert.equal(storedKey(owner, c.signer), key)
  })

  test("closed spooks are neither restored nor locked, but their passkey is known", async () => {
    const vault = await deriveVault(prf(1))
    const key = generatePrivateKey()
    const expired = spook(key, await sealSpookKey(vault, key), false)
    const links = await readLinks(owner, [expired], null, now)
    assert.deepEqual(links, { keys: {}, locked: [], ids: [vault.id] })
  })

  test("signing out forgets only keys that a passkey can bring back", async () => {
    const vault = await deriveVault(prf(1))
    const [a, b] = [generatePrivateKey(), generatePrivateKey()]
    const sealed = spook(a, await sealSpookKey(vault, a))
    const unsealed = spook(b)
    storage.set(keyStorage(owner, sealed.signer), a)
    storage.set(keyStorage(owner, unsealed.signer), b)
    forgetSealedKeys(owner, [sealed, unsealed])
    assert.equal(storedKey(owner, sealed.signer), null)
    assert.equal(storedKey(owner, unsealed.signer), b)
  })
})
