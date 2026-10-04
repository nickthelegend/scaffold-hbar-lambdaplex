import {
  AccountId,
  Client,
  PrivateKey,
  TopicCreateTransaction,
  TopicId,
  TopicMessageSubmitTransaction,
} from "@hiero-ledger/sdk";
import {
  decodeEntry,
  encodeEntry,
  encodePlan,
  mirrorTransactionId,
  type PlanEntry,
  type TrackRecordEntry,
} from "./trackRecord";

export const MIRROR_NODES = {
  testnet: "https://testnet.mirrornode.hedera.com/api/v1",
  mainnet: "https://mainnet-public.mirrornode.hedera.com/api/v1",
} as const;

/**
 * Parses a Hedera operator key: DER-encoded keys of either curve, or a raw 32-byte hex key of type `type`
 * (`HEDERA_OPERATOR_KEY_TYPE`, ECDSA by default, as the Hedera portal issues).
 */
export function parseOperatorKey(text: string, type = "ECDSA"): PrivateKey {
  const key = text.trim();
  if (/^(0x)?30[0-9a-f]{64,}$/i.test(key)) return PrivateKey.fromStringDer(key);
  return type.toUpperCase() === "ED25519" ? PrivateKey.fromStringED25519(key) : PrivateKey.fromStringECDSA(key);
}

/** HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY, HEDERA_OPERATOR_KEY_TYPE, HEDERA_NETWORK; usually `process.env`. */
type OperatorEnv = Record<string, string | undefined>;

/** A Hedera client for the configured operator, or undefined when no operator is set. Throws on a malformed key. */
export function operatorClient(env: OperatorEnv): Client | undefined {
  const { HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY, HEDERA_OPERATOR_KEY_TYPE, HEDERA_NETWORK } = env;
  if (!HEDERA_OPERATOR_ID || !HEDERA_OPERATOR_KEY) return undefined;
  const operatorId = AccountId.fromString(HEDERA_OPERATOR_ID);
  const operatorKey = parseOperatorKey(HEDERA_OPERATOR_KEY, HEDERA_OPERATOR_KEY_TYPE);
  return (HEDERA_NETWORK === "mainnet" ? Client.forMainnet() : Client.forTestnet()).setOperator(
    operatorId,
    operatorKey,
  );
}

/** Creates a track-record topic that only the client's operator can write to. */
export async function createTrackRecordTopic(client: Client, memo: string) {
  const operatorKey = client.operatorPublicKey;
  if (!operatorKey) throw new Error("The Hedera client needs an operator to create a topic");
  const response = await new TopicCreateTransaction().setTopicMemo(memo).setSubmitKey(operatorKey).execute(client);
  const { topicId } = await response.getReceipt(client);
  return topicId!.toString();
}

/** Publishes a dry-run plan record (see `PlanEntry`) to the strategy's topic. */
export async function publishPlan(client: Client, topicId: string, plan: PlanEntry) {
  const response = await new TopicMessageSubmitTransaction()
    .setTopicId(TopicId.fromString(topicId))
    .setMessage(encodePlan(plan))
    .execute(client);
  const receipt = await response.getReceipt(client);
  return { transactionId: response.transactionId.toString(), sequenceNumber: Number(receipt.topicSequenceNumber) };
}

export async function publishEntry(client: Client, topicId: string, entry: TrackRecordEntry) {
  const response = await new TopicMessageSubmitTransaction()
    .setTopicId(TopicId.fromString(topicId))
    .setMessage(encodeEntry(entry))
    .execute(client);
  const receipt = await response.getReceipt(client);
  return { transactionId: response.transactionId.toString(), sequenceNumber: Number(receipt.topicSequenceNumber) };
}

export type TrackRecordMessage = {
  sequenceNumber: number;
  consensusTimestamp: string;
  payer: string;
  entry: TrackRecordEntry;
};

type MirrorTopicMessage = {
  sequence_number: number;
  consensus_timestamp: string;
  payer_account_id: string;
  message: string;
};

/**
 * Reads and decodes a track-record topic from the mirror node, oldest first, following `links.next` up to
 * `maxMessages`. Malformed messages are skipped.
 */
export async function readTrackRecord(
  mirrorUrl: string,
  topicId: string,
  maxMessages = 10_000,
): Promise<TrackRecordMessage[]> {
  const origin = new URL(mirrorUrl).origin;
  let url: string | null = `${mirrorUrl}/topics/${topicId}/messages?order=asc&limit=100`;
  const messages: MirrorTopicMessage[] = [];
  while (url && messages.length < maxMessages) {
    const res = await fetch(url);
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`Mirror node topic ${topicId}: HTTP ${res.status}`);
    const page = (await res.json()) as { messages: MirrorTopicMessage[]; links?: { next?: string | null } };
    messages.push(...page.messages);
    url = page.links?.next ? `${origin}${page.links.next}` : null;
  }
  return messages.flatMap(message => {
    const entry = decodeEntry(Buffer.from(message.message, "base64").toString("utf8"));
    return entry
      ? [
          {
            sequenceNumber: message.sequence_number,
            consensusTimestamp: message.consensus_timestamp,
            payer: message.payer_account_id,
            entry,
          },
        ]
      : [];
  });
}

/** Whether the settlement transaction an entry points at exists and succeeded on the given network. */
export async function verifySettlement(mirrorUrl: string, settlementTx: string): Promise<boolean> {
  const res = await fetch(`${mirrorUrl}/transactions/${mirrorTransactionId(settlementTx)}`);
  if (!res.ok) return false;
  const { transactions } = (await res.json()) as { transactions: { result: string }[] };
  return transactions.some(tx => tx.result === "SUCCESS");
}
