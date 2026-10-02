import { type Ed25519Key, loadEd25519Key, type OrderedParams, signedQuery } from "./signing";
import type {
  Account,
  CancelAck,
  ExchangeInfo,
  NewOrder,
  Order,
  OrderAck,
  OrderBook,
  OrderFillsFrontier,
  OrderFillsPage,
  OrderRef,
  PublicTrade,
  TickerPrice,
} from "./types";

export const LAMBDAPLEX_API = "https://api.lambdaplex.io";

/** An error response from Lambdaplex: RFC 7807 problem details or a Binance-style `{ code, msg }`. */
export class LambdaplexError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | number | undefined,
    message: string,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "LambdaplexError";
  }

  get isRateLimited() {
    return this.status === 429 || this.status === 418;
  }

  /** The request was rejected because its `timestamp` fell outside `recvWindow` (clock drift). Nothing executed. */
  get isTimestampError() {
    if (this.status !== 400 && this.status !== 401) return false;
    return this.code === -1021 || /timestamp|recv.?window/i.test(`${this.code ?? ""} ${this.message}`);
  }
}

export type LambdaplexClientOptions = {
  baseUrl?: string;
  apiKey?: string;
  /** Ed25519 private key: PEM, base64 PKCS#8 or 32-byte hex seed. Never ship it to a browser. */
  privateKey?: string;
  recvWindow?: number;
  /** Per-request timeout. A request that times out may still have reached the exchange. Default 15 s. */
  timeoutMs?: number;
  fetch?: typeof fetch;
};

/** Continuation of a multi-page `orderFills` read: the cursor plus the frozen cut of the first page. */
export type OrderFillsContinuation = { pageAfterCursorId: number; frontier: OrderFillsFrontier };

const CLOCK_RESYNC_MS = 10 * 60_000;
const MAX_FILL_PAGES = 100;

type Query = Record<string, string | number | boolean | undefined>;

const toParams = (query: Query): OrderedParams =>
  Object.entries(query).filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined);

/**
 * Typed client for the Lambdaplex REST API. Public market data needs no credentials; account and order endpoints
 * are signed with Signature V1. Server time is synced on first use, every few minutes after that and again after a
 * timestamp rejection, so `timestamp` stays inside `recvWindow`.
 *
 * The private key is parsed lazily: a malformed key never throws from the constructor. `canTrade` is then false and
 * `configError` says why, so read-only routes keep working.
 */
