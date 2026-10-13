import { indexer } from "envio"
import {
  CHAIN_BY_DOMAIN,
  STATS_ID,
  MONAD_CHAIN,
  MONAD_DOMAIN,
  eventId,
  matchKey,
  toAddress,
} from "../matching.js"

const STATS = {
  id: STATS_ID,
  books: 0,
  spooks: 0,
  created: 0n,
  payments: 0,
  paidOut: 0n,
  crossChainPayments: 0,
  delivered: 0,
}
const fields = {
  transaction: ["hash"],
  block: ["timestamp"],
} as const

indexer.contractRegister(
  { contract: "SpookBookFactory", event: "BookCreated" },
  async ({ event, context }) => {
    context.chain.SpookBook.add(event.params.book)
  }
)

indexer.onEvent(
  { contract: "SpookBookFactory", event: "BookCreated", fields },
  async ({ event, context }) => {
    const stats = await context.Stats.getOrCreate(STATS)
    context.Book.set({
      id: event.params.book,
      owner: event.params.owner,
      createdAt: BigInt(event.block.timestamp),
      txHash: event.transaction.hash,
    })
    context.Stats.set({ ...stats, books: stats.books + 1 })
  }
)

indexer.onEvent(
  { contract: "SpookBook", event: "SpookCreated", fields },
  async ({ event, context }) => {
    const stats = await context.Stats.getOrCreate(STATS)
    context.Spook.set({
      id: event.params.signer,
      book_id: event.srcAddress,
      amount: event.params.amount,
      expiry: event.params.expiry,
      gasBudget: event.params.gasBudget,
      createdAt: BigInt(event.block.timestamp),
      creationTx: event.transaction.hash,
      spent: 0n,
      paymentCount: 0,
      cancelledAt: undefined,
      refunded: undefined,
    })
    context.Stats.set({
      ...stats,
      spooks: stats.spooks + 1,
      created: stats.created + event.params.amount,
    })
  }
)

indexer.onEvent(
  { contract: "SpookBook", event: "SpookCancelled", fields },
  async ({ event, context }) => {
    const spook = await context.Spook.getOrThrow(event.params.signer)
    context.Spook.set({
      ...spook,
      cancelledAt: BigInt(event.block.timestamp),
      refunded: event.params.released,
    })
  }
)

indexer.onEvent(
  { contract: "SpookBook", event: "Paid", fields },
  async ({ event, context }) => {
    const [spook, stats] = await Promise.all([
      context.Spook.getOrThrow(event.params.signer),
      context.Stats.getOrCreate(STATS),
    ])
    const timestamp = BigInt(event.block.timestamp)
    context.Payment.set({
      id: eventId(event.chainId, event.transaction.hash, event.logIndex),
      spook_id: spook.id,
      book: event.srcAddress,
      recipient: event.params.recipient,
      chainId: MONAD_CHAIN,
      domain: MONAD_DOMAIN,
      amount: event.params.amount,
      maxFee: 0n,
      status: "delivered",
      timestamp,
      txHash: event.transaction.hash,
      received: event.params.amount,
      feeExecuted: 0n,
      deliveredAt: timestamp,
      deliveryTxHash: event.transaction.hash,
    })
    context.Spook.set({
      ...spook,
      spent: spook.spent + event.params.amount,
      paymentCount: spook.paymentCount + 1,
    })
    context.Stats.set({
      ...stats,
      payments: stats.payments + 1,
      paidOut: stats.paidOut + event.params.amount,
    })
  }
)

// The burn on Monad. If its mint was indexed first, the payment is delivered on arrival.
indexer.onEvent(
  { contract: "SpookBook", event: "PaidCrossChain", fields },
  async ({ event, context }) => {
    const domain = Number(event.params.domain)
    const recipient = toAddress(event.params.recipient)
    const burned = event.params.amount
    const key = matchKey(event.srcAddress, domain, recipient, burned)
    const [spook, stats, match] = await Promise.all([
      context.Spook.getOrThrow(event.params.signer),
      context.Stats.getOrCreate(STATS),
      context.CrossChainMatch.get(key),
    ])
    const mint = match?.mints[0]
      ? await context.Mint.get(match.mints[0])
      : undefined
    const id = eventId(event.chainId, event.transaction.hash, event.logIndex)

    context.Payment.set({
      id,
      spook_id: spook.id,
      book: event.srcAddress,
      recipient,
      chainId: CHAIN_BY_DOMAIN[domain] ?? 0,
      domain,
      amount: burned - event.params.maxFee,
      maxFee: event.params.maxFee,
      status: mint ? "delivered" : "in_transit",
      timestamp: BigInt(event.block.timestamp),
      txHash: event.transaction.hash,
      received: mint ? burned - mint.feeExecuted : undefined,
      feeExecuted: mint?.feeExecuted,
      deliveredAt: mint?.timestamp,
      deliveryTxHash: mint?.txHash,
    })
    if (mint) context.Mint.set({ ...mint, payment: id })
    context.CrossChainMatch.set({
      id: key,
      burns: mint ? (match?.burns ?? []) : [...(match?.burns ?? []), id],
      mints: mint ? match!.mints.slice(1) : (match?.mints ?? []),
    })
    context.Spook.set({
      ...spook,
      spent: spook.spent + burned,
      paymentCount: spook.paymentCount + 1,
    })
    context.Stats.set({
      ...stats,
      payments: stats.payments + 1,
      paidOut: stats.paidOut + burned - event.params.maxFee,
      crossChainPayments: stats.crossChainPayments + 1,
      delivered: stats.delivered + (mint ? 1 : 0),
    })
  }
)
