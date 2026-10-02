import { useQuery } from "@tanstack/react-query";
import { serverApi } from "~~/utils/lambdaplex/api";

export type TradingStatus = {
  tradingEnabled: boolean;
  hasCredentials: boolean;
  trackRecordTopicId: string | null;
  trackRecordNetwork: "testnet" | "mainnet";
};

export const useTradingStatus = () =>
  useQuery({
    queryKey: ["lambdaplex", "status"],
    queryFn: () => serverApi.get<TradingStatus>("/api/lambdaplex/status"),
    staleTime: 60_000,
  });
