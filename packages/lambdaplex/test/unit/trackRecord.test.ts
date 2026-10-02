import { describe, expect, it } from "vitest";
import { decodeEntry, encodeEntry, entryFromFill, mirrorTransactionId, summarize } from "../../src/trackRecord";
import type { Fill } from "../../src/types";

const fill: Fill = {
  cursorId: 1,
  orderId: "5d0c1c8e-1b8f-4a39-9a54-6c4f2a5b9d10",
  price: 0.101057,
  qty: "49",
  quoteQty: "4.951793",
  commission: "0.0049",
  commissionAsset: "HBAR",
  time: 1790969771400,
  isBuyer: true,
  isMaker: false,
  settlementTransactionId: "0.0.10599377@1790969771.4",
};

describe("track record", () => {
  const entry = entryFromFill("twap-hbar", "HBAR-USDC", "BUY", "twap-abc-0", fill);

  it("round-trips through the HCS message format", () => {
    expect(decodeEntry(encodeEntry(entry))).toEqual(entry);
    expect(entry.price).toBe("0.101057");
  });

  it("rejects messages that are not v1 entries", () => {
    expect(decodeEntry("not json")).toBeNull();
    expect(decodeEntry(JSON.stringify({ ...entry, v: 2 }))).toBeNull();
    expect(decodeEntry(JSON.stringify({ ...entry, side: "HOLD" }))).toBeNull();
    expect(decodeEntry(JSON.stringify({ ...entry, qty: 49 }))).toBeNull();
    expect(decodeEntry(JSON.stringify({ ...entry, qty: "abc" }))).toBeNull();
    expect(decodeEntry(JSON.stringify({ ...entry, price: "1e-7" }))).toBeNull();
    expect(decodeEntry(JSON.stringify({ ...entry, quoteQty: "-1" }))).toBeNull();
    expect(decodeEntry(JSON.stringify({ ...entry, commission: "" }))).toBeNull();
  });

  it("writes number amounts as plain decimals", () => {
    const tiny = entryFromFill("s", "HBAR-USDC", "BUY", "c", { ...fill, commission: 1e-7 });
    expect(tiny.commission).toBe("0.0000001");
    expect(decodeEntry(encodeEntry(tiny))).toEqual(tiny);
  });

  it("maps Hedera transaction ids to mirror node paths", () => {
    expect(mirrorTransactionId("0.0.10599377@1790969771.4")).toBe("0.0.10599377-1790969771-400000000");
    expect(mirrorTransactionId("0.0.2@1700000000.000000123")).toBe("0.0.2-1700000000-000000123");
    expect(() => mirrorTransactionId("0xabc")).toThrow();
  });

  it("summarises exact totals and average prices", () => {
    const second = entryFromFill("twap-hbar", "HBAR-USDC", "BUY", "twap-abc-1", {
      ...fill,
      qty: "51",
      quoteQty: "5.2",
    });
    expect(summarize([entry, second])).toMatchObject({
      fills: 2,
      bought: "100",
      spent: "10.151793",
      averageBuyPrice: "0.10151793",
      sold: "0",
    });
  });
});
