"use client";

import { useState } from "react";
import { CheckBadgeIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { SHOWN_ENTRIES, useTrackRecord } from "~~/hooks/lambdaplex/useTrackRecord";
import { useTradingStatus } from "~~/hooks/lambdaplex/useTradingStatus";
import { formatAmount, formatDateTime } from "~~/utils/lambdaplex/format";
import { type HederaNetwork, hashscan } from "~~/utils/lambdaplex/hedera";

/**
 * Reads a strategy's HCS topic from the mirror node and checks that each listed entry's settlement transaction
 * exists and succeeded on Hedera mainnet. Consensus order and the topic's submit key make the record append-only and
 * attributable. The check does not match amounts against the transaction, so it is evidence, not proof.
 */
const TOPIC_RE = /^0\.0\.\d+$/;

export const TrackRecord = ({
  defaultTopic,
  defaultNetwork,
}: {
  defaultTopic?: string;
  defaultNetwork?: HederaNetwork;
}) => {
  const { data: status } = useTradingStatus();
  // `null` until the visitor types, so clearing the field doesn't snap back to the configured topic.
  const [input, setInput] = useState<string | null>(defaultTopic ?? null);
  const topicId = input ?? (status?.trackRecordTopicId || process.env.NEXT_PUBLIC_TRACK_RECORD_TOPIC_ID || "");
  const validTopic = TOPIC_RE.test(topicId);
  const network: HederaNetwork = defaultNetwork ?? status?.trackRecordNetwork ?? "testnet";
  const { data, isLoading, error } = useTrackRecord(network, validTopic ? topicId : undefined);

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-base-300 bg-base-100 p-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="m-0 text-lg font-semibold">Verifiable track record</h2>
          <p className="m-0 text-sm text-base-content/70">
            Every settled fill, as consensus-ordered messages on an HCS topic.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          Topic
          <input
            className="input input-bordered input-sm w-36 tabular-nums"
            placeholder="0.0.x"
            value={topicId}
            onChange={e => setInput(e.target.value.trim())}
          />
        </label>
      </header>

      {!validTopic ? (
        <p className="m-0 text-sm text-base-content/60">
          Enter a topic id (0.0.x), or create one with <code>yarn lambdaplex:topic:create</code>.
        </p>
      ) : isLoading ? (
        <div className="h-32 rounded-xl bg-base-200 animate-pulse" aria-label="Loading track record" />
      ) : error ? (
        <p className="m-0 text-sm text-error">{error.message}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 text-sm">
            <a
              className="badge badge-outline"
              href={hashscan(network, "topic", topicId)}
              target="_blank"
              rel="noreferrer"
            >
              Topic {topicId} on {network}
            </a>
            <span className={`badge ${data?.topic?.submitKey ? "badge-success" : "badge-warning"}`}>
              {data?.topic?.submitKey
                ? "Submit key set: only the operator can write"
                : "No submit key: anyone can write"}
            </span>
          </div>

          {data && data.messages.length > 0 ? (
            <>
              <dl className="m-0 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ["Fills", String(data.summary.fills)],
                  ["Bought", formatAmount(data.summary.bought, 2)],
                  ["Spent", formatAmount(data.summary.spent, 4)],
                  ["Avg buy price", data.summary.averageBuyPrice ? formatAmount(data.summary.averageBuyPrice, 8) : "—"],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-base-200 px-3 py-2">
                    <dt className="text-xs uppercase tracking-wider text-base-content/60">{label}</dt>
                    <dd className="m-0 text-lg font-semibold tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
              {data.total > data.messages.length && (
                <p className="m-0 text-xs text-base-content/60">
                  Totals cover all {data.total} entries; the newest {SHOWN_ENTRIES} are listed.
                </p>
              )}
              <div className="overflow-x-auto">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Fill</th>
                      <th className="text-right">Quote</th>
                      <th>Time</th>
                      <th>Settlement</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.messages.map(({ sequenceNumber, entry, verified }) => (
                      <tr key={sequenceNumber}>
                        <td className="tabular-nums">{sequenceNumber}</td>
                        <td className={entry.side === "BUY" ? "text-success" : "text-error"}>
                          {entry.side} {formatAmount(entry.qty, 2)} {entry.symbol.split("-")[0]} @{" "}
                          {formatAmount(entry.price, 8)}
                        </td>
                        <td className="text-right tabular-nums">{formatAmount(entry.quoteQty, 4)}</td>
                        <td className="text-base-content/60">{formatDateTime(entry.time)}</td>
                        <td>
                          <a
                            className="inline-flex items-center gap-1 link"
                            href={hashscan("mainnet", "transaction", entry.settlementTx)}
                            target="_blank"
                            rel="noreferrer"
                            title="The settlement transaction exists on mainnet and succeeded. Amounts are not matched."
                          >
                            {verified ? (
                              <CheckBadgeIcon className="h-4 w-4 text-success" />
                            ) : (
                              <ExclamationTriangleIcon className="h-4 w-4 text-warning" />
                            )}
                            {verified ? "tx succeeded" : "not found"}
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="m-0 text-sm text-base-content/60">
              No entries yet. Live TWAP fills appear here once settled.
            </p>
          )}
        </>
      )}
    </section>
  );
};
