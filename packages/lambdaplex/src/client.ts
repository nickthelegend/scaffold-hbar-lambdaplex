import { type Ed25519Key, loadEd25519Key, type OrderedParams, signedQuery } from "./signing";
import type {
  Account,
  CancelAck,
  ExchangeInfo,
  NewOrder,
  Order,
  OrderAck,
  OrderBook,
  OrderFillsPage,
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
}

export type LambdaplexClientOptions = {
  baseUrl?: string;
  apiKey?: string;
  /** Ed25519 private key: PEM, base64 PKCS#8 or 32-byte hex seed. Never ship it to a browser. */
  privateKey?: string;
  recvWindow?: number;
  fetch?: typeof fetch;
};

type Query = Record<string, string | number | boolean | undefined>;

const toParams = (query: Query): OrderedParams =>
  Object.entries(query).filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined);

/**
 * Typed client for the Lambdaplex REST API. Public market data needs no credentials; account and order endpoints
 * are signed with Signature V1. Server time is synced on first use so `timestamp` stays inside `recvWindow`.
 */
export class LambdaplexClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly key?: Ed25519Key;
  private readonly recvWindow: number;
  private readonly fetchImpl: typeof fetch;
  private clockOffsetMs?: number;

  constructor(options: LambdaplexClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? LAMBDAPLEX_API).replace(/\/$/, "");
    this.apiKey = options.apiKey || undefined;
    this.key = options.privateKey ? loadEd25519Key(options.privateKey) : undefined;
    this.recvWindow = options.recvWindow ?? 5000;
    this.fetchImpl = options.fetch ?? fetch;
  }

  get canTrade() {
    return Boolean(this.apiKey && this.key);
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

  /** Settlement-final fills of one order, each with the Hedera transaction that settled it. */
  orderFills = (symbol: string, orderId: string) =>
    this.signed<OrderFillsPage>("GET", "/api/v2/order/fills", { symbol, orderId });

  // ---------------------------------------------------------------- transport

  private async public<T>(path: string, query: Query = {}): Promise<T> {
    const params = new URLSearchParams(toParams(query).map(([k, v]) => [k, String(v)]));
    const qs = params.toString();
    return this.request<T>("GET", `${path}${qs ? `?${qs}` : ""}`);
  }

  private async signed<T>(method: "GET" | "POST" | "DELETE", path: string, query: Query): Promise<T> {
    if (!this.apiKey || !this.key) {
      throw new LambdaplexError(
        401,
        "NO_CREDENTIALS",
        "Trading is not configured: set the API key and private key",
        null,
      );
    }
    const qs = signedQuery(toParams(query), this.key, { timestamp: await this.now(), recvWindow: this.recvWindow });
    return this.request<T>(method, `${path}?${qs}`, { "X-API-KEY": this.apiKey });
  }

  private async now(): Promise<number> {
    if (this.clockOffsetMs === undefined) {
      const before = Date.now();
      const { serverTime } = await this.serverTime();
      this.clockOffsetMs = serverTime - Math.round((before + Date.now()) / 2);
    }
    return Date.now() + this.clockOffsetMs;
  }

  private async request<T>(method: string, pathAndQuery: string, headers: Record<string, string> = {}): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${pathAndQuery}`, { method, headers });
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
