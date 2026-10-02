import type { LambdaplexClient } from "./client";
import { add, applyBps, ceilTo, cmp, div, floorTo, fromUnits, mul, sub, toUnits } from "./decimal";
import { type MarketRules, marketRules } from "./filters";
import type { Fill, OrderBook, OrderSide } from "./types";

/**
 * TWAP: split a large order into equal slices placed at a fixed interval, so it trades near the time-weighted
 * average price instead of moving a thin book. Each slice is an IOC limit order capped at `maxSlippageBps` from the
 * best opposite price; whatever a slice cannot fill rolls into the next one.
 */
export type TwapConfig = {
  symbol: string;
  side: OrderSide;
  /** BUY: quote asset to spend (e.g. USDC). SELL: base asset to sell (e.g. HBAR). */
  total: string;
  slices: number;
  intervalSeconds: number;
  maxSlippageBps: number;
};

export type SlicePlan =
  | { kind: "order"; price: string; quantity: string; notional: string }
  | { kind: "skip"; reason: string };

/** Equal slices; the last one absorbs rounding so the slices sum exactly to `total`. */
export function planSlices(total: string, slices: number): string[] {
  if (!Number.isInteger(slices) || slices < 1) throw new Error("slices must be a positive integer");
  const totalUnits = toUnits(total);
  const each = totalUnits / BigInt(slices);
  return Array.from({ length: slices }, (_, i) =>
    fromUnits(i === slices - 1 ? totalUnits - each * BigInt(slices - 1) : each),
  );
}

/** Best price on the side this order would take liquidity from. */
export function referencePrice(book: OrderBook, side: OrderSide): string | undefined {
  const level = side === "BUY" ? book.asks[0] : book.bids[0];
  return level?.[0];
}

/** Limit price for a slice: reference ± slippage, rounded so it never exceeds the cap. */
export function slicePrice(reference: string, side: OrderSide, maxSlippageBps: number, tickSize: string): string {
  return side === "BUY"
    ? floorTo(applyBps(reference, maxSlippageBps), tickSize)
    : ceilTo(applyBps(reference, -maxSlippageBps), tickSize);
}

/** Turns a slice amount into an exchange-valid IOC order, or explains why it must roll over. */
export function planSlice(rules: MarketRules, config: TwapConfig, amount: string, reference: string): SlicePlan {
  const price = slicePrice(reference, config.side, config.maxSlippageBps, rules.tickSize);
  if (cmp(price, "0") <= 0) return { kind: "skip", reason: "no usable price" };

  const rawQuantity = config.side === "BUY" ? div(amount, price) : amount;
  const quantity = floorTo(rawQuantity, rules.stepSize);
  const notional = mul(quantity, price);
  if (cmp(quantity, rules.minQty) < 0 || cmp(notional, rules.minNotional) < 0) {
    return {
      kind: "skip",
      reason: `slice value ${notional} is below the ${rules.minNotional} ${rules.quoteAsset} minimum`,
    };
  }
  return { kind: "order", price, quantity, notional };
}

export type TwapEvent =
  | { type: "slice-skipped"; slice: number; reason: string; carried: string }
  | { type: "order-placed"; slice: number; orderId: string; clientOrderId: string; price: string; quantity: string }
  | { type: "fill"; slice: number; orderId: string; clientOrderId: string; fill: Fill }
  | { type: "slice-settled"; slice: number; filled: string; carried: string }
  | { type: "slice-failed"; slice: number; error: string }
  | { type: "done"; filledBase: string; filledQuote: string; unfilled: string };

