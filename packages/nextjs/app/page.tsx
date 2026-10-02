import type { NextPage } from "next";
import { MarketsTable } from "~~/components/lambdaplex/MarketsTable";
import { TradingStatusBanner } from "~~/components/lambdaplex/TradingStatusBanner";
import { LAMBDAPLEX_APP } from "~~/utils/lambdaplex/api";

const Markets: NextPage = () => (
  <div className="flex grow flex-col">
    <section className="hedera-gradient dark:bg-none dark:bg-hedera-charcoal px-5 pt-12 pb-16 text-white">
      <div className="mx-auto flex max-w-4xl flex-col gap-3">
        <p className="m-0 text-sm uppercase tracking-[0.2em] text-white/70">Lambdaplex terminal</p>
        <h1 className="m-0 text-4xl font-bold sm:text-5xl">Trade Hedera&apos;s order book from your own app</h1>
        <p className="m-0 max-w-2xl text-white/85">
          Live books and trades from{" "}
          <a className="underline" href={LAMBDAPLEX_APP} target="_blank" rel="noreferrer">
            Lambdaplex
          </a>
          , orders signed server-side with Ed25519, a TWAP bot, and a track record on the Hedera Consensus Service where
          every fill links to the Hedera transaction that settled it.
        </p>
      </div>
    </section>
    <div className="mx-auto -mt-8 flex w-full max-w-5xl flex-col gap-4 px-5 pb-16">
      <TradingStatusBanner />
      <MarketsTable />
    </div>
  </div>
);

export default Markets;
