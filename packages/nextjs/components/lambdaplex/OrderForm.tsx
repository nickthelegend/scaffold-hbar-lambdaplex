"use client";

import { useEffect, useState } from "react";
import { type MarketRules, type OrderSide, mul, validateLimitOrder } from "@sh/lambdaplex";
import { useQueryClient } from "@tanstack/react-query";
import { useTradingStatus } from "~~/hooks/lambdaplex/useTradingStatus";
import { serverApi } from "~~/utils/lambdaplex/api";
import { formatAmount } from "~~/utils/lambdaplex/format";
import { notification } from "~~/utils/scaffold-hbar";

type Props = { rules: MarketRules; bestBid?: string; bestAsk?: string; pickedPrice?: string };

/**
 * Limit/market order entry. Validates against the market's tick, lot, minimum-notional and price-band rules before
 * sending, so mistakes are explained here instead of rejected by the exchange.
 */
export const OrderForm = ({ rules, bestBid, bestAsk, pickedPrice }: Props) => {
  const { data: status } = useTradingStatus();
  const queryClient = useQueryClient();
  const [side, setSide] = useState<OrderSide>("BUY");
  const [type, setType] = useState<"LIMIT" | "MARKET">("LIMIT");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (pickedPrice) setPrice(pickedPrice);
  }, [pickedPrice]);

  const reference = side === "BUY" ? bestAsk : bestBid;
  const numeric = (v: string) => /^\d+(\.\d+)?$/.test(v);
  const ready = numeric(quantity) && (type === "MARKET" || numeric(price));
  const problems = ready && type === "LIMIT" ? validateLimitOrder(rules, { side, price, quantity }, reference) : [];
  const notional = ready && type === "LIMIT" ? mul(price, quantity) : undefined;
  const disabled = !status?.tradingEnabled;

  const submit = async () => {
    setSubmitting(true);
    try {
      const ack = await serverApi.post<{ orderId: string }>("/api/lambdaplex/orders", {
        symbol: rules.symbol,
        side,
        type,
        price: type === "LIMIT" ? price : undefined,
        quantity,
      });
      notification.success(`Order ${ack.orderId.slice(0, 8)}… accepted`);
      setQuantity("");
      await queryClient.invalidateQueries({ queryKey: ["lambdaplex"] });
    } catch (error) {
      notification.error(error instanceof Error ? error.message : "Order failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={e => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="join w-full" role="radiogroup" aria-label="Side">
        {(["BUY", "SELL"] as const).map(s => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={side === s}
            className={`btn join-item flex-1 ${side === s ? (s === "BUY" ? "btn-success" : "btn-error") : ""}`}
            onClick={() => setSide(s)}
          >
            {s === "BUY" ? "Buy" : "Sell"} {rules.baseAsset}
          </button>
        ))}
      </div>

      <div role="tablist" className="tabs tabs-box tabs-sm">
        {(["LIMIT", "MARKET"] as const).map(t => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={type === t}
            className={`tab flex-1 ${type === t ? "tab-active" : ""}`}
            onClick={() => setType(t)}
          >
            {t === "LIMIT" ? "Limit" : "Market"}
          </button>
        ))}
      </div>

      {type === "LIMIT" && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="flex justify-between">
            Price ({rules.quoteAsset})
            {reference && (
              <button type="button" className="link link-primary text-xs" onClick={() => setPrice(reference)}>
                Best {side === "BUY" ? "ask" : "bid"} {formatAmount(reference, 8)}
              </button>
            )}
          </span>
          <input
            className="input input-bordered w-full tabular-nums"
            inputMode="decimal"
            value={price}
            onChange={e => setPrice(e.target.value.trim())}
            placeholder={reference ?? "0.0"}
          />
        </label>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span>Quantity ({rules.baseAsset})</span>
        <input
          className="input input-bordered w-full tabular-nums"
          inputMode="decimal"
          value={quantity}
          onChange={e => setQuantity(e.target.value.trim())}
          placeholder={`min ${rules.minQty}, step ${rules.stepSize}`}
        />
      </label>

      <div className="min-h-10 text-sm" aria-live="polite">
        {problems.length > 0 ? (
          <ul className="m-0 pl-4 text-error">
            {problems.map(p => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : notional ? (
          <p className="m-0 text-base-content/70">
            Total ≈ {formatAmount(notional)} {rules.quoteAsset}
          </p>
        ) : type === "MARKET" ? (
          <p className="m-0 text-base-content/70">Fills immediately against the book at the best available prices.</p>
        ) : null}
      </div>

      <button
        type="submit"
        className={`btn ${side === "BUY" ? "btn-success" : "btn-error"}`}
        disabled={disabled || !ready || problems.length > 0 || submitting}
      >
        {submitting ? (
          <span className="loading loading-spinner loading-sm" />
        ) : (
          `${side === "BUY" ? "Buy" : "Sell"} ${rules.baseAsset}`
        )}
      </button>
      {disabled && (
        <p className="m-0 text-xs text-base-content/60">Trading is disabled on this deployment (read-only).</p>
      )}
    </form>
  );
};
