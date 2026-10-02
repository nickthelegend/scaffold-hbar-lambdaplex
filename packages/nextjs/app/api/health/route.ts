import { NextResponse } from "next/server";
import { tradingEnabled } from "~~/lib/lambdaplex.server";

/** Liveness probe for hosting and the harness smoke test. */
export function GET() {
  return NextResponse.json({ ok: true, tradingEnabled: tradingEnabled() });
}
