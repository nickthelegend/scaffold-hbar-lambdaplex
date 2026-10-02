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
    | { type: "track-record-failed"; error: string }
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
 * long-running bots belong in `yarn lambdaplex:twap`, which runs the same executor as a CLI. The registry is bounded:
 * at most MAX_RUNNING jobs run at once and only the newest MAX_FINISHED finished jobs are kept.
 */
type Registry = { jobs: Map<string, TwapJob>; aborts: Map<string, AbortController> };
const registry = ((globalThis as { __twapJobs?: Registry }).__twapJobs ??= { jobs: new Map(), aborts: new Map() });

export const MAX_RUNNING = 5;
export const MAX_FINISHED = 20;

export class JobLimitError extends Error {}

export const listJobs = (): TwapJob[] => [...registry.jobs.values()].sort((a, b) => b.startedAt - a.startedAt);

export const getJob = (id: string): TwapJob | undefined => registry.jobs.get(id);

export function cancelJob(id: string) {
  const job = registry.jobs.get(id);
  if (job?.status === "running") {
    registry.aborts.get(id)?.abort();
    job.status = "cancelled";
  }
}

/** Drops the oldest finished jobs beyond MAX_FINISHED. Running jobs are never evicted. */
function evictFinished() {
  const finished = listJobs().filter(job => job.status !== "running" && !registry.aborts.has(job.id));
  for (const job of finished.slice(MAX_FINISHED)) registry.jobs.delete(job.id);
}

export function startJob(config: TwapConfig, live: boolean): TwapJob {
  evictFinished();
  if (registry.aborts.size >= MAX_RUNNING) {
    throw new JobLimitError(`At most ${MAX_RUNNING} TWAP jobs can run at once; stop one first`);
  }
  const publisher = live ? hederaPublisher() : undefined;
  const topicId = trackRecordTopicId();
  const strategy = process.env.STRATEGY_NAME ?? `twap-${config.symbol.toLowerCase()}`;

  const id = randomUUID().slice(0, 8);
  const job: TwapJob = { id, config, live, status: "running", startedAt: Date.now(), log: [] };
  const controller = new AbortController();
  registry.jobs.set(id, job);
  registry.aborts.set(id, controller);
  const push = (event: JobLogEntry["event"]) => job.log.push({ at: Date.now(), event });

  runTwap(lambdaplex, config, {
    dryRun: !live,
    runId: id,
    signal: controller.signal,
    onEvent: async event => {
      push(event);
      if (event.type === "fill" && publisher && topicId) {
        // Publishing is best-effort: the fill happened whatever HCS says, so a failure is logged, never retried here.
        try {
          const entry = entryFromFill(strategy, config.symbol, config.side, event.clientOrderId, event.fill);
          const { sequenceNumber, transactionId } = await publishEntry(publisher, topicId, entry);
          push({ type: "track-record", sequenceNumber, transactionId });
        } catch (error) {
          push({ type: "track-record-failed", error: error instanceof Error ? error.message : String(error) });
        }
      }
    },
  })
    .then(result => {
      if (result.unresolved !== "0") {
        push({
          type: "error",
          error: `${result.unresolved} unresolved: check open orders and fills on Lambdaplex before trading it again`,
        });
        if (job.status === "running") job.status = "failed";
      } else if (job.status === "running") job.status = "done";
    })
    .catch(error => {
      if (job.status === "running") job.status = "failed";
      push({ type: "error", error: error instanceof Error ? error.message : String(error) });
    })
    .finally(() => {
      registry.aborts.delete(id);
      publisher?.close();
    });

  return job;
}
