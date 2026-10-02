import { type NextRequest, NextResponse } from "next/server";
import type { Client } from "@hiero-ledger/sdk";
import { LambdaplexClient, LambdaplexError, operatorClient } from "@sh/lambdaplex/server";
import "server-only";

/**
 * Server-only Lambdaplex access. The API key and its Ed25519 private key live in server env vars and are used here to
 * sign requests; they never reach the browser. Trading routes refuse to run unless TRADING_ENABLED=true, so a hosted
 * read-only demo can't place orders even if keys are present. The private key is parsed on first use, so a malformed
 * key disables trading (see `configError`) instead of breaking every route that imports this module.
 */
export const lambdaplex = new LambdaplexClient({
  baseUrl: process.env.LAMBDAPLEX_API_BASE,
  apiKey: process.env.LAMBDAPLEX_API_KEY,
  privateKey: process.env.LAMBDAPLEX_PRIVATE_KEY,
});

export const tradingEnabled = () => process.env.TRADING_ENABLED === "true" && lambdaplex.canTrade;

/** A configuration problem worth showing the operator, e.g. a malformed key. Never contains key material. */
export const configError = () => lambdaplex.configError;

export const trackRecordTopicId = () => process.env.TRACK_RECORD_TOPIC_ID || undefined;

/** Hedera client that publishes the track record, if an operator is configured. Throws on a malformed key. */
export function hederaPublisher(): Client | undefined {
  if (!trackRecordTopicId()) return undefined;
  try {
    return operatorClient(process.env);
  } catch {
    throw new Error(
      "HEDERA_OPERATOR_ID or HEDERA_OPERATOR_KEY could not be parsed (set HEDERA_OPERATOR_KEY_TYPE=ED25519 for raw ED25519 keys)",
    );
  }
}

/**
 * CSRF guard for state-changing routes. A browser always sends `Origin` on cross-site POST and DELETE, so a request
 * whose Origin names another host is refused. Requests without Origin (curl, server-side scripts) pass. POST bodies
 * must be `application/json`: a cross-site HTML form cannot send that content type without a CORS preflight.
 */
export function rejectCrossSite(req: NextRequest, { requireJson = false } = {}): NextResponse | undefined {
  const origin = req.headers.get("origin");
  // Behind a proxy (Railway) the public host arrives in X-Forwarded-Host; pages cannot set either header cross-site.
  const hosts = [req.headers.get("x-forwarded-host")?.split(",")[0]?.trim(), req.headers.get("host")].filter(Boolean);
  if (origin) {
    let originHost: string | undefined;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = undefined;
    }
    if (!originHost || !hosts.includes(originHost)) {
      return NextResponse.json({ error: "Cross-origin request refused" }, { status: 403 });
    }
  }
  if (req.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ error: "Cross-origin request refused" }, { status: 403 });
  }
  if (requireJson && !(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  return undefined;
}

export const tradingDisabledResponse = () =>
  NextResponse.json(
    {
      error: "Trading is disabled on this deployment",
      hint: "Set LAMBDAPLEX_API_KEY, LAMBDAPLEX_PRIVATE_KEY and TRADING_ENABLED=true in packages/nextjs/.env.local",
      ...(configError() ? { configError: configError() } : {}),
    },
    { status: 403 },
  );

/** Maps SDK errors to JSON responses without leaking request URLs (which carry signatures). */
export function errorResponse(error: unknown) {
  if (error instanceof LambdaplexError) {
    const status = error.status >= 400 && error.status < 600 ? error.status : 502;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }
  const message = error instanceof Error ? error.message : "Unexpected error";
  return NextResponse.json({ error: message }, { status: 500 });
}
