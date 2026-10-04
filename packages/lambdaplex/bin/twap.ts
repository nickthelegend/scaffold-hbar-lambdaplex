/**
 * Runs a TWAP on Lambdaplex and publishes each settled fill to an HCS track-record topic.
 *
 *   yarn lambdaplex:twap --symbol HBAR-USDC --side BUY --total 12 --slices 2 --interval 60 [--slippage-bps 50] [--live]
 *
 * Without --live it is a dry run: every slice is planned and validated against live market data, nothing is sent.
 * --publish-plan (dry runs) records the planned orders in the track-record topic as a `dry-run` plan, never as fills.
 * Env: LAMBDAPLEX_API_KEY, LAMBDAPLEX_PRIVATE_KEY (trading); HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY,
 * HEDERA_OPERATOR_KEY_TYPE, TRACK_RECORD_TOPIC_ID, HEDERA_NETWORK (track record, optional); STRATEGY_NAME.
 * Ctrl-C stops before the next slice; an order already sent is still accounted for.
 */
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { entryFromFill, type PlanEntry, runTwap, type TwapConfig, validateTwapConfig } from "../src";
import { LambdaplexClient, operatorClient, publishEntry, publishPlan } from "../src/server";

// fileURLToPath, not URL.pathname: the latter keeps %20 for paths with spaces and dotenv silently finds nothing.
loadEnv({ path: fileURLToPath(new URL("../../nextjs/.env.local", import.meta.url)) });
loadEnv();

const { values } = parseArgs({
  options: {
    symbol: { type: "string", default: "HBAR-USDC" },
    side: { type: "string", default: "BUY" },
    total: { type: "string" },
    slices: { type: "string", default: "2" },
    interval: { type: "string", default: "60" },
    "slippage-bps": { type: "string", default: "50" },
    live: { type: "boolean", default: false },
    "publish-plan": { type: "boolean", default: false },
  },
});

if (!values.total) throw new Error("--total is required (quote to spend for BUY, base to sell for SELL)");
if (values.side !== "BUY" && values.side !== "SELL") throw new Error("--side must be BUY or SELL");

const twap: TwapConfig = {
  symbol: values.symbol!,
  side: values.side,
  total: values.total,
  slices: Number(values.slices),
  intervalSeconds: Number(values.interval),
  maxSlippageBps: Number(values["slippage-bps"]),
};
const problems = validateTwapConfig(twap);
if (problems.length) throw new Error(`Invalid arguments: ${problems.join("; ")}`);

const lambdaplex = new LambdaplexClient({
  apiKey: process.env.LAMBDAPLEX_API_KEY,
  privateKey: process.env.LAMBDAPLEX_PRIVATE_KEY,
});
if (values.live && !lambdaplex.canTrade) {
  throw new Error(lambdaplex.configError ?? "--live needs LAMBDAPLEX_API_KEY and LAMBDAPLEX_PRIVATE_KEY");
}

const topicId = process.env.TRACK_RECORD_TOPIC_ID;
const hedera = topicId ? operatorClient(process.env) : undefined;
const strategy = process.env.STRATEGY_NAME ?? `twap-${twap.symbol.toLowerCase()}`;

console.log(
  `${values.live ? "LIVE" : "DRY RUN"} TWAP ${twap.side} ${twap.total} on ${twap.symbol} in ${twap.slices} slices`,
);
if (!hedera) console.log("Track record disabled (set TRACK_RECORD_TOPIC_ID and HEDERA_OPERATOR_ID/KEY to enable)");

const stop = new AbortController();
process.once("SIGINT", () => {
  console.log("Stopping after the current slice…");
  stop.abort();
});

// A dry run with --publish-plan records the orders it would have placed (never as fills) in the track record.
const plannedAt = Date.now();
const orders: PlanEntry["orders"] = [];

try {
  const result = await runTwap(lambdaplex, twap, {
    dryRun: !values.live,
    signal: stop.signal,
    onEvent: async event => {
      console.log(JSON.stringify(event));
      if (event.type === "slice-skipped" && event.planned) {
        orders.push({ price: event.planned.price, qty: event.planned.quantity });
      }
      if (event.type === "fill" && hedera && topicId) {
        const entry = entryFromFill(strategy, twap.symbol, twap.side, event.clientOrderId, event.fill);
        try {
          const { sequenceNumber, transactionId } = await publishEntry(hedera, topicId, entry);
          console.log(`  → track record #${sequenceNumber} on ${topicId} (${transactionId})`);
        } catch (error) {
          // The fill happened regardless; a publishing failure must not change what the bot trades.
          console.error(`  ✗ track record publish failed: ${error instanceof Error ? error.message : error}`);
        }
      }
    },
  });
  console.log(`Filled ${result.filledBase} base for ${result.filledQuote} quote; unfilled ${result.unfilled}`);
  if (values["publish-plan"] && !values.live) {
    if (!hedera || !topicId) throw new Error("--publish-plan needs TRACK_RECORD_TOPIC_ID and HEDERA_OPERATOR_ID/KEY");
    const plan: PlanEntry = {
      v: 1,
      kind: "dry-run",
      strategy,
      venue: "lambdaplex",
      symbol: twap.symbol,
      side: twap.side,
      total: twap.total,
      slices: twap.slices,
      maxSlippageBps: twap.maxSlippageBps,
      time: plannedAt,
      orders,
    };
    const { sequenceNumber, transactionId } = await publishPlan(hedera, topicId, plan);
    console.log(`  → dry-run plan published as #${sequenceNumber} on ${topicId} (${transactionId})`);
  }
  if (result.stopReason) console.log(`Stopped early: ${result.stopReason}`);
  if (result.unresolved !== "0") {
    console.error(`UNRESOLVED ${result.unresolved}: check open orders and fills on Lambdaplex before trading it again`);
    process.exitCode = 2;
  }
} finally {
  hedera?.close();
}
