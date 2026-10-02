import { type Client, TopicCreateTransaction, TopicId, TopicMessageSubmitTransaction } from "@hiero-ledger/sdk";
import { decodeEntry, encodeEntry, mirrorTransactionId, type TrackRecordEntry } from "./trackRecord";

export const MIRROR_NODES = {
  testnet: "https://testnet.mirrornode.hedera.com/api/v1",
  mainnet: "https://mainnet-public.mirrornode.hedera.com/api/v1",
} as const;

/** Creates a track-record topic that only the client's operator can write to. */
export async function createTrackRecordTopic(client: Client, memo: string) {
  const operatorKey = client.operatorPublicKey;
  if (!operatorKey) throw new Error("The Hedera client needs an operator to create a topic");
  const response = await new TopicCreateTransaction().setTopicMemo(memo).setSubmitKey(operatorKey).execute(client);
  const { topicId } = await response.getReceipt(client);
  return topicId!.toString();
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

/** Reads and decodes a track-record topic from the mirror node, oldest first. Malformed messages are skipped. */
export async function readTrackRecord(mirrorUrl: string, topicId: string, limit = 100): Promise<TrackRecordMessage[]> {
  const res = await fetch(`${mirrorUrl}/topics/${topicId}/messages?order=asc&limit=${limit}`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Mirror node topic ${topicId}: HTTP ${res.status}`);
  const { messages } = (await res.json()) as { messages: MirrorTopicMessage[] };
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
