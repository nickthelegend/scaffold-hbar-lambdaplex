/**
 * runTwap against an in-memory exchange. The double below implements only the four client calls the executor makes
 * (exchangeInfo, depth, placeOrder, allOrderFills) and fills IOC orders at their limit price. No HTTP is involved.
 */
import { describe, expect, it } from "vitest";
import { add, mul } from "../../src/decimal";
import {
  abortableSleep,
  runTwap,
  type TwapClient,
  type TwapConfig,
  type TwapEvent,
  type TwapSleep,
} from "../../src/twap";
import type { ExchangeInfo, NewOrder, OrderAck, OrderBook, OrderFillsPage, OrderRef } from "../../src/types";
import exchangeInfo from "../fixtures/exchangeInfo.json";

type FillsMode = "settled" | "never-terminal" | "error" | "matched-unsettled";

type StoredOrder = { order: NewOrder; orderId: string };

class InMemoryExchange implements TwapClient {
  book: OrderBook = { lastUpdateId: 1, bids: [["0.099", "1000000"]], asks: [["0.1", "1000000"]] };
  placed: StoredOrder[] = [];
  fillsMode: FillsMode = "settled";
  /** Simulates network failures: the request never arrives, or it arrives and the response is lost. */
  onPlace?: (order: NewOrder, attempt: number) => "lose-request" | "lose-response" | void;
  placeAttempts = 0;
  depthFailures = 0;
  lookupFails = false;
  fillsCalls = 0;

  exchangeInfo = async () => exchangeInfo as ExchangeInfo;

  depth = async (): Promise<OrderBook> => {
    if (this.depthFailures > 0) {
      this.depthFailures -= 1;
      throw Object.assign(new Error("HTTP 503"), { status: 503 });
    }
    return this.book;
  };

  placeOrder = async (order: NewOrder): Promise<OrderAck> => {
    const mode = this.onPlace?.(order, this.placeAttempts++);
    if (mode === "lose-request") throw new TypeError("fetch failed");
    const stored = { order, orderId: `order-${this.placed.length}` };
    this.placed.push(stored);
    if (mode === "lose-response") throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    return { symbol: order.symbol, orderId: stored.orderId, clientOrderId: order.newClientOrderId, transactTime: 0 };
  };

  allOrderFills = async (symbol: string, ref: OrderRef): Promise<OrderFillsPage> => {
    this.fillsCalls += 1;
    const byClientId = typeof ref === "object" && "origClientOrderId" in ref;
    if (byClientId && this.lookupFails) throw new TypeError("fetch failed");
    if (!byClientId && this.fillsMode === "error") throw Object.assign(new Error("HTTP 503"), { status: 503 });
    const stored = this.placed.find(p =>
      typeof ref === "string"
        ? p.orderId === ref
        : "orderId" in ref
          ? p.orderId === ref.orderId
          : p.order.newClientOrderId === ref.origClientOrderId,
    );
    const base = { contract: "ORDER_SCOPED_FILLS_V1", finality: "SETTLEMENT_FINAL", symbol, hasMore: false } as const;
    if (!stored) {
      return {
        ...base,
        presence: "ABSENT",
        settledExecutedQty: "0",
        settledCumulativeQuoteQty: "0",
        pendingSettlementQty: "0",
        fills: [],
      };
    }
    const qty = stored.order.quantity!;
    const quote = mul(qty, stored.order.price!);
    const settled = this.fillsMode !== "matched-unsettled";
    const terminal = this.fillsMode !== "never-terminal";
    return {
      ...base,
      presence: "PRESENT",
      order: {
        orderId: stored.orderId,
        clientOrderId: stored.order.newClientOrderId,
        side: stored.order.side,
        status: terminal ? "FILLED" : "ACTIVE",
        terminal: terminal && settled,
        executedQty: terminal ? qty : "0",
        cumulativeQuoteQty: terminal ? quote : "0",
      },
      settledExecutedQty: settled && terminal ? qty : "0",
      settledCumulativeQuoteQty: settled && terminal ? quote : "0",
      pendingSettlementQty: terminal && !settled ? qty : "0",
      fills:
        settled && terminal
          ? [
              {
                cursorId: 1,
                orderId: stored.orderId,
                price: stored.order.price!,
                qty,
                quoteQty: quote,
                commission: "0",
                commissionAsset: "HBAR",
                time: 0,
                isBuyer: stored.order.side === "BUY",
                isMaker: false,
                settlementTransactionId: "0.0.1@1.1",
              },
            ]
          : [],
    };
  };

