import { NextResponse } from "next/server";
import { configError, tradingEnabled } from "~~/lib/lambdaplex.server";

export const dynamic = "force-dynamic";

/** Liveness probe for hosting and the harness smoke test. Stays 200 when trading config is broken, and says why. */
export function GET() {
  const problem = configError();
  return NextResponse.json({
    ok: true,
    tradingEnabled: tradingEnabled(),
    ...(problem ? { configError: problem } : {}),
  });
}
