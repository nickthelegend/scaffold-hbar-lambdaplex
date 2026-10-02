import { createHash, createPrivateKey, KeyObject, sign } from "node:crypto";

/**
 * Lambdaplex request signing. Server-side only: it needs the API key's Ed25519 private key.
 *
 * Signature V1 (orders, account, fills): the request parameters plus `recvWindow` and `timestamp`, in the order they
 * are sent, joined as `k1=v1&k2=v2`, signed with Ed25519 and sent base64-encoded as the `signature` parameter.
 * This is the scheme used by Lambdaplex's Hummingbot connector; our tests replay its published vectors.
 *
 * Signature V2 (bot withdrawals and other `Ed25519V2Sig` operations): a canonical text of the API key, method, raw
 * path, timestamp, receive window and body hash, signed and sent in `X-PLEX-*` headers.
 */

export type Ed25519Key = KeyObject;

// DER prefix of a PKCS#8 Ed25519 private key; the 32-byte seed follows it.
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/**
 * Accepts the key formats Lambdaplex and common tooling export: PEM, base64 PKCS#8 DER (what the Lambdaplex
 * dashboard and Hummingbot use), or a 32-byte hex seed.
 */
export function loadEd25519Key(input: string): Ed25519Key {
  const text = input.trim().replace(/\\n/g, "\n");
  if (text.includes("PRIVATE KEY")) return assertEd25519(createPrivateKey(text));

  const hex = text.replace(/^0x/, "");
  if (/^[0-9a-fA-F]{64}$/.test(hex)) {
    return createPrivateKey({
      key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(hex, "hex")]),
      format: "der",
      type: "pkcs8",
    });
  }

  const der = Buffer.from(text, "base64");
  if (der.length === 0) throw new Error("Lambdaplex private key is empty or not base64/PEM/hex");
  return assertEd25519(createPrivateKey({ key: der, format: "der", type: "pkcs8" }));
}

function assertEd25519(key: KeyObject): KeyObject {
  if (key.asymmetricKeyType !== "ed25519") throw new Error("Lambdaplex API keys must be Ed25519");
  return key;
}

export type ParamValue = string | number | boolean;

/** Parameters in send order. Order matters: the signature covers them exactly as serialised. */
export type OrderedParams = Array<[string, ParamValue]>;

/** The exact text that Signature V1 covers, e.g. `symbol=HBAR-USDC&side=BUY&recvWindow=5000&timestamp=…`. */
export function v1Payload(params: OrderedParams): string {
  return params.map(([key, value]) => `${key}=${String(value)}`).join("&");
}

export function signV1(params: OrderedParams, key: Ed25519Key): string {
  return sign(null, Buffer.from(v1Payload(params), "utf8"), key).toString("base64");
}

/**
 * Adds `recvWindow`, `timestamp` and `signature` and returns the query string to send. Values are URL-encoded on
 * the wire; the signature covers the decoded `k=v` text, as the server reconstructs it.
 */
export function signedQuery(
  params: OrderedParams,
  key: Ed25519Key,
  { timestamp, recvWindow = 5000 }: { timestamp: number; recvWindow?: number },
): string {
  const full: OrderedParams = [...params, ["recvWindow", recvWindow], ["timestamp", timestamp]];
  const signature = signV1(full, key);
  return [...full, ["signature", signature] as [string, string]]
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
}

export type V2Request = {
  apiKey: string;
  method: string;
  rawPath: string;
  timestamp: number;
  recvWindow: number;
  body: Uint8Array | string;
};

export function v2CanonicalText({ apiKey, method, rawPath, timestamp, recvWindow, body }: V2Request): string {
  const contentHash = createHash("sha256").update(body).digest("hex");
  return ["LPX-ED25519-V2", apiKey, method.toUpperCase(), rawPath, timestamp, recvWindow, contentHash, ""].join("\n");
}

/** Headers for a Signature V2 request. `body` must be the exact bytes sent (empty for a bodyless GET). */
export function signV2Headers(request: V2Request, key: Ed25519Key): Record<string, string> {
  const canonical = v2CanonicalText(request);
  return {
    "X-API-KEY": request.apiKey,
    "X-PLEX-SIGNATURE-VERSION": "2",
    "X-PLEX-TIMESTAMP": String(request.timestamp),
    "X-PLEX-RECV-WINDOW": String(request.recvWindow),
    "X-PLEX-CONTENT-SHA256": createHash("sha256").update(request.body).digest("hex"),
    "X-PLEX-SIGNATURE": sign(null, Buffer.from(canonical, "utf8"), key).toString("base64"),
  };
}