export type TwapRunOptions = {
  /** Plans and validates every slice against live market data without placing orders. */
  dryRun?: boolean;
  runId?: string;
  onEvent?: (event: TwapEvent) => void | Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
  settlementTimeoutMs?: number;
  maxConsecutiveFailures?: number;
};

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Executes a TWAP against Lambdaplex. Fills are reported only once they are settlement-final on Hedera. */
export async function runTwap(client: LambdaplexClient, config: TwapConfig, options: TwapRunOptions = {}) {
  const sleep = options.sleep ?? defaultSleep;
  const emit = async (event: TwapEvent) => options.onEvent?.(event);
  const runId = options.runId ?? Date.now().toString(36);
  const maxFailures = options.maxConsecutiveFailures ?? 3;

  const info = await client.exchangeInfo();
  const symbol = info.exchangeSymbols.find(s => s.symbol === config.symbol);
  if (!symbol) throw new Error(`Unknown market ${config.symbol}`);
  const rules = marketRules(symbol);

  const slices = planSlices(config.total, config.slices);
  let carry = "0";
  let filledBase = "0";
  let filledQuote = "0";
  let failures = 0;

  for (let i = 0; i < slices.length; i++) {
    if (options.signal?.aborted) break;
    if (i > 0) await sleep(config.intervalSeconds * 1000);

    const amount = add(slices[i], carry);
    const book = await client.depth(config.symbol, 5);
    const reference = referencePrice(book, config.side);
    if (!reference) {
      carry = amount;
      await emit({ type: "slice-skipped", slice: i, reason: "the book has no liquidity on that side", carried: carry });
      continue;
    }

    const plan = planSlice(rules, config, amount, reference);
    if (plan.kind === "skip") {
      carry = amount;
      await emit({ type: "slice-skipped", slice: i, reason: plan.reason, carried: carry });
      continue;
    }
    if (options.dryRun) {
      carry = "0";
      await emit({
        type: "slice-skipped",
        slice: i,
        reason: `dry run: would ${config.side} ${plan.quantity} @ ${plan.price}`,
        carried: "0",
      });
      continue;
    }

    const clientOrderId = `twap-${runId}-${i}`.slice(0, 32);
    try {
      const ack = await client.placeOrder({
        symbol: config.symbol,
        side: config.side,
        type: "LIMIT",
        timeInForce: "IOC",
        price: plan.price,
        quantity: plan.quantity,
        newClientOrderId: clientOrderId,
      });
      await emit({
        type: "order-placed",
        slice: i,
        orderId: ack.orderId,
        clientOrderId,
        price: plan.price,
        quantity: plan.quantity,
      });

      const settled = await waitForSettlement(client, config.symbol, ack.orderId, sleep, options.settlementTimeoutMs);
      for (const fill of settled.fills) {
        await emit({ type: "fill", slice: i, orderId: ack.orderId, clientOrderId, fill });
      }
      filledBase = add(filledBase, settled.settledExecutedQty);
      filledQuote = add(filledQuote, settled.settledCumulativeQuoteQty);
      const used = config.side === "BUY" ? settled.settledCumulativeQuoteQty : settled.settledExecutedQty;
      carry = cmp(amount, used) > 0 ? sub(amount, used) : "0";
      failures = 0;
      await emit({ type: "slice-settled", slice: i, filled: settled.settledExecutedQty, carried: carry });
    } catch (error) {
      failures += 1;
      carry = amount;
      await emit({ type: "slice-failed", slice: i, error: error instanceof Error ? error.message : String(error) });
      if (failures >= maxFailures) break;
    }
  }

  await emit({ type: "done", filledBase, filledQuote, unfilled: carry });
  return { filledBase, filledQuote, unfilled: carry };
}

/** Polls the order-scoped fills endpoint until the order can never fill again and every match has settled. */
async function waitForSettlement(
  client: LambdaplexClient,
  symbol: string,
  orderId: string,
  sleep: (ms: number) => Promise<void>,
  timeoutMs = 90_000,
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const page = await client.orderFills(symbol, orderId);
    if (page.order?.terminal && cmp(page.pendingSettlementQty, "0") === 0) return page;
    if (Date.now() > deadline) throw new Error(`order ${orderId} did not settle within ${timeoutMs / 1000}s`);
    await sleep(2_000);
  }
}
