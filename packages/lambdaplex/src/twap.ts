import type { LambdaplexClient } from "./client";
import { add, applyBps, ceilTo, cmp, div, floorTo, fromUnits, mul, sub, toUnits } from "./decimal";
import { type MarketRules, marketRules } from "./filters";
import type { Fill, OrderBook, OrderFillsPage, OrderRef, OrderSide } from "./types";

/**
 * TWAP: split a large order into equal slices placed at a fixed interval, so it trades near the time-weighted
 * average price instead of moving a thin book. Each slice is an IOC limit order capped at `maxSlippageBps` from the
 * best opposite price; whatever a slice cannot fill rolls into the next one.
 *
 * Execution safety: once the exchange may have an order, the executor never re-trades that slice without first
 * learning what it executed. If that cannot be established, the run stops and reports the amount as `unresolved`.
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

const SYMBOL_RE = /^[A-Za-z0-9]{1,20}-[A-Za-z0-9]{1,20}$/;
const PLAIN_DECIMAL = /^\d{1,30}(\.\d{1,18})?$/;

/** Problems with a TWAP config, as readable sentences. `runTwap` refuses to start unless this is empty. */
export function validateTwapConfig(config: TwapConfig): string[] {
  const problems: string[] = [];
  if (typeof config.symbol !== "string" || !SYMBOL_RE.test(config.symbol))
    problems.push("symbol must look like HBAR-USDC");
  if (config.side !== "BUY" && config.side !== "SELL") problems.push("side must be BUY or SELL");
  if (typeof config.total !== "string" || !PLAIN_DECIMAL.test(config.total) || cmp(config.total, "0") <= 0) {
    problems.push("total must be a positive decimal");
  }
  if (!Number.isInteger(config.slices) || config.slices < 1 || config.slices > 1000) {
    problems.push("slices must be an integer from 1 to 1000");
  }
  if (!Number.isFinite(config.intervalSeconds) || config.intervalSeconds < 0 || config.intervalSeconds > 86_400) {
    problems.push("intervalSeconds must be a number from 0 to 86400");
  }
  if (!Number.isInteger(config.maxSlippageBps) || config.maxSlippageBps < 0 || config.maxSlippageBps > 1000) {
    problems.push("maxSlippageBps must be an integer from 0 to 1000");
  }
  return problems;
}

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

/** Keeps a limit price inside the market's percent-price band around the reference, when the market has one. */
function clampToBand(rules: MarketRules, side: OrderSide, price: string, reference: string): string {
  if (side === "BUY") {
    if (cmp(rules.bidMultiplierUp, "0") <= 0) return price;
    const high = floorTo(mul(reference, rules.bidMultiplierUp), rules.tickSize);
    return cmp(price, high) > 0 ? high : price;
  }
  if (cmp(rules.askMultiplierDown, "0") <= 0) return price;
  const low = ceilTo(mul(reference, rules.askMultiplierDown), rules.tickSize);
  return cmp(price, low) < 0 ? low : price;
}

