import { cmp, mul, toUnits } from "./decimal";
import type { ExchangeSymbol, OrderSide } from "./types";

/** The trading rules of one market, flattened from `exchangeInfo` filters. */
export type MarketRules = {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  tickSize: string;
  minPrice: string;
  stepSize: string;
  minQty: string;
  minNotional: string;
  /** Allowed limit-price band relative to the reference price, per side. */
  bidMultiplierDown: string;
  bidMultiplierUp: string;
  askMultiplierDown: string;
  askMultiplierUp: string;
};

function filter(info: ExchangeSymbol, type: string): Record<string, unknown> {
  const found = info.filters.find(f => f.filterType === type);
  if (!found) throw new Error(`${info.symbol} has no ${type} filter`);
  return found;
}

export function marketRules(info: ExchangeSymbol): MarketRules {
  const price = filter(info, "PRICE_FILTER");
  const lot = filter(info, "LOT_SIZE");
  const notional = filter(info, "MIN_NOTIONAL");
  const band: Record<string, unknown> = info.filters.find(f => f.filterType === "PERCENT_PRICE_BY_SIDE") ?? {};
  return {
    symbol: info.symbol,
    baseAsset: info.baseAsset,
    quoteAsset: info.quoteAsset,
    tickSize: String(price.tickSize),
    minPrice: String(price.minPrice),
    stepSize: String(lot.stepSize),
    minQty: String(lot.minQty),
    minNotional: String(notional.minNotional),
    bidMultiplierDown: String(band.bidMultiplierDown ?? "0"),
    bidMultiplierUp: String(band.bidMultiplierUp ?? "0"),
    askMultiplierDown: String(band.askMultiplierDown ?? "0"),
    askMultiplierUp: String(band.askMultiplierUp ?? "0"),
  };
}

const isMultipleOf = (value: string, step: string) => toUnits(step) === 0n || toUnits(value) % toUnits(step) === 0n;

/**
 * Checks a LIMIT order against the market's rules before it is sent, so users get a precise message instead of an
 * exchange rejection. `referencePrice` enables the percent-price band check. Returns human-readable problems.
 */
export function validateLimitOrder(
  rules: MarketRules,
  order: { side: OrderSide; price: string; quantity: string },
  referencePrice?: string,
): string[] {
  const problems: string[] = [];
  if (cmp(order.price, rules.minPrice) < 0) problems.push(`Price must be at least ${rules.minPrice}.`);
  if (!isMultipleOf(order.price, rules.tickSize)) problems.push(`Price must be a multiple of ${rules.tickSize}.`);
  if (cmp(order.quantity, rules.minQty) < 0) problems.push(`Quantity must be at least ${rules.minQty}.`);
  if (!isMultipleOf(order.quantity, rules.stepSize)) problems.push(`Quantity must be a multiple of ${rules.stepSize}.`);

  const notional = mul(order.price, order.quantity);
  if (cmp(notional, rules.minNotional) < 0) {
    problems.push(`Order value ${notional} ${rules.quoteAsset} is below the ${rules.minNotional} minimum.`);
  }

  if (referencePrice && cmp(referencePrice, "0") > 0) {
    const [down, up] =
      order.side === "BUY"
        ? [rules.bidMultiplierDown, rules.bidMultiplierUp]
        : [rules.askMultiplierDown, rules.askMultiplierUp];
    const low = mul(referencePrice, down);
    const high = mul(referencePrice, up);
    if (cmp(down, "0") > 0 && cmp(order.price, low) < 0) problems.push(`Price is below the allowed band (${low}).`);
    if (cmp(up, "0") > 0 && cmp(order.price, high) > 0) problems.push(`Price is above the allowed band (${high}).`);
  }
  return problems;
}
