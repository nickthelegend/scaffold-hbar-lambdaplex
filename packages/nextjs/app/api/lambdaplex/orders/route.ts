import { type NextRequest, NextResponse } from "next/server";
import { type OrderSide, marketRules, validateLimitOrder, validateMarketOrder } from "@sh/lambdaplex";
import { randomUUID } from "node:crypto";
import {
  errorResponse,
  lambdaplex,
  rejectCrossSite,
  tradingDisabledResponse,
  tradingEnabled,
} from "~~/lib/lambdaplex.server";

export const dynamic = "force-dynamic";

const SYMBOL_RE = /^[A-Za-z0-9]{1,20}-[A-Za-z0-9]{1,20}$/;
const DECIMAL_RE = /^\d+(\.\d+)?$/;

export async function GET(req: NextRequest) {
  if (!tradingEnabled()) return tradingDisabledResponse();
  const symbol = req.nextUrl.searchParams.get("symbol");
  if (!symbol || !SYMBOL_RE.test(symbol)) return NextResponse.json({ error: "Invalid symbol" }, { status: 400 });
  try {
    return NextResponse.json(await lambdaplex.openOrders(symbol));
  } catch (error) {
    return errorResponse(error);
  }
}

type PlaceOrderBody = {
  symbol?: string;
  side?: OrderSide;
  type?: "LIMIT" | "MARKET";
  price?: string;
  quantity?: string;
};

/** Places a LIMIT (GTC) or MARKET order after validating it against the market's live rules. Same-origin JSON only. */
export async function POST(req: NextRequest) {
  if (!tradingEnabled()) return tradingDisabledResponse();
  const refused = rejectCrossSite(req, { requireJson: true });
  if (refused) return refused;
  const body = (await req.json().catch(() => null)) as PlaceOrderBody | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Send the order as a JSON object." }, { status: 400 });
  }
  const { symbol, side, type, price, quantity } = body;

  if (!symbol || !SYMBOL_RE.test(symbol)) return NextResponse.json({ error: "Invalid symbol" }, { status: 400 });
  if (side !== "BUY" && side !== "SELL")
    return NextResponse.json({ error: "side must be BUY or SELL" }, { status: 400 });
  if (type !== "LIMIT" && type !== "MARKET")
    return NextResponse.json({ error: "type must be LIMIT or MARKET" }, { status: 400 });
  if (!quantity || !DECIMAL_RE.test(quantity)) return NextResponse.json({ error: "Invalid quantity" }, { status: 400 });
  if (type === "LIMIT" && (!price || !DECIMAL_RE.test(price))) {
    return NextResponse.json({ error: "Invalid price" }, { status: 400 });
  }

  try {
    const [info, book] = await Promise.all([lambdaplex.exchangeInfo(), lambdaplex.depth(symbol, 1)]);
    const market = info.exchangeSymbols.find(s => s.symbol === symbol);
    if (!market) return NextResponse.json({ error: `Unknown market ${symbol}` }, { status: 400 });
    const reference = side === "BUY" ? book.asks[0]?.[0] : book.bids[0]?.[0];
    const rules = marketRules(market);
    const problems =
      type === "LIMIT"
        ? validateLimitOrder(rules, { side, price: price!, quantity }, reference)
        : validateMarketOrder(rules, { quantity }, reference);
    if (problems.length) return NextResponse.json({ error: problems.join(" ") }, { status: 400 });

    const ack = await lambdaplex.placeOrder({
      symbol,
      side,
      type,
      quantity,
      price: type === "LIMIT" ? price : undefined,
      timeInForce: type === "LIMIT" ? "GTC" : undefined,
      newClientOrderId: `web-${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    });
    return NextResponse.json(ack);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(req: NextRequest) {
  if (!tradingEnabled()) return tradingDisabledResponse();
  const refused = rejectCrossSite(req);
  if (refused) return refused;
  const symbol = req.nextUrl.searchParams.get("symbol");
  const orderId = req.nextUrl.searchParams.get("orderId");
  if (!symbol || !SYMBOL_RE.test(symbol) || !orderId) {
    return NextResponse.json({ error: "symbol and orderId are required" }, { status: 400 });
  }
  try {
    return NextResponse.json(await lambdaplex.cancelOrder(symbol, orderId));
  } catch (error) {
    return errorResponse(error);
  }
}
