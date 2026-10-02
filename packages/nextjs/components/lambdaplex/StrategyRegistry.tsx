"use client";

import { useState } from "react";
import Link from "next/link";
import { keccak256, toBytes } from "viem";
import { useAccount } from "wagmi";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-hbar";
import { formatDateTime } from "~~/utils/lambdaplex/format";

const TOPIC_RE = /^0\.0\.(\d+)$/;
const ZERO = "0x0000000000000000000000000000000000000000";

/** Strategies registered on-chain (Hedera testnet), each linked to its HCS track record. */
export const StrategyRegistryView = () => {
  const { address } = useAccount();
  const { data: registry } = useDeployedContractInfo({ contractName: "StrategyRegistry" });
  const deployed = Boolean(registry && registry.address !== ZERO);
  const { data: strategies, isLoading } = useScaffoldReadContract({
    contractName: "StrategyRegistry",
    functionName: "listStrategies",
    args: [0n, 25n],
    query: { enabled: deployed },
  });
  const { writeContractAsync, isPending } = useScaffoldWriteContract({ contractName: "StrategyRegistry" });
  const [form, setForm] = useState({
    name: "TWAP HBAR-USDC",
    topic: process.env.NEXT_PUBLIC_TRACK_RECORD_TOPIC_ID ?? "",
    venueAccount: "",
    params: '{"symbol":"HBAR-USDC","side":"BUY","slices":2,"intervalSeconds":60,"maxSlippageBps":50}',
  });

  const topicMatch = TOPIC_RE.exec(form.topic);
  const valid = form.name.length > 0 && form.name.length <= 64 && topicMatch;

  if (!deployed) {
    return (
      <p className="m-0 text-sm text-base-content/70">
        StrategyRegistry is not deployed on this network yet. Run{" "}
        <code>yarn foundry:deploy --network hedera_testnet</code>.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[22rem_1fr]">
      <form
        className="flex flex-col gap-3 rounded-2xl border border-base-300 bg-base-100 p-5"
        onSubmit={async e => {
          e.preventDefault();
          if (!valid) return;
          await writeContractAsync({
            functionName: "register",
            args: [form.name, BigInt(topicMatch![1]), form.venueAccount, keccak256(toBytes(form.params))],
          });
        }}
      >
        <h2 className="m-0 text-lg font-semibold">Register a strategy</h2>
        {(
          [
            ["name", "Name"],
            ["topic", "Track-record topic (0.0.x)"],
            ["venueAccount", "Lambdaplex account (0.0.x)"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex flex-col gap-1 text-sm">
            <span>{label}</span>
            <input
              className="input input-bordered input-sm"
              value={form[key]}
              onChange={e => setForm({ ...form, [key]: e.target.value.trim() })}
            />
          </label>
        ))}
        <label className="flex flex-col gap-1 text-sm">
          <span>Parameters (hashed on-chain)</span>
          <textarea
            className="textarea textarea-bordered text-xs"
            rows={3}
            value={form.params}
            onChange={e => setForm({ ...form, params: e.target.value })}
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={!address || !valid || isPending}>
          {isPending ? (
            <span className="loading loading-spinner loading-sm" />
          ) : address ? (
            "Register"
          ) : (
            "Connect a wallet"
          )}
        </button>
      </form>

      <section className="flex flex-col gap-3">
        <h2 className="m-0 text-lg font-semibold">Strategies</h2>
        {isLoading ? (
          <div className="h-32 rounded-xl bg-base-200 animate-pulse" aria-label="Loading strategies" />
        ) : !strategies?.length ? (
          <p className="m-0 text-sm text-base-content/60">No strategies registered yet.</p>
        ) : (
          strategies.map(s => (
            <article
              key={`${s.operator}-${s.createdAt}-${s.name}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-base-300 bg-base-100 p-4"
            >
              <div>
                <p className="m-0 font-semibold">
                  {s.name} {!s.active && <span className="badge badge-sm">inactive</span>}
                </p>
                <p className="m-0 text-xs text-base-content/60">
                  Operator {s.operator.slice(0, 8)}… · venue {s.venueAccount || "—"} · since{" "}
                  {formatDateTime(Number(s.createdAt) * 1000)}
                </p>
              </div>
              <Link className="btn btn-sm btn-outline" href={`/bots?topic=0.0.${s.topicNum}`}>
                Track record 0.0.{s.topicNum.toString()}
              </Link>
            </article>
          ))
        )}
      </section>
    </div>
  );
};
