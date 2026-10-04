"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { TrackRecord } from "~~/components/lambdaplex/TrackRecord";
import { TwapPanel } from "~~/components/lambdaplex/TwapPanel";

function BotsContent() {
  const topic = useSearchParams().get("topic") ?? undefined;
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-8">
      <header className="flex flex-col gap-2">
        <h1 className="m-0 text-3xl font-bold">TWAP bot</h1>
        <p className="m-0 max-w-3xl text-base-content/75">
          Splits a large order into timed IOC slices capped at a maximum slippage, rolls unfilled amounts into the next
          slice, and waits for each fill to be settlement-final on Hedera before publishing it to the track record.
        </p>
      </header>
      <TwapPanel />
      {/* Keyed by the query string: a link to another strategy's record on this same page resets the field. */}
      <TrackRecord key={topic ?? "configured"} defaultTopic={topic} />
    </div>
  );
}

export default function BotsPage() {
  return (
    <Suspense>
      <BotsContent />
    </Suspense>
  );
}
