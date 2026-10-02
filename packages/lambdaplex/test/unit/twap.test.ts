import { describe, expect, it } from "vitest";
import { marketRules } from "../../src/filters";
import { planSlice, planSlices, referencePrice, slicePrice, type TwapConfig } from "../../src/twap";
import type { ExchangeInfo } from "../../src/types";
import exchangeInfo from "../fixtures/exchangeInfo.json";

const rules = marketRules((exchangeInfo as ExchangeInfo).exchangeSymbols.find(s => s.symbol === "HBAR-USDC")!);
const buy: TwapConfig = {
  symbol: "HBAR-USDC",
  side: "BUY",
  total: "20",
  slices: 4,
  intervalSeconds: 60,
  maxSlippageBps: 50,
};

describe("TWAP planning", () => {
  it("splits the total exactly", () => {
    expect(planSlices("20", 4)).toEqual(["5", "5", "5", "5"]);
    expect(planSlices("10", 3)).toEqual(["3.333333333333333333", "3.333333333333333333", "3.333333333333333334"]);
    expect(() => planSlices("10", 0)).toThrow();
  });

  it("takes the best opposite price as reference", () => {
    const book = { lastUpdateId: 1, bids: [["0.0987", "454"]], asks: [["0.1010", "454"]] } as never;
    expect(referencePrice(book, "BUY")).toBe("0.1010");
    expect(referencePrice(book, "SELL")).toBe("0.0987");
    expect(referencePrice({ lastUpdateId: 1, bids: [], asks: [] }, "BUY")).toBeUndefined();
  });

  it("caps the limit price at the slippage bound, rounded inside it", () => {
    expect(slicePrice("0.101057", "BUY", 50, "0.000001")).toBe("0.101562");
    expect(slicePrice("0.098757", "SELL", 50, "0.000001")).toBe("0.098264");
  });

  it("sizes a BUY slice in whole HBAR within the quote budget", () => {
    const plan = planSlice(rules, { ...buy, total: "10" }, "10", "0.101057");
    expect(plan).toEqual({ kind: "order", price: "0.101562", quantity: "98", notional: "9.953076" });
  });

  it("rolls a slice over when it is below the exchange minimum", () => {
    const plan = planSlice(rules, buy, "4", "0.101057");
    expect(plan.kind).toBe("skip");
  });

  it("sizes a SELL slice in base units", () => {
    const plan = planSlice(rules, { ...buy, side: "SELL" }, "60.7", "0.098757");
    expect(plan).toEqual({ kind: "order", price: "0.098264", quantity: "60", notional: "5.89584" });
  });
});
