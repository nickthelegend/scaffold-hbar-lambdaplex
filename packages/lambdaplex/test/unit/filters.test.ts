import { describe, expect, it } from "vitest";
import { marketRules, validateLimitOrder, validateMarketOrder } from "../../src/filters";
import type { ExchangeInfo } from "../../src/types";
import exchangeInfo from "../fixtures/exchangeInfo.json";

// Captured from https://api.lambdaplex.io/api/v1/exchangeInfo.
const hbar = (exchangeInfo as ExchangeInfo).exchangeSymbols.find(s => s.symbol === "HBAR-USDC")!;
const rules = marketRules(hbar);

describe("market rules", () => {
  it("flattens the HBAR-USDC filters", () => {
    expect(rules).toMatchObject({
      baseAsset: "HBAR",
      quoteAsset: "USDC",
      tickSize: "0.000001",
      stepSize: "1",
      minQty: "1",
      minNotional: "5",
    });
  });

  it("accepts a valid order", () => {
    expect(validateLimitOrder(rules, { side: "BUY", price: "0.1005", quantity: "60" }, "0.1")).toEqual([]);
  });

  it("explains every rule an order breaks", () => {
    const problems = validateLimitOrder(rules, { side: "BUY", price: "0.10000005", quantity: "10.5" }, "0.1");
    expect(problems).toEqual([
      "Price must be a multiple of 0.000001.",
      "Quantity must be a multiple of 1.",
      "Order value 1.050000525 USDC is below the 5 minimum.",
    ]);
  });

  it("enforces the percent-price band per side", () => {
    expect(validateLimitOrder(rules, { side: "BUY", price: "0.13", quantity: "100" }, "0.1")).toContain(
      "Price is above the allowed band (0.12).",
    );
    expect(validateLimitOrder(rules, { side: "SELL", price: "0.07", quantity: "100" }, "0.1")).toContain(
      "Price is below the allowed band (0.08).",
    );
  });

  it("checks MARKET orders for lot size and approximate notional", () => {
    expect(validateMarketOrder(rules, { quantity: "100" }, "0.1")).toEqual([]);
    expect(validateMarketOrder(rules, { quantity: "1.5" }, "0.1").join(" ")).toMatch(/multiple of 1/);
    expect(validateMarketOrder(rules, { quantity: "10" }, "0.1").join(" ")).toMatch(/below the 5 minimum/);
    expect(validateMarketOrder(rules, { quantity: "10" })).toEqual([]);
  });
});
