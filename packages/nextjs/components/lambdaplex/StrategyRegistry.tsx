"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { keccak256, toBytes } from "viem";
import { useAccount } from "wagmi";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-hbar";
import { formatDateTime } from "~~/utils/lambdaplex/format";

const TOPIC_RE = /^0\.0\.(\d+)$/;
const ACCOUNT_RE = /^(0\.0\.\d+|0x[0-9a-fA-F]{40})$/;
/** The contract's limits are in bytes (`bytes(name).length`), so count UTF-8 bytes, not characters. */
const MAX_BYTES = 64;
const byteLength = (value: string) => new TextEncoder().encode(value).length;

type Form = { name: string; topic: string; venueAccount: string; params: string };

/** What is wrong with each field, in the order the form shows them. */
const formProblems = (form: Form): Partial<Record<keyof Form, string>> => {
  const problems: Partial<Record<keyof Form, string>> = {};
  if (!form.name) problems.name = "Give the strategy a name.";
  else if (byteLength(form.name) > MAX_BYTES) problems.name = `Keep the name within ${MAX_BYTES} bytes.`;
  if (!TOPIC_RE.test(form.topic)) problems.topic = "Enter the HCS topic id, like 0.0.12345.";
  if (form.venueAccount && !ACCOUNT_RE.test(form.venueAccount))
    problems.venueAccount = "Use a Hedera account id (0.0.x) or an 0x address, or leave it empty.";
  try {
    JSON.parse(form.params);
  } catch {
    problems.params = "Parameters must be valid JSON; their keccak256 hash is what goes on-chain.";
  }
  return problems;
};
const ZERO = "0x0000000000000000000000000000000000000000";

/** Strategies registered on-chain (Hedera testnet), each linked to its HCS track record. */
export const StrategyRegistryView = () => {
  const { address } = useAccount();
  const { data: registry, isLoading: registryLoading } = useDeployedContractInfo({ contractName: "StrategyRegistry" });
  // A freshly scaffolded app ships the zero placeholder until `yarn foundry:deploy` writes the real address.
  const deployed = Boolean(registry && (registry.address as string) !== ZERO);
  const { data: strategies, isLoading } = useScaffoldReadContract({
    contractName: "StrategyRegistry",
    functionName: "listStrategies",
    args: [0n, 25n],
    query: { enabled: deployed },
  });
  const { writeContractAsync, isPending } = useScaffoldWriteContract({ contractName: "StrategyRegistry" });
  const [form, setForm] = useState<Form>({
    name: "TWAP HBAR-USDC",
    topic: process.env.NEXT_PUBLIC_TRACK_RECORD_TOPIC_ID ?? "",
    venueAccount: "",
    params: '{"symbol":"HBAR-USDC","side":"BUY","slices":2,"intervalSeconds":60,"maxSlippageBps":50}',
  });

  // A ref, not state: a double-click would otherwise register the same strategy twice.
  const inFlight = useRef(false);
  const problems = formProblems(form);
  const valid = Object.keys(problems).length === 0;
  // Only flag a field once the visitor has touched it, so the form doesn't open covered in errors.
  const [touched, setTouched] = useState<Partial<Record<keyof Form, boolean>>>({});
  const update = (key: keyof Form, value: string) => {
    setForm({ ...form, [key]: value });
    setTouched({ ...touched, [key]: true });
  };
  const fieldError = (key: keyof Form) =>
    touched[key] && problems[key] ? <span className="text-xs text-error">{problems[key]}</span> : null;

  if (registryLoading) {
    return <div className="h-32 rounded-xl bg-base-200 animate-pulse" aria-label="Loading registry" />;
  }
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
          if (!valid || inFlight.current) return;
          inFlight.current = true;
          try {
            await writeContractAsync({
              functionName: "register",
              args: [
                form.name,
                BigInt(TOPIC_RE.exec(form.topic)![1]),
                form.venueAccount,
                keccak256(toBytes(form.params)),
              ],
            });
          } catch {
            // Rejections and reverts are already shown as notifications by the scaffold write hook.
          } finally {
            inFlight.current = false;
          }
        }}
      >
        <h2 className="m-0 text-lg font-semibold">Register a strategy</h2>
        {(
          [
            ["name", "Name"],
            ["topic", "Track-record topic (0.0.x)"],
            ["venueAccount", "Lambdaplex account (0.0.x or 0x…, optional)"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex flex-col gap-1 text-sm">
            <span>{label}</span>
            <input
              className="input input-bordered input-sm"
              value={form[key]}
              aria-invalid={Boolean(touched[key] && problems[key])}
              onChange={e => update(key, e.target.value.trim())}
            />
            {fieldError(key)}
          </label>
        ))}
        <label className="flex flex-col gap-1 text-sm">
          <span>Parameters (hashed on-chain)</span>
          <textarea
            className="textarea textarea-bordered text-xs"
            rows={3}
            value={form.params}
            aria-invalid={Boolean(touched.params && problems.params)}
            onChange={e => update("params", e.target.value)}
          />
          {fieldError("params")}
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
