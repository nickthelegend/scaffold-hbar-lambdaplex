import { type NextRequest, NextResponse } from "next/server";
import { type TwapConfig, validateTwapConfig } from "@sh/lambdaplex";
import { errorResponse, rejectCrossSite, tradingDisabledResponse, tradingEnabled } from "~~/lib/lambdaplex.server";
import { JobLimitError, listJobs, startJob } from "~~/lib/twapJobs.server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(listJobs());
}

type StartBody = Partial<TwapConfig> & { live?: boolean };

/** Starts a TWAP job. Dry runs are always allowed: they plan every slice against live data and place nothing. */
export async function POST(req: NextRequest) {
  const refused = rejectCrossSite(req, { requireJson: true });
  if (refused) return refused;
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

  const config: TwapConfig = {
    symbol: body.symbol!,
    side: body.side!,
    total: body.total!,
    slices,
    intervalSeconds,
    maxSlippageBps,
  };
  const problems = validateTwapConfig(config);
  if (problems.length) return NextResponse.json({ error: problems.join("; ") }, { status: 400 });

  try {
    return NextResponse.json(startJob(config, live), { status: 201 });
  } catch (error) {
    if (error instanceof JobLimitError) return NextResponse.json({ error: error.message }, { status: 429 });
    return errorResponse(error);
  }
}
