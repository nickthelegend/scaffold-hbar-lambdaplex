"use client";

import { useState } from "react";
import type { OrderSide } from "@sh/lambdaplex";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTradingStatus } from "~~/hooks/lambdaplex/useTradingStatus";
import type { TwapJob as Job, JobLogEntry } from "~~/lib/twapJobs.server";
import { serverApi } from "~~/utils/lambdaplex/api";
import { formatTime } from "~~/utils/lambdaplex/format";
import { hashscan } from "~~/utils/lambdaplex/hedera";
import { notification } from "~~/utils/scaffold-hbar";

type LogEvent = JobLogEntry["event"];

const describe = (event: LogEvent): string => {
  switch (event.type) {
    case "slice-skipped":
      return `Slice ${event.slice + 1}: ${event.reason}`;
    case "order-placed":
      return `Slice ${event.slice + 1}: IOC ${event.quantity} @ ${event.price} (order ${event.orderId.slice(0, 8)}…)`;
    case "fill":
      return `Fill ${event.fill.qty} @ ${event.fill.price}, settled in ${event.fill.settlementTransactionId}`;
    case "slice-settled":
      return `Slice ${event.slice + 1} done: ${event.filled} filled, ${event.carried} carried${
        event.pendingSettlement ? ` (${event.pendingSettlement} still settling)` : ""
      }`;
    case "slice-failed":
      return `Slice ${event.slice + 1} failed, nothing executed: ${event.error}`;
    case "slice-unresolved":
      return `Slice ${event.slice + 1}: could not confirm what ${event.amount} executed (${event.error}). Stopped.`;
    case "track-record":
      return `Published to HCS as message #${event.sequenceNumber}`;
    case "track-record-failed":
      return `HCS publish failed (the fill stands): ${event.error}`;
    case "done":
      if (event.dryRun) return `Dry run done: nothing was placed${event.stopReason ? ` (${event.stopReason})` : ""}`;
      return `Done: ${event.filledBase} base for ${event.filledQuote} quote, ${event.unfilled} unfilled${
        event.unresolved !== "0" ? `, ${event.unresolved} UNRESOLVED` : ""
      }${event.stopReason ? ` (${event.stopReason})` : ""}`;
    case "error":
      return `Error: ${event.error}`;
  }
};

const isProblem = (event: LogEvent) =>
  event.type === "slice-failed" ||
  event.type === "slice-unresolved" ||
  event.type === "track-record-failed" ||
  event.type === "error";

