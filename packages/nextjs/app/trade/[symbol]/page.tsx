"use client";

import { use, useState } from "react";
import Link from "next/link";
import { AccountPanel } from "~~/components/lambdaplex/AccountPanel";
import { OrderBook } from "~~/components/lambdaplex/OrderBook";
import { OrderForm } from "~~/components/lambdaplex/OrderForm";
import { PriceChart } from "~~/components/lambdaplex/PriceChart";
import { TradesTape } from "~~/components/lambdaplex/TradesTape";
import { TradingStatusBanner } from "~~/components/lambdaplex/TradingStatusBanner";
import { useMarketStream } from "~~/hooks/lambdaplex/useMarketStream";
import { useMarkets } from "~~/hooks/lambdaplex/useMarkets";
import { formatAmount } from "~~/utils/lambdaplex/format";

const Card = ({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) => (
  <section className={`flex flex-col gap-3 rounded-2xl border border-base-300 bg-base-100 p-4 ${className}`}>
    <h2 className="m-0 text-sm font-semibold uppercase tracking-wider text-base-content/70">{title}</h2>
    {children}
  </section>
);

export default function TradePage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = use(params);
  const { data: markets } = useMarkets();
  const rules = markets?.find(m => m.symbol === symbol);
  const { book, trades, connected, error } = useMarketStream(symbol);
  const [picked, setPicked] = useState<string>();

  if (markets && !rules) {
    return (
      <div className="mx-auto max-w-xl px-5 py-16 text-center">
        <p>Unknown market {symbol}.</p>
        <Link className="btn btn-primary" href="/">
          All markets
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-5 py-8">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="m-0 text-3xl font-bold">
          {rules?.baseAsset ?? symbol.split("-")[0]}
          <span className="text-base-content/50">/{rules?.quoteAsset ?? symbol.split("-")[1]}</span>
          {rules?.lastPrice && <span className="ml-3 text-2xl tabular-nums">{formatAmount(rules.lastPrice, 8)}</span>}
        </h1>
        <span className={`badge ${connected ? "badge-success" : "badge-ghost"}`} aria-live="polite">
          {connected ? "Live stream" : "Polling"}
        </span>
      </header>
      <TradingStatusBanner />
      {error && <p className="m-0 text-error">Market data unavailable: {error.message}</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_20rem_20rem]">
        <Card title="Price">
          <PriceChart trades={trades} />
        </Card>
        <Card title="Order book" className="lg:row-span-2">
          <OrderBook book={book} baseAsset={rules?.baseAsset ?? ""} onPick={setPicked} />
        </Card>
        <Card title="Place order">
          {rules ? (
            <OrderForm rules={rules} bestBid={book?.bids[0]?.[0]} bestAsk={book?.asks[0]?.[0]} pickedPrice={picked} />
          ) : (
            <div className="h-64 rounded-xl bg-base-200 animate-pulse" />
          )}
        </Card>
        <Card title="Recent trades">
          <TradesTape trades={trades} />
        </Card>
        <Card title="Account">
          <AccountPanel symbol={symbol} />
        </Card>
      </div>
    </div>
  );
}
