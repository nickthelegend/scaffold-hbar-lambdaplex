import { marketRules } from "@sh/lambdaplex";
import { useQuery } from "@tanstack/react-query";
import { publicApi } from "~~/utils/lambdaplex/api";

/** Every Lambdaplex market with its rules and last price. */
export const useMarkets = () =>
  useQuery({
    queryKey: ["lambdaplex", "markets"],
    refetchInterval: 15_000,
    queryFn: async () => {
      const [info, tickers] = await Promise.all([publicApi.exchangeInfo(), publicApi.tickers()]);
      const prices = new Map(tickers.map(t => [t.symbol, t.price]));
      return info.exchangeSymbols.map(symbol => ({
        ...marketRules(symbol),
        status: symbol.status,
        lastPrice: prices.get(symbol.symbol),
      }));
    },
  });
