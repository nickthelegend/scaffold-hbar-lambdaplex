/**
 * Runs a TWAP on Lambdaplex and publishes each settled fill to an HCS track-record topic.
 *
 *   yarn lambdaplex:twap --symbol HBAR-USDC --side BUY --total 10 --slices 2 --interval 60 [--slippage-bps 50] [--live]
 *
 * Without --live it is a dry run: every slice is planned and validated against live market data, nothing is sent.
 * Env: LAMBDAPLEX_API_KEY, LAMBDAPLEX_PRIVATE_KEY (trading); HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY,
 * TRACK_RECORD_TOPIC_ID, HEDERA_NETWORK (track record, optional); STRATEGY_NAME.
 */
import { AccountId, Client, PrivateKey } from "@hiero-ledger/sdk";
import { config as loadEnv } from "dotenv";
import { parseArgs } from "node:util";
import { entryFromFill, runTwap, type TwapConfig } from "../src";
import { LambdaplexClient, publishEntry } from "../src/server";

loadEnv({ path: new URL("../../nextjs/.env.local", import.meta.url).pathname });
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

const lambdaplex = new LambdaplexClient({
  apiKey: process.env.LAMBDAPLEX_API_KEY,
  privateKey: process.env.LAMBDAPLEX_PRIVATE_KEY,
});
if (values.live && !lambdaplex.canTrade) throw new Error("--live needs LAMBDAPLEX_API_KEY and LAMBDAPLEX_PRIVATE_KEY");

const topicId = process.env.TRACK_RECORD_TOPIC_ID;
const hedera =
  topicId && process.env.HEDERA_OPERATOR_ID && process.env.HEDERA_OPERATOR_KEY
    ? (process.env.HEDERA_NETWORK === "mainnet" ? Client.forMainnet() : Client.forTestnet()).setOperator(
        AccountId.fromString(process.env.HEDERA_OPERATOR_ID),
        PrivateKey.fromStringECDSA(process.env.HEDERA_OPERATOR_KEY),
      )
    : undefined;
const strategy = process.env.STRATEGY_NAME ?? `twap-${twap.symbol.toLowerCase()}`;

console.log(
  `${values.live ? "LIVE" : "DRY RUN"} TWAP ${twap.side} ${twap.total} on ${twap.symbol} in ${twap.slices} slices`,
);
if (!hedera) console.log("Track record disabled (set TRACK_RECORD_TOPIC_ID and HEDERA_OPERATOR_ID/KEY to enable)");

try {
  const result = await runTwap(lambdaplex, twap, {
    dryRun: !values.live,
    onEvent: async event => {
      console.log(JSON.stringify(event));
      if (event.type === "fill" && hedera && topicId) {
        const entry = entryFromFill(strategy, twap.symbol, twap.side, event.clientOrderId, event.fill);
        const { sequenceNumber, transactionId } = await publishEntry(hedera, topicId, entry);
        console.log(`  → track record #${sequenceNumber} on ${topicId} (${transactionId})`);
      }
    },
  });
  console.log(`Filled ${result.filledBase} base for ${result.filledQuote} quote; unfilled ${result.unfilled}`);
} finally {
  hedera?.close();
}
