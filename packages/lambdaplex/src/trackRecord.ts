import { add, cmp, div, toDecimalString } from "./decimal";
import type { Fill, OrderSide } from "./types";

/**
 * A verifiable trading track record on the Hedera Consensus Service. Every settled fill becomes one HCS message on
 * a topic whose submit key belongs to the strategy operator, so:
 *  - entries are ordered and timestamped by consensus and cannot be edited or deleted;
 *  - only the operator can append, so a strategy can't be impersonated;
 *  - each entry points at the Hedera transaction that settled the trade, so anyone can check it really happened.
 */
export type TrackRecordEntry = {
  v: 1;
  strategy: string;
  venue: "lambdaplex";
  symbol: string;
  side: OrderSide;
  orderId: string;
  clientOrderId: string;
  price: string;
  qty: string;
  quoteQty: string;
  commission: string;
  commissionAsset: string;
  time: number;
  /** Hedera transaction id of the settlement, e.g. `0.0.10599377@1790969771.400000000`. */
  settlementTx: string;
};

const HCS_MAX_MESSAGE_BYTES = 1024;

export function entryFromFill(
  strategy: string,
  symbol: string,
  side: OrderSide,
  clientOrderId: string,
  fill: Fill,
): TrackRecordEntry {
  return {
    v: 1,
    strategy,
    venue: "lambdaplex",
    symbol,
    side,
    orderId: fill.orderId,
    clientOrderId,
    price: toDecimalString(fill.price),
    qty: toDecimalString(fill.qty),
    quoteQty: toDecimalString(fill.quoteQty),
    commission: toDecimalString(fill.commission),
    commissionAsset: fill.commissionAsset,
    time: fill.time,
    settlementTx: fill.settlementTransactionId,
  };
}

/** JSON message for HCS. Throws if it would not fit in a single (unchunked) message. */
export function encodeEntry(entry: TrackRecordEntry): string {
  const message = JSON.stringify(entry);
  if (new TextEncoder().encode(message).length > HCS_MAX_MESSAGE_BYTES)
    throw new Error("track record entry exceeds 1 KiB");
  return message;
}

const STRING_FIELDS = [
  "strategy",
  "symbol",
  "orderId",
  "clientOrderId",
  "price",
  "qty",
  "quoteQty",
  "commission",
  "commissionAsset",
  "settlementTx",
] as const;

/** Amount fields must be plain non-negative decimals ("49", "0.101057"): no signs, exponents or blanks. */
const DECIMAL_FIELDS = ["price", "qty", "quoteQty", "commission"] as const;
const PLAIN_DECIMAL = /^\d{1,30}(\.\d{1,18})?$/;

/** Parses a topic message; returns null for anything that is not a well-formed v1 entry. */
export function decodeEntry(message: string): TrackRecordEntry | null {
  let value: unknown;
  try {
    value = JSON.parse(message);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  if (entry.v !== 1 || entry.venue !== "lambdaplex") return null;
  if (entry.side !== "BUY" && entry.side !== "SELL") return null;
  if (typeof entry.time !== "number" || !Number.isFinite(entry.time)) return null;
  if (!STRING_FIELDS.every(field => typeof entry[field] === "string")) return null;
  if (!DECIMAL_FIELDS.every(field => PLAIN_DECIMAL.test(entry[field] as string))) return null;
  return entry as TrackRecordEntry;
}

/** Hedera transaction ids (`0.0.x@seconds.nanos`) as the mirror node REST path expects them (`0.0.x-seconds-nanos`). */
export function mirrorTransactionId(transactionId: string): string {
  const match = /^(\d+\.\d+\.\d+)@(\d+)\.(\d+)$/.exec(transactionId.trim());
  if (!match) throw new Error(`Not a Hedera transaction id: ${transactionId}`);
  return `${match[1]}-${match[2]}-${match[3].padEnd(9, "0")}`;
}

export type TrackRecordSummary = {
  fills: number;
  bought: string;
  sold: string;
  spent: string;
  received: string;
  averageBuyPrice?: string;
  averageSellPrice?: string;
};

export function summarize(entries: TrackRecordEntry[]): TrackRecordSummary {
  const sum = (values: string[]) => values.reduce(add, "0");
  const buys = entries.filter(e => e.side === "BUY");
  const sells = entries.filter(e => e.side === "SELL");
  const bought = sum(buys.map(e => e.qty));
  const spent = sum(buys.map(e => e.quoteQty));
  const sold = sum(sells.map(e => e.qty));
  const received = sum(sells.map(e => e.quoteQty));
  return {
    fills: entries.length,
    bought,
    sold,
    spent,
    received,
    averageBuyPrice: cmp(bought, "0") > 0 ? div(spent, bought) : undefined,
    averageSellPrice: cmp(sold, "0") > 0 ? div(received, sold) : undefined,
  };
}
