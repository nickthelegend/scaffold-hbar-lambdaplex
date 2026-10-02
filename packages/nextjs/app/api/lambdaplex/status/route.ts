import { NextResponse } from "next/server";
import { configError, lambdaplex, trackRecordTopicId, tradingEnabled } from "~~/lib/lambdaplex.server";

export const dynamic = "force-dynamic";

/** What this deployment can do, so the UI can explain disabled controls. */
export function GET() {
  return NextResponse.json({
    tradingEnabled: tradingEnabled(),
    hasCredentials: lambdaplex.canTrade,
    configError: configError() ?? null,
    trackRecordTopicId: trackRecordTopicId() ?? null,
    trackRecordNetwork: process.env.HEDERA_NETWORK === "mainnet" ? "mainnet" : "testnet",
  });
}
