"use client";

import type { OrderBook as Book } from "@sh/lambdaplex";
import { formatAmount } from "~~/utils/lambdaplex/format";

const ROWS = 10;

/** Asks above, bids below, each row shaded by its share of the visible depth. */
export const OrderBook = ({
  book,
  baseAsset,
  onPick,
}: {
  book?: Book;
  baseAsset: string;
  onPick?: (price: string) => void;
}) => {
  if (!book) return <div className="h-80 rounded-xl bg-base-200 animate-pulse" aria-label="Loading order book" />;

  const asks = book.asks.slice(0, ROWS).reverse();
  const bids = book.bids.slice(0, ROWS);
  const max = Math.max(1, ...[...asks, ...bids].map(([, qty]) => Number(qty)));
  const bestAsk = book.asks[0]?.[0];
  const bestBid = book.bids[0]?.[0];
  const spread = bestAsk && bestBid ? Number(bestAsk) - Number(bestBid) : undefined;

  const Row = ({ level, side }: { level: [string, string]; side: "ask" | "bid" }) => (
    <button
      type="button"
      className="relative grid w-full grid-cols-2 px-2 py-0.5 text-left text-sm tabular-nums hover:bg-base-200"
      onClick={() => onPick?.(level[0])}
      title="Use this price"
    >
      <span
        className={`absolute inset-y-0 right-0 ${side === "ask" ? "bg-error/15" : "bg-success/15"}`}
        style={{ width: `${(Number(level[1]) / max) * 100}%` }}
        aria-hidden
      />
      <span className={`relative ${side === "ask" ? "text-error" : "text-success"}`}>{formatAmount(level[0], 8)}</span>
      <span className="relative text-right">{formatAmount(level[1], 2)}</span>
    </button>
  );

  return (
    <div className="flex flex-col">
      <div className="grid grid-cols-2 px-2 pb-1 text-xs uppercase tracking-wider text-base-content/60">
        <span>Price</span>
        <span className="text-right">Size ({baseAsset})</span>
      </div>
      {asks.length === 0 && <p className="m-0 px-2 text-sm text-base-content/50">No asks</p>}
      {asks.map(level => (
        <Row key={`a${level[0]}`} level={level} side="ask" />
      ))}
      <div className="my-1 border-y border-base-300 px-2 py-1 text-xs text-base-content/70">
        Spread {spread !== undefined ? formatAmount(spread.toFixed(8), 8) : "—"}
      </div>
      {bids.map(level => (
        <Row key={`b${level[0]}`} level={level} side="bid" />
      ))}
      {bids.length === 0 && <p className="m-0 px-2 text-sm text-base-content/50">No bids</p>}
    </div>
  );
};
