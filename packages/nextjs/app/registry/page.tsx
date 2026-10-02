import type { NextPage } from "next";
import { StrategyRegistryView } from "~~/components/lambdaplex/StrategyRegistry";
import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "Strategy registry",
  description: "On-chain directory of trading strategies and their HCS track records.",
});

const RegistryPage: NextPage = () => (
  <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 py-8">
    <header className="flex flex-col gap-2">
      <h1 className="m-0 text-3xl font-bold">Strategy registry</h1>
      <p className="m-0 max-w-3xl text-base-content/75">
        <code>StrategyRegistry</code> on Hedera testnet binds each strategy to its operator, its HCS track-record topic,
        its Lambdaplex account and a hash of its parameters, so other contracts and apps can discover and trust it.
      </p>
    </header>
    <StrategyRegistryView />
  </div>
);

export default RegistryPage;
