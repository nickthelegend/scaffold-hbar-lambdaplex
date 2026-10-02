import type { ExchangeInfo, OrderBook, PublicTrade, TickerPrice } from "@sh/lambdaplex";

/** Public market data is read straight from Lambdaplex (CORS is open); anything signed goes through /api routes. */
export const LAMBDAPLEX_API = process.env.NEXT_PUBLIC_LAMBDAPLEX_API_BASE || "https://api.lambdaplex.io";
export const LAMBDAPLEX_WS = process.env.NEXT_PUBLIC_LAMBDAPLEX_WS_URL || "wss://api.lambdaplex.io/api/v1/ws";
export const LAMBDAPLEX_APP = "https://www.lambdaplex.io";

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

export const publicApi = {
  exchangeInfo: () => getJson<ExchangeInfo>(`${LAMBDAPLEX_API}/api/v1/exchangeInfo`),
  tickers: () => getJson<TickerPrice[]>(`${LAMBDAPLEX_API}/api/v1/ticker/price`),
  depth: (symbol: string, limit = 20) =>
    getJson<OrderBook>(`${LAMBDAPLEX_API}/api/v1/depth?symbol=${encodeURIComponent(symbol)}&limit=${limit}`),
  trades: (symbol: string, limit = 100) =>
    getJson<PublicTrade[]>(`${LAMBDAPLEX_API}/api/v1/trades?symbol=${encodeURIComponent(symbol)}&limit=${limit}`),
};

/** Calls this app's server routes, which hold the API key and sign requests. */
export const serverApi = {
  get: <T>(path: string) => getJson<T>(path, { cache: "no-store" }),
  post: <T>(path: string, body: unknown) =>
    getJson<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  delete: <T>(path: string) => getJson<T>(path, { method: "DELETE" }),
};
