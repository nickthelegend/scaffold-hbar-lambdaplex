/**
 * Creates the HCS topic a strategy publishes its track record to. Only the operator key can submit to it.
 *   HEDERA_OPERATOR_ID=0.0.x HEDERA_OPERATOR_KEY=0x... yarn lambdaplex:topic:create [memo]
 */
import { AccountId, Client, PrivateKey } from "@hiero-ledger/sdk";
import { config as loadEnv } from "dotenv";
import { createTrackRecordTopic } from "../src/server";

loadEnv({ path: new URL("../../nextjs/.env.local", import.meta.url).pathname });
loadEnv();

const { HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY, HEDERA_NETWORK } = process.env;
if (!HEDERA_OPERATOR_ID || !HEDERA_OPERATOR_KEY)
  throw new Error("Set HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY (ECDSA)");

const client = (HEDERA_NETWORK === "mainnet" ? Client.forMainnet() : Client.forTestnet()).setOperator(
  AccountId.fromString(HEDERA_OPERATOR_ID),
  PrivateKey.fromStringECDSA(HEDERA_OPERATOR_KEY),
);
try {
  const topicId = await createTrackRecordTopic(client, process.argv[2] ?? "Lambdaplex strategy track record (v1)");
  console.log(`Track record topic: ${topicId}`);
  console.log(
    `Add to packages/nextjs/.env.local:\n  TRACK_RECORD_TOPIC_ID=${topicId}\n  NEXT_PUBLIC_TRACK_RECORD_TOPIC_ID=${topicId}`,
  );
} finally {
  client.close();
}
