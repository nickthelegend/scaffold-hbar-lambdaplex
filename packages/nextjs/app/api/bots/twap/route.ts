import { type NextRequest, NextResponse } from "next/server";
import type { TwapConfig } from "@sh/lambdaplex";
import { tradingDisabledResponse, tradingEnabled } from "~~/lib/lambdaplex.server";
import { listJobs, startJob } from "~~/lib/twapJobs.server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(listJobs());
}

type StartBody = Partial<TwapConfig> & { live?: boolean };

/** Starts a TWAP job. Dry runs are always allowed: they plan every slice against live data and place nothing. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as StartBody;
  const live = body.live === true;
  if (live && !tradingEnabled()) return tradingDisabledResponse();

  const slices = Number(body.slices);
  const intervalSeconds = Number(body.intervalSeconds);
  const maxSlippageBps = Number(body.maxSlippageBps);
  const valid =
    typeof body.symbol === "string" &&
    /^[A-Za-z0-9]{1,20}-[A-Za-z0-9]{1,20}$/.test(body.symbol) &&
    (body.side === "BUY" || body.side === "SELL") &&
    typeof body.total === "string" &&
    /^\d+(\.\d+)?$/.test(body.total) &&
    Number.isInteger(slices) &&
    slices >= 1 &&
    slices <= 50 &&
    Number.isInteger(intervalSeconds) &&
    intervalSeconds >= 5 &&
    intervalSeconds <= 3600 &&
    Number.isInteger(maxSlippageBps) &&
    maxSlippageBps >= 0 &&
    maxSlippageBps <= 500;
  if (!valid) {
    return NextResponse.json(
      { error: "Invalid TWAP: symbol, side, total, slices 1-50, interval 5-3600 s, slippage 0-500 bps" },
      { status: 400 },
    );
  }

  const job = startJob(
    { symbol: body.symbol!, side: body.side!, total: body.total!, slices, intervalSeconds, maxSlippageBps },
    live,
  );
  return NextResponse.json(job, { status: 201 });
}