  /** Quote actually committed by every order the exchange holds. */
  get quoteSpent() {
    return this.placed.reduce((sum, p) => add(sum, mul(p.order.quantity!, p.order.price!)), "0");
  }
}

const config: TwapConfig = {
  symbol: "HBAR-USDC",
  side: "BUY",
  total: "30",
  slices: 3,
  intervalSeconds: 60,
  maxSlippageBps: 50,
};

const instantSleep: TwapSleep = async () => {};

function recorder() {
  const events: TwapEvent[] = [];
  return { events, onEvent: (event: TwapEvent) => void events.push(event) };
}

// 10 USDC at a 0.1005 cap buys 99 HBAR for 9.9495; the 0.0505 remainder rolls into the next slice.
describe("runTwap execution safety", () => {
  it("trades each slice once and stays within budget", async () => {
    const exchange = new InMemoryExchange();
    const result = await runTwap(exchange, config, { sleep: instantSleep });
    expect(exchange.placed).toHaveLength(3);
    expect(Number(exchange.quoteSpent)).toBeLessThanOrEqual(30);
    expect(result).toMatchObject({ filledQuote: exchange.quoteSpent, unresolved: "0" });
    expect(result.stopReason).toBeUndefined();
  });

  it("never re-trades a filled slice when the event handler throws (e.g. HCS publish fails)", async () => {
    const exchange = new InMemoryExchange();
    const handlerErrors: string[] = [];
    const result = await runTwap(exchange, config, {
      sleep: instantSleep,
      onEvent: event => {
        if (event.type === "fill") throw new Error("INSUFFICIENT_PAYER_BALANCE");
      },
      onEventError: (_error, event) => void handlerErrors.push(event.type),
    });
    expect(handlerErrors).toEqual(["fill", "fill", "fill"]);
    expect(exchange.placed).toHaveLength(3);
    expect(Number(exchange.quoteSpent)).toBeLessThanOrEqual(30);
    expect(result.filledBase).toBe("298");
    expect(result.filledQuote).toBe(exchange.quoteSpent);
  });

  it("stops instead of re-trading when an accepted order never reaches a final state", async () => {
    const exchange = new InMemoryExchange();
    exchange.fillsMode = "never-terminal";
    const { events, onEvent } = recorder();
    const result = await runTwap(exchange, config, { sleep: instantSleep, onEvent, settlementTimeoutMs: 6_000 });

    expect(exchange.placed).toHaveLength(1);
    expect(exchange.fillsCalls).toBe(3);
    expect(events.find(e => e.type === "slice-unresolved")).toMatchObject({
      slice: 0,
      orderId: "order-0",
      amount: "10",
    });
    expect(result).toMatchObject({ unresolved: "10", unfilled: "20", filledQuote: "0" });
    expect(result.stopReason).toMatch(/could not confirm/);
  });

  it("stops when settlement polling keeps failing after an ack", async () => {
    const exchange = new InMemoryExchange();
    exchange.fillsMode = "error";
    const result = await runTwap(exchange, config, { sleep: instantSleep, settlementTimeoutMs: 4_000 });
    expect(exchange.placed).toHaveLength(1);
    expect(result).toMatchObject({ unresolved: "10", unfilled: "20" });
  });

  it("counts matched quantity that is still settling instead of re-trading it", async () => {
    const exchange = new InMemoryExchange();
    exchange.fillsMode = "matched-unsettled";
    const { events, onEvent } = recorder();
    const result = await runTwap(exchange, config, { sleep: instantSleep, onEvent, settlementTimeoutMs: 2_000 });
    expect(exchange.placed).toHaveLength(3);
    expect(Number(exchange.quoteSpent)).toBeLessThanOrEqual(30);
    expect(result.filledBase).toBe("298");
    expect(events.filter(e => e.type === "fill")).toHaveLength(0);
    expect(events.find(e => e.type === "slice-settled")).toMatchObject({ pendingSettlement: "99" });
  });

  it("stops at the next slice when aborted mid-sleep, and reports the slices that never ran", async () => {
    const exchange = new InMemoryExchange();
    const controller = new AbortController();
    const sleeps: number[] = [];
    const sleep: TwapSleep = async ms => {
      sleeps.push(ms);
      if (ms === 60_000) controller.abort();
    };
    const { events, onEvent } = recorder();
    const result = await runTwap(exchange, config, { sleep, signal: controller.signal, onEvent });

    expect(sleeps).toEqual([60_000]);
    expect(exchange.placed).toHaveLength(1);
    // carry 0.0505 from slice 1 plus slices 2 and 3 that never ran
    expect(result).toMatchObject({ unfilled: "20.0505", unresolved: "0", stopReason: "stopped" });
    expect(events.at(-1)).toMatchObject({ type: "done", unfilled: "20.0505", dryRun: false });
  });

  it("resolves the default sleep as soon as the signal aborts", async () => {
    const controller = new AbortController();
    const started = Date.now();
    setTimeout(() => controller.abort(), 10);
    await abortableSleep(60_000, controller.signal);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("finds an order whose placement response was lost instead of placing it twice", async () => {
    const exchange = new InMemoryExchange();
    exchange.onPlace = (_order, attempt) => (attempt === 0 ? "lose-response" : undefined);
    const { events, onEvent } = recorder();
    const result = await runTwap(exchange, config, { sleep: instantSleep, onEvent });
    expect(exchange.placed).toHaveLength(3);
    expect(events.find(e => e.type === "order-placed")).toMatchObject({ slice: 0, orderId: "order-0" });
    expect(Number(exchange.quoteSpent)).toBeLessThanOrEqual(30);
    expect(result.unresolved).toBe("0");
  });

  it("carries a slice the exchange confirms it never received", async () => {
    const exchange = new InMemoryExchange();
    exchange.onPlace = (_order, attempt) => (attempt === 0 ? "lose-request" : undefined);
    const { events, onEvent } = recorder();
    const result = await runTwap(exchange, config, { sleep: instantSleep, onEvent });
    expect(events.filter(e => e.type === "slice-failed")).toHaveLength(1);
    expect(exchange.placed).toHaveLength(2);
    expect(Number(exchange.quoteSpent)).toBeLessThanOrEqual(30);
    expect(result.unresolved).toBe("0");
  });

  it("stops when it cannot tell whether an ambiguous placement went through", async () => {
    const exchange = new InMemoryExchange();
    exchange.onPlace = () => "lose-response";
    exchange.lookupFails = true;
    const result = await runTwap(exchange, config, { sleep: instantSleep });
    expect(exchange.placed).toHaveLength(1);
    expect(result).toMatchObject({ unresolved: "10", unfilled: "20" });
  });

  it("treats a 4xx rejection as definitive and reports every unplanned slice as unfilled", async () => {
    const exchange = new InMemoryExchange();
    exchange.placeOrder = async () => {
      throw Object.assign(new Error("Insufficient balance"), { status: 400 });
    };
    const result = await runTwap(exchange, { ...config, slices: 6, total: "60" }, { sleep: instantSleep });
    expect(result).toMatchObject({ unfilled: "60", unresolved: "0", stopReason: "3 consecutive slices failed" });
  });

  it("counts a failed depth call as a slice failure instead of crashing the run", async () => {
    const exchange = new InMemoryExchange();
    exchange.depthFailures = 1;
    const { events, onEvent } = recorder();
    const result = await runTwap(exchange, config, { sleep: instantSleep, onEvent });
    expect(events[0]).toMatchObject({ type: "slice-failed", slice: 0 });
    expect(exchange.placed).toHaveLength(2);
    expect(events.at(-1)?.type).toBe("done");
    expect(Number(result.filledQuote)).toBeLessThanOrEqual(30);
  });

  it("validates the config before touching the exchange", async () => {
    const exchange = new InMemoryExchange();
    await expect(runTwap(exchange, { ...config, intervalSeconds: Number("abc") })).rejects.toThrow(/intervalSeconds/);
    await expect(runTwap(exchange, { ...config, maxSlippageBps: 20_000 })).rejects.toThrow(/maxSlippageBps/);
    await expect(runTwap(exchange, { ...config, maxSlippageBps: 1.5 })).rejects.toThrow(/maxSlippageBps/);
    expect(exchange.placed).toHaveLength(0);
  });

  it("reports a dry run as nothing executed", async () => {
    const exchange = new InMemoryExchange();
    const result = await runTwap(exchange, config, { sleep: instantSleep, dryRun: true });
    expect(exchange.placed).toHaveLength(0);
    expect(result).toMatchObject({ filledQuote: "0", unfilled: "30" });
  });
});