/** Turns a slice amount into an exchange-valid IOC order, or explains why it must roll over. */
export function planSlice(rules: MarketRules, config: TwapConfig, amount: string, reference: string): SlicePlan {
  const capped = slicePrice(reference, config.side, config.maxSlippageBps, rules.tickSize);
  const price = clampToBand(rules, config.side, capped, reference);
  if (cmp(price, "0") <= 0 || cmp(price, rules.minPrice) < 0) return { kind: "skip", reason: "no usable price" };

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
  | {
      type: "slice-skipped";
      slice: number;
      reason: string;
      carried: string;
      /** Dry runs only: the IOC limit order this slice would have placed. */
      planned?: { price: string; quantity: string };
    }
  | { type: "order-placed"; slice: number; orderId: string; clientOrderId: string; price: string; quantity: string }
  | { type: "fill"; slice: number; orderId: string; clientOrderId: string; fill: Fill }
  | {
      type: "slice-settled";
      slice: number;
      filled: string;
      carried: string;
      /** Matched base quantity still awaiting Hedera settlement when the run moved on (counted as filled). */
      pendingSettlement?: string;
    }
  | { type: "slice-failed"; slice: number; error: string }
  /** The exchange may hold this order but what it executed could not be established. The run stops here. */
  | { type: "slice-unresolved"; slice: number; clientOrderId: string; orderId?: string; amount: string; error: string }
  | {
      type: "done";
      filledBase: string;
      filledQuote: string;
      /** Not executed: the carry plus every slice that never ran. */
      unfilled: string;
      /** Execution unknown (see `slice-unresolved`); check the account before trading it again. */
      unresolved: string;
      dryRun: boolean;
      stopReason?: string;
    };

export type TwapResult = {
  filledBase: string;
  filledQuote: string;
  unfilled: string;
  unresolved: string;
  stopReason?: string;
};

/** The client calls the executor makes, so tests and alternative transports can supply their own. */
export type TwapClient = Pick<LambdaplexClient, "exchangeInfo" | "depth" | "placeOrder" | "allOrderFills">;

export type TwapSleep = (ms: number, signal?: AbortSignal) => Promise<void>;

export type TwapRunOptions = {
  /** Plans and validates every slice against live market data without placing orders. */
  dryRun?: boolean;
  runId?: string;
  /** Progress callback. It is best-effort: if it throws, the error goes to `onEventError` and trading carries on. */
  onEvent?: (event: TwapEvent) => void | Promise<void>;
  onEventError?: (error: unknown, event: TwapEvent) => void;
  /** Must resolve early when `signal` aborts (the default does). */
  sleep?: TwapSleep;
  signal?: AbortSignal;
  /** How long to wait for an accepted order to become terminal and settle. Default 90 s. */
  settlementTimeoutMs?: number;
  maxConsecutiveFailures?: number;
};

const POLL_MS = 2_000;
const LOOKUP_ATTEMPTS = 3;

/** `setTimeout` that resolves early when the signal aborts. */
export const abortableSleep: TwapSleep = (ms, signal) =>
  new Promise<void>(resolve => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Whether a failed request may still have reached the exchange: no HTTP status (network error, timeout) or a 5xx/408.
 * A 4xx is a definitive rejection. Duck-typed so this module stays free of the Node-only client.
 */
export function isAmbiguousFailure(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status !== "number") return true;
  return status >= 500 || status === 408;
}

/** Executes a TWAP against Lambdaplex. Fills are reported only once they are settlement-final on Hedera. */
export async function runTwap(
  client: TwapClient,
  config: TwapConfig,
  options: TwapRunOptions = {},
): Promise<TwapResult> {
  const problems = validateTwapConfig(config);
  if (problems.length) throw new Error(`Invalid TWAP config: ${problems.join("; ")}`);

  const sleep = options.sleep ?? abortableSleep;
  const signal = options.signal;
  const aborted = () => signal?.aborted === true;
  const runId = options.runId ?? Date.now().toString(36);
  const maxFailures = options.maxConsecutiveFailures ?? 3;
  const settlementTimeoutMs = options.settlementTimeoutMs ?? 90_000;
  const dryRun = options.dryRun === true;
  const emit = async (event: TwapEvent) => {
    try {
      await options.onEvent?.(event);
    } catch (error) {
      try {
        (options.onEventError ?? defaultOnEventError)(error, event);
      } catch {
        // Reporting must never affect trading.
      }
    }
  };

  const info = await client.exchangeInfo();
  const symbol = info.exchangeSymbols.find(s => s.symbol === config.symbol);
  if (!symbol) throw new Error(`Unknown market ${config.symbol}`);
  const rules = marketRules(symbol);

  const slices = planSlices(config.total, config.slices);
  let next = 0; // first slice not yet folded into `carry`
  let carry = "0"; // outstanding amount from slices already started
  let filledBase = "0";
  let filledQuote = "0";
  let unresolved = "0";
  let failures = 0;
  let stopReason: string | undefined;

  /** Records a slice that certainly executed nothing. Returns true when the run should stop. */
  const failSlice = async (slice: number, error: unknown) => {
    failures += 1;
    await emit({ type: "slice-failed", slice, error: errorMessage(error) });
    if (failures < maxFailures) return false;
    stopReason = `${failures} consecutive slices failed`;
    return true;
  };

  for (let i = 0; i < slices.length; i++) {
    if (i > 0) await sleep(config.intervalSeconds * 1000, signal);
    if (aborted()) {
      stopReason = "stopped";
      break;
    }

    const amount = add(slices[i], carry);
    carry = amount;
    next = i + 1;

    let book: OrderBook;
    try {
      book = await client.depth(config.symbol, 5);
    } catch (error) {
      if (await failSlice(i, error)) break;
      continue;
    }
    const reference = referencePrice(book, config.side);
    if (!reference) {
      await emit({ type: "slice-skipped", slice: i, reason: "the book has no liquidity on that side", carried: carry });
      continue;
    }
    const plan = planSlice(rules, config, amount, reference);
    if (plan.kind === "skip") {
      await emit({ type: "slice-skipped", slice: i, reason: plan.reason, carried: carry });
      continue;
    }
    if (dryRun) {
      carry = "0";
      await emit({
        type: "slice-skipped",
        slice: i,
        reason: `dry run: would ${config.side} ${plan.quantity} @ ${plan.price}`,
        carried: "0",
        planned: { price: plan.price, quantity: plan.quantity },
      });
      continue;
    }
    if (aborted()) {
      stopReason = "stopped";
      break;
    }

    // ---- placement: after this point the exchange may hold the order
    const clientOrderId = `twap-${runId}-${i}`.slice(0, 32);
    let orderId: string;
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
      orderId = ack.orderId;
    } catch (error) {
      if (!isAmbiguousFailure(error)) {
        if (await failSlice(i, error)) break;
        continue;
      }
      const found = await findOrderByClientId(client, config.symbol, clientOrderId, sleep);
      if (found.kind === "absent") {
        if (await failSlice(i, error)) break;
        continue;
      }
      if (found.kind === "unknown") {
        carry = "0";
        unresolved = add(unresolved, amount);
        stopReason = `could not tell whether slice ${i + 1} was placed`;
        await emit({
          type: "slice-unresolved",
          slice: i,
          clientOrderId,
          amount,
          error: `${errorMessage(error)}; lookup by client order id: ${errorMessage(found.error)}`,
        });
        break;
      }
      orderId = found.orderId;
    }
    await emit({ type: "order-placed", slice: i, orderId, clientOrderId, price: plan.price, quantity: plan.quantity });

    const outcome = await waitForOutcome(client, config.symbol, { orderId }, sleep, settlementTimeoutMs);
    if (outcome.kind === "unknown") {
      carry = "0";
      unresolved = add(unresolved, amount);
      stopReason = `could not confirm what order ${orderId} executed`;
      await emit({
        type: "slice-unresolved",
        slice: i,
        clientOrderId,
        orderId,
        amount,
        error: errorMessage(outcome.error),
      });
      break;
    }

    const { page } = outcome;
    for (const fill of page.fills) {
      await emit({ type: "fill", slice: i, orderId, clientOrderId, fill });
    }
    // Settled totals when final; otherwise the order's matched totals, which settlement can only confirm.
    const executedBase = outcome.kind === "settled" ? page.settledExecutedQty : page.order!.executedQty;
    const executedQuote = outcome.kind === "settled" ? page.settledCumulativeQuoteQty : page.order!.cumulativeQuoteQty;
    filledBase = add(filledBase, executedBase);
    filledQuote = add(filledQuote, executedQuote);
    const used = config.side === "BUY" ? executedQuote : executedBase;
    carry = cmp(amount, used) > 0 ? sub(amount, used) : "0";
    failures = 0;
    await emit({
      type: "slice-settled",
      slice: i,
      filled: executedBase,
      carried: carry,
      ...(outcome.kind === "matched" ? { pendingSettlement: page.pendingSettlementQty } : {}),
    });
  }

  const unfilled = dryRun ? config.total : slices.slice(next).reduce(add, carry);
  if (dryRun) filledBase = filledQuote = "0";
  const result: TwapResult = { filledBase, filledQuote, unfilled, unresolved, ...(stopReason ? { stopReason } : {}) };
  await emit({ type: "done", ...result, dryRun });
  return result;
}

