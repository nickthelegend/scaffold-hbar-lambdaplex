import { type PlanEntry, type TrackRecordEntry, decodeEntry, decodePlan, mirrorTransactionId } from "@sh/lambdaplex";

export type HederaNetwork = "testnet" | "mainnet";

export const MIRROR: Record<HederaNetwork, string> = {
  testnet: "https://testnet.mirrornode.hedera.com/api/v1",
  mainnet: "https://mainnet-public.mirrornode.hedera.com/api/v1",
};

export const hashscan = (network: HederaNetwork, kind: "transaction" | "topic" | "account" | "contract", id: string) =>
  `https://hashscan.io/${network}/${kind}/${id}`;

export type TrackRecordMessage = {
  sequenceNumber: number;
  consensusTimestamp: string;
  payer: string;
  entry: TrackRecordEntry;
};

export type MirrorTopicMessage = {
  sequence_number: number;
  consensus_timestamp: string;
  payer_account_id: string;
  message: string;
};

const decodeBase64 = (value: string) => new TextDecoder().decode(Uint8Array.from(atob(value), c => c.charCodeAt(0)));

/** Decodes mirror-node topic messages (base64 payloads) into track-record entries, skipping anything malformed. */
export const decodeTopicMessages = (messages: MirrorTopicMessage[]): TrackRecordMessage[] =>
  messages.flatMap(m => {
    const entry = decodeEntry(decodeBase64(m.message));
    return entry
      ? [
          {
            sequenceNumber: m.sequence_number,
            consensusTimestamp: m.consensus_timestamp,
            payer: m.payer_account_id,
            entry,
          },
        ]
      : [];
  });

export type PlanMessage = { sequenceNumber: number; consensusTimestamp: string; plan: PlanEntry };

/** Decodes the topic's dry-run plan records (see `PlanEntry`); fills and anything malformed are skipped. */
export const decodePlanMessages = (messages: MirrorTopicMessage[]): PlanMessage[] =>
  messages.flatMap(m => {
    const plan = decodePlan(decodeBase64(m.message));
    return plan ? [{ sequenceNumber: m.sequence_number, consensusTimestamp: m.consensus_timestamp, plan }] : [];
  });

/** Absolute URL of the mirror node's `links.next` (a path such as `/api/v1/topics/…?timestamp=gt:…`), or null. */
export const mirrorNextUrl = (network: HederaNetwork, next?: string | null): string | null =>
  next ? `${new URL(MIRROR[network]).origin}${next}` : null;

export const MAX_TRACK_RECORD_MESSAGES = 5_000;

/** Fills and dry-run plans from an HCS topic, oldest first, following `links.next` up to `maxMessages`. */
export async function fetchTrackRecord(
  network: HederaNetwork,
  topicId: string,
  maxMessages = MAX_TRACK_RECORD_MESSAGES,
): Promise<{ fills: TrackRecordMessage[]; plans: PlanMessage[] }> {
  let url: string | null = `${MIRROR[network]}/topics/${topicId}/messages?order=asc&limit=100`;
  const messages: MirrorTopicMessage[] = [];
  while (url && messages.length < maxMessages) {
    const res = await fetch(url);
    if (res.status === 404) return { fills: [], plans: [] };
    if (!res.ok) throw new Error(`Mirror node: topic ${topicId} (${res.status})`);
    const page = (await res.json()) as { messages: MirrorTopicMessage[]; links?: { next?: string | null } };
    messages.push(...page.messages);
    url = mirrorNextUrl(network, page.links?.next);
  }
  return { fills: decodeTopicMessages(messages), plans: decodePlanMessages(messages) };
}

export type TopicInfo = { memo: string; submitKey: string | null; adminKey: string | null };

export async function fetchTopic(network: HederaNetwork, topicId: string): Promise<TopicInfo | null> {
  const res = await fetch(`${MIRROR[network]}/topics/${topicId}`);
  if (!res.ok) return null;
  const topic = (await res.json()) as {
    memo: string;
    submit_key: { key: string } | null;
    admin_key: { key: string } | null;
  };
  return { memo: topic.memo, submitKey: topic.submit_key?.key ?? null, adminKey: topic.admin_key?.key ?? null };
}

/** Lambdaplex settles on mainnet: confirm the settlement transaction exists there and succeeded. */
export async function verifySettlement(settlementTx: string): Promise<boolean> {
  const res = await fetch(`${MIRROR.mainnet}/transactions/${mirrorTransactionId(settlementTx)}`);
  if (!res.ok) return false;
  const { transactions } = (await res.json()) as { transactions: { result: string }[] };
  return transactions.some(tx => tx.result === "SUCCESS");
}
