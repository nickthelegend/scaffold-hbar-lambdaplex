import { useEffect, useRef, useState } from "react";
import type { OrderBook, PublicTrade } from "@sh/lambdaplex";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LAMBDAPLEX_WS, publicApi } from "~~/utils/lambdaplex/api";

type WsTrade = { e: "trade"; s: string; t: number; p: string; q: string; m: boolean; E: number };

/**
 * Order book and trade tape for one market. REST snapshots are the source of truth; the WebSocket
 * (`<symbol>@depth`, `<symbol>@trade`) makes them live: depth events trigger a fresh snapshot and trades are
 * prepended as they print. If the socket drops, polling keeps the view current.
 */
export function useMarketStream(symbol: string) {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const lastSnapshot = useRef(0);

  const book = useQuery({
    queryKey: ["lambdaplex", "depth", symbol],
    queryFn: () => publicApi.depth(symbol, 20),
    refetchInterval: connected ? 15_000 : 3_000,
  });
  const trades = useQuery({
    queryKey: ["lambdaplex", "trades", symbol],
    queryFn: async () => (await publicApi.trades(symbol, 100)).sort((a, b) => b.time - a.time),
    refetchInterval: connected ? 60_000 : 10_000,
  });

  useEffect(() => {
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const open = () => {
      socket = new WebSocket(LAMBDAPLEX_WS);
      socket.onopen = () => {
        setConnected(true);
        socket?.send(JSON.stringify({ method: "subscribe", params: [`${symbol}@trade`, `${symbol}@depth`], id: 1 }));
      };
      socket.onmessage = message => {
        const data = JSON.parse(String(message.data)) as { e?: string };
        if (data.e === "trade") {
          const t = data as WsTrade;
          const trade: PublicTrade = {
            id: t.t,
            price: t.p,
            qty: t.q,
            quoteQty: String(Number(t.p) * Number(t.q)),
            time: t.E,
            isBuyerMaker: t.m,
          };
          queryClient.setQueryData<PublicTrade[]>(["lambdaplex", "trades", symbol], prev =>
            [trade, ...(prev ?? []).filter(p => p.id !== trade.id)].slice(0, 100),
          );
        } else if (data.e === "depthUpdate" && Date.now() - lastSnapshot.current > 1_000) {
          lastSnapshot.current = Date.now();
          void queryClient.invalidateQueries({ queryKey: ["lambdaplex", "depth", symbol] });
        }
      };
      socket.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(open, 5_000);
      };
      socket.onerror = () => socket?.close();
    };

    open();
    return () => {
      closed = true;
      clearTimeout(retry);
      socket?.close();
    };
  }, [symbol, queryClient]);

  return {
    book: book.data as OrderBook | undefined,
    trades: trades.data,
    connected,
    error: book.error ?? trades.error,
  };
}
