"use client";

import { LockClosedIcon, SignalIcon } from "@heroicons/react/24/outline";
import { useTradingStatus } from "~~/hooks/lambdaplex/useTradingStatus";

/** Tells the visitor whether this deployment can trade, and how to enable it if not. */
export const TradingStatusBanner = () => {
  const { data: status } = useTradingStatus();
  if (!status) return null;

  if (status.tradingEnabled) {
    return (
      <div role="status" className="alert alert-success alert-soft text-sm">
        <SignalIcon className="h-5 w-5" />
        <span>Trading enabled. Orders are signed server-side with this deployment&apos;s Lambdaplex API key.</span>
      </div>
    );
  }
  return (
    <div role="status" className="alert alert-soft text-sm">
      <LockClosedIcon className="h-5 w-5" />
      <span>
        Read-only mode: live market data, no trading. To trade, put <code>LAMBDAPLEX_API_KEY</code>,{" "}
        <code>LAMBDAPLEX_PRIVATE_KEY</code> and <code>TRADING_ENABLED=true</code> in{" "}
        <code>packages/nextjs/.env.local</code> (see README → Trading).
      </span>
    </div>
  );
};
