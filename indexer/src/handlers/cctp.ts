import { indexer } from "envio"
import {
  DOMAIN_BY_CHAIN,
  MONAD_DOMAIN,
  eventId,
  matchKey,
  parseBurnMessage,
  toAddress,
} from "../matching.js"

const MONAD_TOKEN_MESSENGER = "0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa"

// The mint on the payee's network. If its burn was indexed first, that payment is marked delivered here.
indexer.onEvent(
  {
    contract: "MessageTransmitter",
    event: "MessageReceived",
    fields: { transaction: ["hash"], block: ["timestamp"] },
  },
  async ({ event, context }) => {
    // Only USDC burned through CCTP's token messenger on Monad.
    if (Number(event.params.sourceDomain) !== MONAD_DOMAIN) return
    if (toAddress(event.params.sender) !== MONAD_TOKEN_MESSENGER) return
    const burn = parseBurnMessage(event.params.messageBody)
    const domain = DOMAIN_BY_CHAIN[event.chainId]
    if (!burn || domain === undefined) return

    const key = matchKey(burn.sender, domain, burn.recipient, burn.burned)
    const match = await context.CrossChainMatch.get(key)
    const paymentId = match?.burns[0]
    const [payment, stats] = await Promise.all([
      paymentId ? context.Payment.get(paymentId) : undefined,
      paymentId ? context.Stats.get("global") : undefined,
    ])
    const id = eventId(event.chainId, event.transaction.hash, event.logIndex)
    const timestamp = BigInt(event.block.timestamp)

    context.Mint.set({
      id,
      chainId: event.chainId,
      sender: burn.sender,
      recipient: burn.recipient,
      burned: burn.burned,
      feeExecuted: burn.feeExecuted,
      timestamp,
      txHash: event.transaction.hash,
      payment: payment?.id,
    })
    context.CrossChainMatch.set({
      id: key,
      burns: payment ? match!.burns.slice(1) : (match?.burns ?? []),
      mints: payment ? (match?.mints ?? []) : [...(match?.mints ?? []), id],
    })
    if (!payment) return
    context.Payment.set({
      ...payment,
      status: "delivered",
      received: burn.burned - burn.feeExecuted,
      feeExecuted: burn.feeExecuted,
      deliveredAt: timestamp,
      deliveryTxHash: event.transaction.hash,
    })
    if (stats) context.Stats.set({ ...stats, delivered: stats.delivered + 1 })
  }
)
