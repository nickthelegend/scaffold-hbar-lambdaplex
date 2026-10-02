import { type NextRequest, NextResponse } from "next/server";
import { errorResponse, lambdaplex, tradingDisabledResponse, tradingEnabled } from "~~/lib/lambdaplex.server";

export const dynamic = "force-dynamic";

/** Settlement-final fills of one order, each with its Hedera settlement transaction id. */
export async function GET(req: NextRequest) {
  if (!tradingEnabled()) return tradingDisabledResponse();
  const symbol = req.nextUrl.searchParams.get("symbol");
  const orderId = req.nextUrl.searchParams.get("orderId");
  if (!symbol || !orderId) return NextResponse.json({ error: "symbol and orderId are required" }, { status: 400 });
  try {
    return NextResponse.json(await lambdaplex.orderFills(symbol, orderId));
  } catch (error) {
    return errorResponse(error);
  }
}
