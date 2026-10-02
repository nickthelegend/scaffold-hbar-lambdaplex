/**
 * Runs against the live Lambdaplex API (mainnet). Read-only unless LAMBDAPLEX_API_KEY and
 * LAMBDAPLEX_PRIVATE_KEY are set, in which case it also checks a signed account request.
 */
import { describe, expect, it } from "vitest";
import { marketRules, runTwap, validateLimitOrder, type TwapEvent } from "../../src";
import { LambdaplexClient } from "../../src/server";

const client = new LambdaplexClient({
  apiKey: process.env.LAMBDAPLEX_API_KEY,
  privateKey: process.env.LAMBDAPLEX_PRIVATE_KEY,
});

describe("Lambdaplex public API", { timeout: 60_000 }, () => {
  it("lists HBAR-USDC with parseable rules", async () => {
    const info = await client.exchangeInfo();
    const hbar = info.exchangeSymbols.find(s => s.symbol === "HBAR-USDC");
    expect(hbar?.status).toBe("TRADING");
    expect(marketRules(hbar!).quoteAsset).toBe("USDC");
  });

  it("serves a book whose best bid is below its best ask", async () => {
    const book = await client.depth("HBAR-USDC", 5);
    if (book.bids.length && book.asks.length) expect(Number(book.bids[0][0])).toBeLessThan(Number(book.asks[0][0]));
  });

  it("plans a full TWAP against live data without placing orders", async () => {
    const events: TwapEvent[] = [];
    await runTwap(
      client,
      { symbol: "HBAR-USDC", side: "BUY", total: "10", slices: 2, intervalSeconds: 0, maxSlippageBps: 50 },
      { dryRun: true, onEvent: event => void events.push(event), sleep: async () => {} },
    );
    expect(events.at(-1)?.type).toBe("done");
    expect(events.some(e => e.type === "order-placed")).toBe(false);
  });

  it("accepts a limit order built from live market data", async () => {
    const [info, book] = await Promise.all([client.exchangeInfo(), client.depth("HBAR-USDC", 5)]);
    const rules = marketRules(info.exchangeSymbols.find(s => s.symbol === "HBAR-USDC")!);
    const ask = book.asks[0]?.[0];
    if (!ask) return;
    expect(validateLimitOrder(rules, { side: "BUY", price: ask, quantity: "100" }, ask)).toEqual([]);
  });

  it.runIf(client.canTrade)("authenticates a signed account request", async () => {
    const account = await client.account();
    expect(Array.isArray(account.balances)).toBe(true);
  });
});
