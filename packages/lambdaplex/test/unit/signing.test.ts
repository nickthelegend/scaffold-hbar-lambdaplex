import { describe, expect, it } from "vitest";
import { loadEd25519Key, signedQuery, signV1, signV2Headers, v2CanonicalText } from "../../src/signing";

// Vectors published in Lambdaplex's Hummingbot connector tests (hummingbot/connector/exchange/lambdaplex).
const HUMMINGBOT_KEY = "MC4CAQAwBQYDK2VwBCIEIJETIXjnIFeh11KAJZVv45sLhH8gCrWbL902cBfzCHE3";

describe("Signature V1", () => {
  const key = loadEd25519Key(HUMMINGBOT_KEY);

  it("matches the connector's POST /order vector", () => {
    const signature = signV1(
      [
        ["symbol", "COINALPHA-HBOT"],
        ["side", "BUY"],
        ["type", "LIMIT"],
        ["timeInForce", "GTC"],
        ["quantity", 1],
        ["price", 0.1],
        ["recvWindow", 5000],
        ["timestamp", 1234567890000],
      ],
      key,
    );
    expect(signature).toBe("GS+fJUXk9pjSy6aSlWTjifeY0tiDHskJvU5aKSAhCwW0H4OwO+6tQs8D0gzOstbfbqXytldeSZvicvq9Zvs9CQ==");
  });

  it("matches the connector's DELETE /order vector", () => {
    const signature = signV1(
      [
        ["symbol", "COINALPHA-HBOT"],
        ["origClientOrderId", "1"],
        ["recvWindow", 5000],
        ["timestamp", 1234567890000],
      ],
      key,
    );
    expect(signature).toBe("kBnh8DMwdJ1DDlmdLxSMyEsyyWf0Rvh0RsT40G+CRxYFDvOgUGF4iBHKMZJEBQyiy2qoAKBQ6GPZ5lt2EEpWAw==");
  });

  it("matches the connector's GET /account vector (Python serialises True as 'True')", () => {
    const signature = signV1(
      [
        ["omitZeroBalances", "True"],
        ["recvWindow", 5000],
        ["timestamp", 1234567890000],
      ],
      key,
    );
    expect(signature).toBe("MtKBw3pFM/Rbw5kmwEeux6L0DlJG1g0EcyNCbc/gc6XYFYbxfe6c0OrxL+6IT7WllJIGZN3MfmfxXG0l+4iXAQ==");
  });

  it("builds the query in send order with recvWindow, timestamp and an encoded signature last", () => {
    const query = signedQuery(
      [
        ["symbol", "COINALPHA-HBOT"],
        ["origClientOrderId", "1"],
      ],
      key,
      { timestamp: 1234567890000 },
    );
    expect(query).toBe(
      "symbol=COINALPHA-HBOT&origClientOrderId=1&recvWindow=5000&timestamp=1234567890000&signature=" +
        encodeURIComponent("kBnh8DMwdJ1DDlmdLxSMyEsyyWf0Rvh0RsT40G+CRxYFDvOgUGF4iBHKMZJEBQyiy2qoAKBQ6GPZ5lt2EEpWAw=="),
    );
  });

  it("loads the same key from PEM and from a raw hex seed", () => {
    const pem = `-----BEGIN PRIVATE KEY-----\n${HUMMINGBOT_KEY}\n-----END PRIVATE KEY-----`;
    const seed = Buffer.from(HUMMINGBOT_KEY, "base64").subarray(16).toString("hex");
    const params: Array<[string, string]> = [["a", "1"]];
    expect(signV1(params, loadEd25519Key(pem))).toBe(signV1(params, key));
    expect(signV1(params, loadEd25519Key(seed))).toBe(signV1(params, key));
  });
});

// Deterministic vector published in the Lambdaplex API docs (Bots → bot withdrawals).
describe("Signature V2", () => {
  const body =
    '{"clientWithdrawalId":"accountant-2026-07-23T20:00Z","transfers":[{"asset":"HBAR","amount":"123.5"},{"asset":"USDC","amount":"400"},{"asset":"0.0.789012","amount":"0.0001"}]}';
  const request = {
    apiKey: "lp_example_bot_key",
    method: "POST",
    rawPath: "/api/v1/bot/withdrawals",
    timestamp: 1784832000123,
    recvWindow: 5000,
    body,
  };

  it("builds the 147-byte canonical text", () => {
    const canonical = v2CanonicalText(request);
    expect(Buffer.byteLength(body)).toBe(174);
    expect(Buffer.byteLength(canonical)).toBe(147);
    expect(canonical.endsWith("08b4bf5aa2a74824b03226f3277a248fc80d37acc8e1d5721464fba2a270cd02\n")).toBe(true);
  });

  it("produces the documented signature and headers", () => {
    const headers = signV2Headers(
      request,
      loadEd25519Key("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60"),
    );
    expect(headers["X-PLEX-SIGNATURE"]).toBe(
      "XFXlsg5++OyHm81DXCYg785515Jz1ecHtO9fJiZNEr3RXvkzB9FDcQmA7Q/uRlCK6JUVIphKY5I+OrV3UswqDQ==",
    );
    expect(headers["X-PLEX-CONTENT-SHA256"]).toBe("08b4bf5aa2a74824b03226f3277a248fc80d37acc8e1d5721464fba2a270cd02");
    expect(headers["X-PLEX-SIGNATURE-VERSION"]).toBe("2");
  });
});
