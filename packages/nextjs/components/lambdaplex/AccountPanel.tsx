"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useBalances, useOpenOrders } from "~~/hooks/lambdaplex/useAccount";
import { useTradingStatus } from "~~/hooks/lambdaplex/useTradingStatus";
import { serverApi } from "~~/utils/lambdaplex/api";
import { formatAmount, formatDateTime } from "~~/utils/lambdaplex/format";
import { notification } from "~~/utils/scaffold-hbar";

/** Balances and open orders of the API key's account. Hidden in read-only mode. */
export const AccountPanel = ({ symbol }: { symbol: string }) => {
  const { data: status } = useTradingStatus();
  const balances = useBalances();
  const orders = useOpenOrders(symbol);
  const queryClient = useQueryClient();

  if (!status?.tradingEnabled) {
    return <p className="m-0 text-sm text-base-content/60">Connect an API key to see balances and open orders.</p>;
  }

  const cancel = async (orderId: string) => {
    try {
      await serverApi.delete(`/api/lambdaplex/orders?symbol=${encodeURIComponent(symbol)}&orderId=${orderId}`);
      notification.success("Order cancelled");
      await queryClient.invalidateQueries({ queryKey: ["lambdaplex", "openOrders", symbol] });
    } catch (error) {
      notification.error(error instanceof Error ? error.message : "Cancel failed");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <section>
        <h3 className="m-0 mb-2 text-sm font-semibold">Balances</h3>
        {balances.error ? (
          <p className="m-0 text-sm text-error">{balances.error.message}</p>
        ) : (
          <ul className="m-0 grid grid-cols-2 gap-2 pl-0 text-sm">
            {(balances.data ?? []).map(b => (
              <li key={b.asset} className="flex justify-between rounded-lg bg-base-200 px-3 py-2">
                <span className="font-medium">{b.asset}</span>
                <span className="tabular-nums">
                  {formatAmount(String(b.free), 4)}
                  {Number(b.locked) > 0 && (
                    <span className="text-base-content/50"> (+{formatAmount(String(b.locked), 4)} locked)</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3 className="m-0 mb-2 text-sm font-semibold">Open orders</h3>
        {!orders.data?.length ? (
          <p className="m-0 text-sm text-base-content/60">None.</p>
        ) : (
          <table className="table table-xs">
            <tbody>
              {orders.data.map(o => (
                <tr key={o.orderId}>
                  <td className={o.side === "BUY" ? "text-success" : "text-error"}>{o.side}</td>
                  <td className="tabular-nums">
                    {formatAmount(String(o.origQty), 2)} @ {formatAmount(String(o.price), 8)}
                  </td>
                  <td className="text-base-content/60">{formatDateTime(o.time)}</td>
                  <td className="text-right">
                    <button className="btn btn-ghost btn-xs" onClick={() => cancel(o.orderId)}>
                      Cancel
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
};
