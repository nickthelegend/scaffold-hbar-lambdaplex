"use client";

import Link from "next/link";
import { useMarkets } from "~~/hooks/lambdaplex/useMarkets";
import { formatAmount } from "~~/utils/lambdaplex/format";

export const MarketsTable = () => {
  const { data: markets, isLoading, error } = useMarkets();

  if (isLoading) return <div className="h-64 rounded-2xl bg-base-200 animate-pulse" aria-label="Loading markets" />;
  if (error) return <p className="text-error">Could not reach Lambdaplex: {error.message}</p>;

  return (
    <div className="overflow-x-auto rounded-2xl border border-base-300 bg-base-100">
      <table className="table">
        <thead>
          <tr>
            <th>Market</th>
            <th className="text-right">Last price</th>
            <th className="text-right">Tick</th>
            <th className="text-right">Min order</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {markets?.map(m => (
            <tr key={m.symbol} className="hover">
              <td>
                <span className="font-semibold">{m.baseAsset}</span>
                <span className="text-base-content/50">/{m.quoteAsset}</span>
              </td>
              <td className="text-right tabular-nums">{m.lastPrice ? formatAmount(m.lastPrice, 8) : "—"}</td>
              <td className="text-right tabular-nums text-base-content/70">{formatAmount(m.tickSize, 12)}</td>
              <td className="text-right tabular-nums text-base-content/70">
                {formatAmount(m.minNotional)} {m.quoteAsset}
              </td>
              <td className="text-right">
                <Link className="btn btn-sm btn-primary" href={`/trade/${m.symbol}`}>
                  Trade
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
