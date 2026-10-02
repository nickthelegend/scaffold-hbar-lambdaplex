import { NextResponse } from "next/server";
import { AccountId, Client, PrivateKey } from "@hiero-ledger/sdk";
import { LambdaplexClient, LambdaplexError } from "@sh/lambdaplex/server";
import "server-only";

/**
 * Server-only Lambdaplex access. The API key and its Ed25519 private key live in server env vars and are used here to
 * sign requests; they never reach the browser. Trading routes refuse to run unless TRADING_ENABLED=true, so a hosted
 * read-only demo can't place orders even if keys are present.
 */
export const lambdaplex = new LambdaplexClient({
  baseUrl: process.env.LAMBDAPLEX_API_BASE,
  apiKey: process.env.LAMBDAPLEX_API_KEY,
  privateKey: process.env.LAMBDAPLEX_PRIVATE_KEY,
});

export const tradingEnabled = () => process.env.TRADING_ENABLED === "true" && lambdaplex.canTrade;

export const trackRecordTopicId = () => process.env.TRACK_RECORD_TOPIC_ID || undefined;

/** Hedera client that publishes the track record, if an operator is configured. */
export function hederaPublisher(): Client | undefined {
  const { HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY, HEDERA_NETWORK } = process.env;
  if (!HEDERA_OPERATOR_ID || !HEDERA_OPERATOR_KEY || !trackRecordTopicId()) return undefined;
  const client = HEDERA_NETWORK === "mainnet" ? Client.forMainnet() : Client.forTestnet();
  return client.setOperator(AccountId.fromString(HEDERA_OPERATOR_ID), PrivateKey.fromStringECDSA(HEDERA_OPERATOR_KEY));
}

export const tradingDisabledResponse = () =>
  NextResponse.json(
    {
      error: "Trading is disabled on this deployment",
      hint: "Set LAMBDAPLEX_API_KEY, LAMBDAPLEX_PRIVATE_KEY and TRADING_ENABLED=true in packages/nextjs/.env.local",
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
