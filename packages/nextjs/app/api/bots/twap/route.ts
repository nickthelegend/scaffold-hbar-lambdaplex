import { type NextRequest, NextResponse } from "next/server";
import type { TwapConfig } from "@sh/lambdaplex";
import { errorResponse, rejectCrossSite, tradingDisabledResponse, tradingEnabled } from "~~/lib/lambdaplex.server";
import { JobLimitError, listJobs, startJob } from "~~/lib/twapJobs.server";
import { webTwapProblems } from "~~/utils/lambdaplex/twapForm";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(listJobs());
}

type StartBody = Partial<TwapConfig> & { live?: boolean };

/** Starts a TWAP job. Dry runs are always allowed: they plan every slice against live data and place nothing. */
export async function POST(req: NextRequest) {
  const refused = rejectCrossSite(req, { requireJson: true });
  if (refused) return refused;
  const body = (await req.json().catch(() => null)) as StartBody | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Send the TWAP settings as a JSON object." }, { status: 400 });
  }
  const live = body.live === true;
  if (live && !tradingEnabled()) return tradingDisabledResponse();

  const config: TwapConfig = {
    symbol: typeof body.symbol === "string" ? body.symbol : "",
    side: body.side as TwapConfig["side"], // validated below
    total: typeof body.total === "string" ? body.total : "",
    slices: Number(body.slices),
    intervalSeconds: Number(body.intervalSeconds),
    maxSlippageBps: Number(body.maxSlippageBps),
  };
  // Same checks, same wording as the form, so a request that bypasses the UI gets the same explanation.
  const problems = webTwapProblems(config);
  if (problems.length) return NextResponse.json({ error: problems.join(" ") }, { status: 400 });

  try {
    return NextResponse.json(startJob(config, live), { status: 201 });
  } catch (error) {
    if (error instanceof JobLimitError) return NextResponse.json({ error: error.message }, { status: 429 });
    return errorResponse(error);
  }
}
