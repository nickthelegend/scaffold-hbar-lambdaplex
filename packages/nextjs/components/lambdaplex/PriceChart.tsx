"use client";

import type { PublicTrade } from "@sh/lambdaplex";
import { formatAmount, formatDateTime } from "~~/utils/lambdaplex/format";

const WIDTH = 640;
const HEIGHT = 200;
const PAD = 8;

/** Step line of recent trade prices with volume ticks, drawn as SVG (no chart library). */
export const PriceChart = ({ trades }: { trades?: PublicTrade[] }) => {
  if (!trades) return <div className="h-52 rounded-xl bg-base-200 animate-pulse" aria-label="Loading chart" />;
  const points = [...trades].sort((a, b) => a.time - b.time);
  if (points.length < 2) return <p className="m-0 text-sm text-base-content/60">Not enough trades to chart yet.</p>;

  const prices = points.map(t => Number(t.price));
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || max * 0.01 || 1;
  const t0 = points[0].time;
  const span = points[points.length - 1].time - t0 || 1;
  const x = (time: number) => PAD + ((time - t0) / span) * (WIDTH - 2 * PAD);
  const y = (price: number) => PAD + (1 - (price - min) / range) * (HEIGHT - 2 * PAD - 24);
  const maxQty = Math.max(...points.map(t => Number(t.qty)));

  let path = `M ${x(points[0].time)} ${y(prices[0])}`;
  for (let i = 1; i < points.length; i++) path += ` H ${x(points[i].time)} V ${y(prices[i])}`;

  const last = points[points.length - 1];
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-52 w-full" role="img" aria-label="Recent trade prices">
        {points.map(t => (
          <line
            key={t.id}
            x1={x(t.time)}
            x2={x(t.time)}
            y1={HEIGHT - PAD}
            y2={HEIGHT - PAD - (Number(t.qty) / maxQty) * 20}
            className="stroke-base-content/25"
            strokeWidth={2}
          />
        ))}
        <path d={path} fill="none" className="stroke-primary" strokeWidth={2} />
        <circle cx={x(last.time)} cy={y(Number(last.price))} r={4} className="fill-primary" />
      </svg>
      <figcaption className="flex justify-between text-xs text-base-content/60">
        <span>{formatDateTime(points[0].time)}</span>
        <span>
          low {formatAmount(min.toString(), 8)} · high {formatAmount(max.toString(), 8)}
        </span>
        <span>{formatDateTime(last.time)}</span>
      </figcaption>
    </figure>
  );
};
