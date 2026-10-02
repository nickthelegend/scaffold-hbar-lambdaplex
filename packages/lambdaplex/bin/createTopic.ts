/**
 * Creates the HCS topic a strategy publishes its track record to. Only the operator key can submit to it.
 *   HEDERA_OPERATOR_ID=0.0.x HEDERA_OPERATOR_KEY=0x... [HEDERA_OPERATOR_KEY_TYPE=ED25519] yarn lambdaplex:topic:create [memo]
 */
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { createTrackRecordTopic, operatorClient } from "../src/server";

loadEnv({ path: fileURLToPath(new URL("../../nextjs/.env.local", import.meta.url)) });
loadEnv();

const client = operatorClient(process.env);
if (!client)
  throw new Error(
    "Set HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY (and HEDERA_OPERATOR_KEY_TYPE=ED25519 for raw ED25519 keys)",
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