/** Polls until the order is terminal and fully settled, tolerating transient errors, within the timeout. */
async function waitForOutcome(
  client: TwapClient,
  symbol: string,
  ref: OrderRef,
  sleep: TwapSleep,
  timeoutMs: number,
): Promise<{ kind: "settled" | "matched"; page: OrderFillsPage } | { kind: "unknown"; error: unknown }> {
  const deadline = Date.now() + timeoutMs;
  const maxPolls = Math.max(1, Math.ceil(timeoutMs / POLL_MS));
  let last: OrderFillsPage | undefined;
  let lastError: unknown;
  for (let poll = 1; ; poll++) {
    try {
      const page = checkContract(await client.allOrderFills(symbol, ref));
      if (page.presence === "PRESENT" && page.order) {
        last = page;
        if (page.order.terminal && cmp(page.pendingSettlementQty, "0") === 0) return { kind: "settled", page };
      }
    } catch (error) {
      lastError = error;
    }
    if (poll >= maxPolls || Date.now() >= deadline) break;
    // Not abortable: an accepted order is always accounted for, even after Stop.
    await sleep(POLL_MS);
  }
  if (last && canNoLongerFill(last)) return { kind: "matched", page: last };
  return {
    kind: "unknown",
    error: lastError ?? new Error(`order did not reach a final state within ${Math.round(timeoutMs / 1000)}s`),
  };
}

