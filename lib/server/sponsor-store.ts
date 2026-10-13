import { createHash } from "node:crypto"
import { type SponsorRequest } from "../sponsorship"

export type SponsorRecord = {
  userId: string
  walletId: string
  walletAddress: string
  request: SponsorRequest
  expiresAt: number
  transactionId?: string
  retryOf: string | null
}

// Reserve every limit and store the exact signed request in one atomic operation.
// Never refund an uncertain submission: an RPC timeout may follow a successful broadcast.
export const RESERVE_SPONSOR = `
if redis.call('EXISTS', KEYS[4]) == 1 then return 0 end
for i = 1, 3 do
  if tonumber(redis.call('GET', KEYS[i]) or '0') >= tonumber(ARGV[i]) then return 0 end
end
for i = 1, 3 do
  redis.call('INCR', KEYS[i])
  redis.call('EXPIRE', KEYS[i], 172800)
end
redis.call('SET', KEYS[4], ARGV[4], 'EX', 172800)
return 1
`

export function sponsorStoreConfigured() {
  return !!(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  )
}

export async function redisCommand<T>(
  command: (string | number)[]
): Promise<T> {
  const url = process.env.UPSTASH_REDIS_REST_URL!
  if (!url.startsWith("https://"))
    throw new Error("Sponsorship storage requires HTTPS.")
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  })
  const data = await response.json()
  if (!response.ok || data.error)
    throw new Error("Sponsorship storage is unavailable.")
  return data.result as T
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex")
const prefix = () =>
  `spookly:sponsor:10143:${process.env.NEXT_PUBLIC_PRIVY_APP_ID}`
export const sponsorRecordKey = (id: string) => `${prefix()}:request:${id}`

export function sponsorReservationKeys(
  id: string,
  userId: string,
  wallet: string,
  now = new Date()
) {
  const daily = `${prefix()}:${now.toISOString().slice(0, 10)}`
  return [
    `${daily}:wallet:${hash(wallet.toLowerCase())}`,
    `${daily}:user:${hash(userId)}`,
    `${daily}:app`,
    sponsorRecordKey(id),
  ]
}

export async function reserveSponsor(
  id: string,
  record: SponsorRecord,
  limits: { wallet: number; user: number; app: number }
) {
  return (
    (await redisCommand<number>([
      "EVAL",
      RESERVE_SPONSOR,
      4,
      ...sponsorReservationKeys(id, record.userId, record.walletAddress),
      limits.wallet,
      limits.user,
      limits.app,
      JSON.stringify(record),
    ])) === 1
  )
}

export async function readSponsor(id: string): Promise<SponsorRecord | null> {
  if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id))
    throw new Error("Invalid request.")
  const value = await redisCommand<string | null>(["GET", sponsorRecordKey(id)])
  if (!value) return null
  const record = JSON.parse(value) as SponsorRecord
  if (record.retryOf !== null && typeof record.retryOf !== "string")
    throw new Error("Invalid sponsorship record.")
  return record
}

export async function saveSponsor(id: string, record: SponsorRecord) {
  await redisCommand([
    "SET",
    sponsorRecordKey(id),
    JSON.stringify(record),
    "KEEPTTL",
  ])
}
