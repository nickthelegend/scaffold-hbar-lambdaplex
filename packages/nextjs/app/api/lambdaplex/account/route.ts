import { NextResponse } from "next/server";
import { errorResponse, lambdaplex, tradingDisabledResponse, tradingEnabled } from "~~/lib/lambdaplex.server";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!tradingEnabled()) return tradingDisabledResponse();
  try {
    const account = await lambdaplex.account();
    return NextResponse.json({ balances: account.balances });
  } catch (error) {
    return errorResponse(error);
  }
}
