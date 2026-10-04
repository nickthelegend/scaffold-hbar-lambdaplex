import { useQuery } from "@tanstack/react-query";
import { serverApi } from "~~/utils/lambdaplex/api";

export type TradingStatus = {
  tradingEnabled: boolean;
  hasCredentials: boolean;
  /** Supplied credentials that cannot be used, e.g. a malformed private key. */
  configError: string | null;
  trackRecordTopicId: string | null;
  trackRecordNetwork: "testnet" | "mainnet";
  /** "inline" on serverless hosting: dry runs complete within the request and live jobs are unavailable. */
  twapJobs: "inline" | "background";
};

export const useTradingStatus = () =>
  useQuery({
    queryKey: ["lambdaplex", "status"],
    queryFn: () => serverApi.get<TradingStatus>("/api/lambdaplex/status"),
    staleTime: 60_000,
  });
