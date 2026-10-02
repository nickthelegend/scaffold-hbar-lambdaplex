"use client";

import type { PublicTrade } from "@sh/lambdaplex";
import { formatAmount, formatDateTime } from "~~/utils/lambdaplex/format";

export const TradesTape = ({ trades }: { trades?: PublicTrade[] }) => {
  if (!trades) return <div className="h-64 rounded-xl bg-base-200 animate-pulse" aria-label="Loading trades" />;
  if (trades.length === 0) return <p className="m-0 text-sm text-base-content/60">No trades yet.</p>;
  return (
    <div className="max-h-80 overflow-y-auto">
      <table className="table table-xs">
        <thead>
          <tr>
            <th>Price</th>
            <th className="text-right">Size</th>
            <th className="text-right">Time</th>
          </tr>
        </thead>
        <tbody>
          {trades.slice(0, 50).map(t => (
            <tr key={t.id}>
              {/* The taker side: a buyer-maker trade was a sell into the bid. */}
              <td className={`tabular-nums ${t.isBuyerMaker ? "text-error" : "text-success"}`}>
                {formatAmount(t.price, 8)}
              </td>
              <td className="text-right tabular-nums">{formatAmount(t.qty, 2)}</td>
              <td className="text-right text-base-content/60">{formatDateTime(t.time)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
