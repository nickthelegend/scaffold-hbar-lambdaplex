import type { Balance, Order } from "@sh/lambdaplex";
import { useQuery } from "@tanstack/react-query";
import { useTradingStatus } from "~~/hooks/lambdaplex/useTradingStatus";
import { serverApi } from "~~/utils/lambdaplex/api";

export const useBalances = () => {
  const { data: status } = useTradingStatus();
  return useQuery({
    queryKey: ["lambdaplex", "balances"],
    enabled: Boolean(status?.tradingEnabled),
    refetchInterval: 10_000,
    queryFn: async () => (await serverApi.get<{ balances: Balance[] }>("/api/lambdaplex/account")).balances,
  });
};

export const useOpenOrders = (symbol: string) => {
  const { data: status } = useTradingStatus();
  return useQuery({
    queryKey: ["lambdaplex", "openOrders", symbol],
    enabled: Boolean(status?.tradingEnabled),
    refetchInterval: 5_000,
    queryFn: () => serverApi.get<Order[]>(`/api/lambdaplex/orders?symbol=${encodeURIComponent(symbol)}`),
  });
};
