import { summarize } from "@sh/lambdaplex";
import { useQuery } from "@tanstack/react-query";
import { type HederaNetwork, fetchTopic, fetchTrackRecord, verifySettlement } from "~~/utils/lambdaplex/hedera";

/** A strategy's HCS track record plus per-entry verification of the mainnet settlement transaction. */
export const useTrackRecord = (network: HederaNetwork, topicId?: string) =>
  useQuery({
    queryKey: ["track-record", network, topicId],
    enabled: Boolean(topicId && /^0\.0\.\d+$/.test(topicId)),
    refetchInterval: 20_000,
    queryFn: async () => {
      const [topic, messages] = await Promise.all([fetchTopic(network, topicId!), fetchTrackRecord(network, topicId!)]);
      const verified = await Promise.all(messages.map(m => verifySettlement(m.entry.settlementTx).catch(() => false)));
      return {
        topic,
        messages: messages.map((m, i) => ({ ...m, verified: verified[i] })),
        summary: summarize(messages.map(m => m.entry)),
      };
    },
  });