/** Start TWAP jobs on the server (dry run or live) and follow their progress. */
export const TwapPanel = () => {
  const { data: status } = useTradingStatus();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    symbol: "HBAR-USDC",
    side: "BUY" as OrderSide,
    total: "10",
    slices: "2",
    intervalSeconds: "60",
    maxSlippageBps: "50",
    live: false,
  });
  const [starting, setStarting] = useState(false);

  const jobs = useQuery({
    queryKey: ["twap-jobs"],
    queryFn: () => serverApi.get<Job[]>("/api/bots/twap"),
    refetchInterval: query => (query.state.data?.some(j => j.status === "running") ? 2_000 : 15_000),
  });

  const start = async () => {
    setStarting(true);
    try {
      await serverApi.post("/api/bots/twap", {
        ...form,
        slices: Number(form.slices),
        intervalSeconds: Number(form.intervalSeconds),
        maxSlippageBps: Number(form.maxSlippageBps),
      });
      await queryClient.invalidateQueries({ queryKey: ["twap-jobs"] });
    } catch (error) {
      notification.error(error instanceof Error ? error.message : "Could not start the TWAP");
    } finally {
      setStarting(false);
    }
  };

  const cancel = async (id: string) => {
    try {
      await serverApi.delete(`/api/bots/twap/${encodeURIComponent(id)}`);
    } catch (error) {
      notification.error(error instanceof Error ? error.message : "Could not stop the job");
    }
    await queryClient.invalidateQueries({ queryKey: ["twap-jobs"] });
  };

  const field = (key: keyof typeof form, label: string, hint?: string) => (
    <label className="flex flex-col gap-1 text-sm">
      <span>{label}</span>
      <input
        className="input input-bordered input-sm tabular-nums"
        value={String(form[key])}
        onChange={e => setForm({ ...form, [key]: e.target.value.trim() })}
      />
      {hint && <span className="text-xs text-base-content/60">{hint}</span>}
    </label>
  );

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[22rem_1fr]">
      <form
        className="flex flex-col gap-3 rounded-2xl border border-base-300 bg-base-100 p-5"
        onSubmit={e => {
          e.preventDefault();
          void start();
        }}
      >
        <h2 className="m-0 text-lg font-semibold">New TWAP</h2>
        {field("symbol", "Market")}
        <div className="join w-full">
          {(["BUY", "SELL"] as const).map(s => (
            <button
              key={s}
              type="button"
              className={`btn btn-sm join-item flex-1 ${form.side === s ? "btn-primary" : ""}`}
              onClick={() => setForm({ ...form, side: s })}
            >
              {s}
            </button>
          ))}
        </div>
        {field("total", form.side === "BUY" ? "Total to spend (quote)" : "Total to sell (base)")}
        <div className="grid grid-cols-2 gap-3">
          {field("slices", "Slices")}
          {field("intervalSeconds", "Interval (s)")}
        </div>
        {field("maxSlippageBps", "Max slippage (bps)", "Each slice is an IOC limit at best price ± this.")}
        <label className="label cursor-pointer justify-start gap-2 text-sm">
          <input
            type="checkbox"
            className="toggle toggle-sm"
            checked={form.live}
            disabled={!status?.tradingEnabled}
            onChange={e => setForm({ ...form, live: e.target.checked })}
          />
          Live (places real orders)
        </label>
        {!status?.tradingEnabled && (
          <p className="m-0 text-xs text-base-content/60">Dry runs only: trading is disabled on this deployment.</p>
        )}
        <button type="submit" className={`btn ${form.live ? "btn-warning" : "btn-primary"}`} disabled={starting}>
          {starting ? (
            <span className="loading loading-spinner loading-sm" />
          ) : form.live ? (
            "Start live TWAP"
          ) : (
            "Dry run"
          )}
        </button>
      </form>

      <section className="flex flex-col gap-3">
        <h2 className="m-0 text-lg font-semibold">Jobs</h2>
        {jobs.error && <p className="m-0 text-sm text-error">Could not load jobs: {jobs.error.message}</p>}
        {!jobs.error && !jobs.isLoading && !jobs.data?.length && (
          <p className="m-0 text-sm text-base-content/60">
            No jobs yet. Start a dry run to see each slice planned against the live book.
          </p>
        )}
        {jobs.data?.map(job => (
          <article key={job.id} className="rounded-2xl border border-base-300 bg-base-100 p-4">
            <header className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">
                {job.config.side} {job.config.total} on {job.config.symbol} · {job.config.slices} ×{" "}
                {job.config.intervalSeconds}s
              </span>
              <span className="flex items-center gap-2">
                <span className={`badge badge-sm ${job.live ? "badge-warning" : "badge-ghost"}`}>
                  {job.live ? "live" : "dry run"}
                </span>
                <span
                  className={`badge badge-sm ${job.status === "running" ? "badge-info" : job.status === "done" ? "badge-success" : "badge-error"}`}
                >
                  {job.status}
                </span>
                {job.status === "running" && (
                  <button className="btn btn-ghost btn-xs" onClick={() => cancel(job.id)}>
                    Stop
                  </button>
                )}
              </span>
            </header>
            <ol className="m-0 mt-3 flex flex-col gap-1 pl-0 text-sm">
              {job.log.map(({ at, event }, i) => (
                <li key={i} className="flex gap-3">
                  <span className="shrink-0 tabular-nums text-base-content/50">{formatTime(at)}</span>
                  <span className={isProblem(event) ? "text-error" : ""}>
                    {describe(event)}
                    {event.type === "fill" && (
                      <a
                        className="link link-primary ml-2 text-xs"
                        href={hashscan("mainnet", "transaction", event.fill.settlementTransactionId)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        HashScan
                      </a>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </article>
        ))}
      </section>
    </div>
  );
};
