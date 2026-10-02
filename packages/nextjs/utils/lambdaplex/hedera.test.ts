import { describe, expect, it } from "vitest";
import { decodeTopicMessages, hashscan } from "~~/utils/lambdaplex/hedera";

const entry = {
  v: 1,
  strategy: "twap-hbar",
  venue: "lambdaplex",
  symbol: "HBAR-USDC",
  side: "BUY",
  orderId: "o-1",
  clientOrderId: "twap-abc-0",
  price: "0.101057",
  qty: "49",
  quoteQty: "4.951793",
  commission: "0.0049",
  commissionAsset: "HBAR",
  time: 1790969771400,
  settlementTx: "0.0.10599377@1790969771.4",
};
const base64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

describe("track record decoding", () => {
  it("decodes mirror-node topic messages and skips anything that is not a v1 entry", () => {
    const record = decodeTopicMessages([
      {
        sequence_number: 1,
        consensus_timestamp: "1.1",
        payer_account_id: "0.0.7",
        message: base64(JSON.stringify(entry)),
      },
      { sequence_number: 2, consensus_timestamp: "1.2", payer_account_id: "0.0.7", message: base64("hello") },
      {
        sequence_number: 3,
        consensus_timestamp: "1.3",
        payer_account_id: "0.0.7",
        message: base64(JSON.stringify({ ...entry, v: 2 })),
      },
    ]);
    expect(record).toHaveLength(1);
    expect(record[0]).toMatchObject({ sequenceNumber: 1, payer: "0.0.7", entry: { qty: "49", side: "BUY" } });
  });

  it("links to HashScan", () => {
    expect(hashscan("mainnet", "transaction", "0.0.1@2.3")).toBe("https://hashscan.io/mainnet/transaction/0.0.1@2.3");
  });
});