export class LambdaplexClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly privateKey?: string;
  private keyState?: { key?: Ed25519Key; error?: string };
  private readonly recvWindow: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private clockOffsetMs?: number;
  private clockSyncedAt = 0;

  constructor(options: LambdaplexClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? LAMBDAPLEX_API).replace(/\/$/, "");
    this.apiKey = options.apiKey || undefined;
    this.privateKey = options.privateKey || undefined;
    this.recvWindow = options.recvWindow ?? 5000;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetchImpl = options.fetch ?? fetch;
  }

  private loadKey() {
    if (!this.keyState) {
      if (!this.privateKey) this.keyState = {};
      else {
        try {
          this.keyState = { key: loadEd25519Key(this.privateKey) };
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          this.keyState = { error: `LAMBDAPLEX_PRIVATE_KEY is not a usable Ed25519 key (${reason})` };
        }
      }
    }
    return this.keyState;
  }

  get canTrade() {
    return Boolean(this.apiKey && this.loadKey().key);
  }

  /** Why credentials that were supplied cannot be used, e.g. a malformed private key. Never contains key material. */
  get configError(): string | undefined {
    return this.loadKey().error;
  }

  // ---------------------------------------------------------------- public market data

  ping = () => this.public<Record<string, never>>("/api/v1/ping");
  serverTime = () => this.public<{ serverTime: number }>("/api/v1/time");
  exchangeInfo = () => this.public<ExchangeInfo>("/api/v1/exchangeInfo");
  depth = (symbol: string, limit = 20) => this.public<OrderBook>("/api/v1/depth", { symbol, limit });
  trades = (symbol: string, limit = 50) => this.public<PublicTrade[]>("/api/v1/trades", { symbol, limit });
  avgPrice = (symbol: string) =>
    this.public<{ mins: number; price: string; closeTime: number }>("/api/v1/avgPrice", { symbol });
  tickerPrices = () => this.public<TickerPrice[]>("/api/v1/ticker/price");

  // ---------------------------------------------------------------- signed account and orders

  account = () => this.signed<Account>("GET", "/api/v1/account", { omitZeroBalances: true });
  openOrders = (symbol: string) => this.signed<Order[]>("GET", "/api/v1/openOrders", { symbol });
  getOrder = (symbol: string, orderId: string) => this.signed<Order>("GET", "/api/v1/order", { symbol, orderId });

  placeOrder = (order: NewOrder) =>
    this.signed<OrderAck>("POST", "/api/v1/order", {
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      timeInForce: order.timeInForce,
      quantity: order.quantity,
      quoteOrderQty: order.quoteOrderQty,
      price: order.price,
      newClientOrderId: order.newClientOrderId,
    });

  cancelOrder = (symbol: string, orderId: string) =>
    this.signed<CancelAck>("DELETE", "/api/v1/order", { symbol, orderId });

  /** Looks an order up by the `newClientOrderId` it was placed with. */
  getOrderByClientId = (symbol: string, clientOrderId: string) =>
    this.signed<Order>("GET", "/api/v1/order", { symbol, origClientOrderId: clientOrderId });

  /**
   * One page of an order's settlement-final fills, each with the Hedera transaction that settled it. The order can be
   * named by exchange id or by client order id, so an order whose placement response was lost can still be found.
   */
  orderFills = (symbol: string, order: OrderRef, continuation?: OrderFillsContinuation) => {
    const ref = typeof order === "string" ? { orderId: order } : order;
    return this.signed<OrderFillsPage>("GET", "/api/v2/order/fills", {
      symbol,
      orderId: "orderId" in ref ? ref.orderId : undefined,
      origClientOrderId: "origClientOrderId" in ref ? ref.origClientOrderId : undefined,
      pageAfterCursorId: continuation?.pageAfterCursorId,
      orderProjectionThroughEventIds: continuation?.frontier.orderProjectionThroughEventIds.join(","),
      fillProjectionThroughEventIds: continuation?.frontier.fillProjectionThroughEventIds.join(","),
      capturedAt: continuation?.frontier.capturedAt,
    });
  };

  /** Every page of `orderFills` at one frozen cut, merged: totals, order state and the complete fill list. */
  allOrderFills = async (symbol: string, order: OrderRef): Promise<OrderFillsPage> => {
    const first = await this.orderFills(symbol, order);
    const fills = [...first.fills];
    let page = first;
    for (let pages = 1; page.hasMore && page.nextPageAfterCursorId != null; pages++) {
      if (!first.frontier) throw new Error("Lambdaplex returned more fill pages without a frontier to continue from");
      if (pages >= MAX_FILL_PAGES) throw new Error(`Order has more than ${MAX_FILL_PAGES} pages of fills`);
      page = await this.orderFills(symbol, order, {
        pageAfterCursorId: page.nextPageAfterCursorId,
        frontier: first.frontier,
      });
      fills.push(...page.fills);
    }
    // Totals are cut-wide on every page; `terminal` may only become true on a later page, so keep the last order view.
    return { ...page, frontier: first.frontier, fills, hasMore: false, nextPageAfterCursorId: null };
  };

  // ---------------------------------------------------------------- transport

  private async public<T>(path: string, query: Query = {}): Promise<T> {
    const params = new URLSearchParams(toParams(query).map(([k, v]) => [k, String(v)]));
    const qs = params.toString();
    return this.request<T>("GET", `${path}${qs ? `?${qs}` : ""}`);
  }

  private async signed<T>(method: "GET" | "POST" | "DELETE", path: string, query: Query): Promise<T> {
    const { key, error } = this.loadKey();
    if (!this.apiKey || !key) {
      throw new LambdaplexError(
        401,
        "NO_CREDENTIALS",
        error ?? "Trading is not configured: set the API key and private key",
        null,
      );
    }
    const send = async () => {
      const qs = signedQuery(toParams(query), key, { timestamp: await this.now(), recvWindow: this.recvWindow });
      return this.request<T>(method, `${path}?${qs}`, { "X-API-KEY": this.apiKey! });
    };
    try {
      return await send();
    } catch (error) {
      // A timestamp rejection happens before anything executes, so re-syncing the clock and re-signing is safe.
      if (!(error instanceof LambdaplexError && error.isTimestampError)) throw error;
      this.clockOffsetMs = undefined;
      return send();
    }
  }

  private async now(): Promise<number> {
    if (this.clockOffsetMs === undefined || Date.now() - this.clockSyncedAt > CLOCK_RESYNC_MS) {
      const before = Date.now();
      const { serverTime } = await this.serverTime();
      this.clockOffsetMs = serverTime - Math.round((before + Date.now()) / 2);
      this.clockSyncedAt = Date.now();
    }
    return Date.now() + this.clockOffsetMs;
  }

  private async request<T>(method: string, pathAndQuery: string, headers: Record<string, string> = {}): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${pathAndQuery}`, {
      method,
      headers,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text();
    const body = text ? safeJson(text) : null;
    if (!res.ok) {
      const problem = (body ?? {}) as { code?: string | number; msg?: string; detail?: string; title?: string };
      const message = problem.detail ?? problem.msg ?? problem.title ?? `HTTP ${res.status}`;
      throw new LambdaplexError(
        res.status,
        problem.code,
        `Lambdaplex ${method} ${pathAndQuery.split("?")[0]}: ${message}`,
        body,
      );
    }
    return body as T;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