const FINAL_STATUSES = new Set(["FILLED", "CANCELED", "EXPIRED", "FAILED"]);

/** The order's executed quantities are final even if some of it is still settling. */
const canNoLongerFill = (page: OrderFillsPage) =>
  Boolean(page.order && (page.order.terminal || FINAL_STATUSES.has(page.order.status)));

function checkContract(page: OrderFillsPage): OrderFillsPage {
  if (page.contract !== "ORDER_SCOPED_FILLS_V1" || page.finality !== "SETTLEMENT_FINAL") {
    throw new Error(`unexpected fills contract ${page.contract}/${page.finality}`);
  }
  return page;
}

/**
 * After an ambiguous placement failure, asks the exchange whether it holds an order with this client id. `absent`
 * needs the latest lookup to succeed and report ABSENT; if no lookup succeeds the answer is `unknown`.
 */
async function findOrderByClientId(
  client: TwapClient,
  symbol: string,
  clientOrderId: string,
  sleep: TwapSleep,
): Promise<{ kind: "present"; orderId: string } | { kind: "absent" } | { kind: "unknown"; error: unknown }> {
  let lastError: unknown = new Error("no lookup attempted");
  let absent = false;
  for (let attempt = 0; attempt < LOOKUP_ATTEMPTS; attempt++) {
    await sleep(POLL_MS);
    try {
      const page = checkContract(await client.allOrderFills(symbol, { origClientOrderId: clientOrderId }));
      if (page.presence === "PRESENT" && page.order) return { kind: "present", orderId: page.order.orderId };
      absent = true;
    } catch (error) {
      absent = false;
      lastError = error;
    }
  }
  return absent ? { kind: "absent" } : { kind: "unknown", error: lastError };
}

function defaultOnEventError(error: unknown, event: TwapEvent) {
  console.warn(`TWAP event handler failed on "${event.type}" (trading continues): ${errorMessage(error)}`);
}
