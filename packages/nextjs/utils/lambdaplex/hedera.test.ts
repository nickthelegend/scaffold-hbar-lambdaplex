import { describe, expect, it } from "vitest";
import { decodeTopicMessages, hashscan, mirrorNextUrl } from "~~/utils/lambdaplex/hedera";

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

  it("skips entries whose amounts are not plain decimals", () => {
    const record = decodeTopicMessages([
      {
        sequence_number: 1,
        consensus_timestamp: "1.1",
        payer_account_id: "0.0.7",
        message: base64(JSON.stringify({ ...entry, qty: "abc" })),
      },
      {
        sequence_number: 2,
        consensus_timestamp: "1.2",
        payer_account_id: "0.0.7",
        message: base64(JSON.stringify({ ...entry, price: "1e-7" })),
      },
    ]);
    expect(record).toHaveLength(0);
  });

  it("follows the mirror node's next link on the same host", () => {
    expect(mirrorNextUrl("testnet", "/api/v1/topics/0.0.5/messages?limit=100&timestamp=gt:1.2")).toBe(
      "https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.5/messages?limit=100&timestamp=gt:1.2",
    );
    expect(mirrorNextUrl("mainnet", null)).toBeNull();
  });

  it("links to HashScan", () => {
    expect(hashscan("mainnet", "transaction", "0.0.1@2.3")).toBe("https://hashscan.io/mainnet/transaction/0.0.1@2.3");
  });
});
