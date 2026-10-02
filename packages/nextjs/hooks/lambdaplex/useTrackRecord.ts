import { summarize } from "@sh/lambdaplex";
import { useQuery } from "@tanstack/react-query";
import { type HederaNetwork, fetchTopic, fetchTrackRecord, verifySettlement } from "~~/utils/lambdaplex/hedera";

export const SHOWN_ENTRIES = 100;

/** A strategy's HCS track record (all pages) plus verification of the newest entries' mainnet settlement transactions. */
export const useTrackRecord = (network: HederaNetwork, topicId?: string) =>
  useQuery({
    queryKey: ["track-record", network, topicId],
    enabled: Boolean(topicId && /^0\.0\.\d+$/.test(topicId)),
    refetchInterval: 20_000,
    queryFn: async () => {
      const [topic, messages] = await Promise.all([fetchTopic(network, topicId!), fetchTrackRecord(network, topicId!)]);
      // The summary covers every entry; only the newest ones are listed, and checked against the mirror node.
      const recent = messages.slice(-SHOWN_ENTRIES);
      const verified = await Promise.all(recent.map(m => verifySettlement(m.entry.settlementTx).catch(() => false)));
      return {
        topic,
        total: messages.length,
        messages: recent.map((m, i) => ({ ...m, verified: verified[i] })),
        summary: summarize(messages.map(m => m.entry)),
      };
    },
  });
