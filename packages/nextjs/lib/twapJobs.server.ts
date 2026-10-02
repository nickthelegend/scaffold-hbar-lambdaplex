import { type TwapConfig, type TwapEvent, entryFromFill, runTwap } from "@sh/lambdaplex";
import { publishEntry } from "@sh/lambdaplex/server";
import { randomUUID } from "node:crypto";
import "server-only";
import { hederaPublisher, lambdaplex, trackRecordTopicId } from "~~/lib/lambdaplex.server";

export type JobLogEntry = {
  at: number;
  event:
    | TwapEvent
    | { type: "track-record"; sequenceNumber: number; transactionId: string }
    | { type: "error"; error: string };
};

export type TwapJob = {
  id: string;
  config: TwapConfig;
  live: boolean;
  status: "running" | "done" | "failed" | "cancelled";
  startedAt: number;
  log: JobLogEntry[];
};

/**
 * In-memory job registry for the dev/demo server. Jobs survive hot reloads (kept on globalThis) but not restarts;
 * long-running bots belong in `yarn lambdaplex:twap`, which runs the same executor as a CLI.
 */
type Registry = { jobs: Map<string, TwapJob>; aborts: Map<string, AbortController> };
const registry = ((globalThis as { __twapJobs?: Registry }).__twapJobs ??= { jobs: new Map(), aborts: new Map() });

export const listJobs = (): TwapJob[] => [...registry.jobs.values()].sort((a, b) => b.startedAt - a.startedAt);

export const getJob = (id: string): TwapJob | undefined => registry.jobs.get(id);

export function cancelJob(id: string) {
  const job = registry.jobs.get(id);
  if (job?.status === "running") {
    registry.aborts.get(id)?.abort();
    job.status = "cancelled";
  }
}

export function startJob(config: TwapConfig, live: boolean): TwapJob {
  const id = randomUUID().slice(0, 8);
  const job: TwapJob = { id, config, live, status: "running", startedAt: Date.now(), log: [] };
  const controller = new AbortController();
  registry.jobs.set(id, job);
  registry.aborts.set(id, controller);
  const push = (event: JobLogEntry["event"]) => job.log.push({ at: Date.now(), event });

  const publisher = live ? hederaPublisher() : undefined;
  const topicId = trackRecordTopicId();
  const strategy = process.env.STRATEGY_NAME ?? `twap-${config.symbol.toLowerCase()}`;

  runTwap(lambdaplex, config, {
    dryRun: !live,
    runId: id,
    signal: controller.signal,
    onEvent: async event => {
      push(event);
      if (event.type === "fill" && publisher && topicId) {
        const entry = entryFromFill(strategy, config.symbol, config.side, event.clientOrderId, event.fill);
        const { sequenceNumber, transactionId } = await publishEntry(publisher, topicId, entry);
        push({ type: "track-record", sequenceNumber, transactionId });
      }
    },
  })
    .then(() => {
      if (job.status === "running") job.status = "done";
    })
    .catch(error => {
      job.status = "failed";
      push({ type: "error", error: error instanceof Error ? error.message : String(error) });
    })
    .finally(() => {
      registry.aborts.delete(id);
      publisher?.close();
    });

  return job;
}
