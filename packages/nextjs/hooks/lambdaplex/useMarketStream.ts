import { useEffect, useRef, useState } from "react";
import { type OrderBook, type PublicTrade, mul } from "@sh/lambdaplex";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LAMBDAPLEX_WS, publicApi } from "~~/utils/lambdaplex/api";

type WsTrade = { e: "trade"; s: string; t: number; p: string; q: string; m: boolean; E: number; T?: number };

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
    let trailingDepth: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const refreshDepth = () => {
      lastSnapshot.current = Date.now();
      void queryClient.invalidateQueries({ queryKey: ["lambdaplex", "depth", symbol] });
    };

    const onMessage = (message: MessageEvent) => {
      try {
        handle(JSON.parse(String(message.data)) as { e?: string });
      } catch {
        // Not JSON or not a frame we understand (e.g. a keep-alive): REST polling keeps the view correct.
      }
    };

    const handle = (data: { e?: string }) => {
      if (data.e === "trade") {
        const t = data as WsTrade;
        const trade: PublicTrade = {
          id: t.t,
          price: t.p,
          qty: t.q,
          quoteQty: mul(t.p, t.q),
          time: t.T ?? t.E,
          isBuyerMaker: t.m,
        };
        queryClient.setQueryData<PublicTrade[]>(["lambdaplex", "trades", symbol], prev =>
          [trade, ...(prev ?? []).filter(p => p.id !== trade.id)].slice(0, 100),
        );
      } else if (data.e === "depthUpdate") {
        // At most one snapshot per second, and always one after the last update of a burst.
        const wait = 1_000 - (Date.now() - lastSnapshot.current);
        if (wait <= 0) refreshDepth();
        else
          trailingDepth ??= setTimeout(() => {
            trailingDepth = undefined;
            refreshDepth();
          }, wait);
      }
    };

    const open = () => {
      const ws = new WebSocket(LAMBDAPLEX_WS);
      socket = ws;
      ws.onopen = () => {
        setConnected(true);
        ws.send(JSON.stringify({ method: "subscribe", params: [`${symbol}@trade`, `${symbol}@depth`], id: 1 }));
      };
      ws.onmessage = onMessage;
      ws.onclose = () => {
        if (socket !== ws) return; // a stale socket from a previous symbol
        setConnected(false);
        if (!closed) retry = setTimeout(open, 5_000);
      };
      ws.onerror = () => ws.close();
    };

    open();
    return () => {
      closed = true;
      clearTimeout(retry);
      clearTimeout(trailingDepth);
      if (socket) {
        socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
        socket.close();
      }
      setConnected(false);
    };
  }, [symbol, queryClient]);

  return {
    book: book.data as OrderBook | undefined,
    trades: trades.data,
    connected,
    error: book.error ?? trades.error,
  };
}
