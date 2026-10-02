export type OrderSide = "BUY" | "SELL";
export type OrderType = "LIMIT" | "MARKET";
export type TimeInForce = "GTC" | "IOC" | "FOK" | "GTD" | "POST_ONLY";
export type OrderStatus = "OPEN" | "ACTIVE" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "EXPIRED" | "FAILED";

export type ExchangeSymbol = {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  baseAssetPrecision: number;
  quoteAssetPrecision: number;
  status: string;
  filters: Array<{ filterType: string } & Record<string, unknown>>;
};

export type ExchangeInfo = { exchangeSymbols: ExchangeSymbol[] };

/** Price levels as [price, quantity] decimal strings. */
export type OrderBook = { lastUpdateId: number; bids: [string, string][]; asks: [string, string][] };

export type PublicTrade = {
  id: number;
  price: string;
  qty: string;
  quoteQty: string;
  time: number;
  isBuyerMaker: boolean;
};

export type TickerPrice = { symbol: string; price: string };

/** Decimal amounts arrive as JSON numbers on some endpoints and strings on others; normalise with `String()`. */
export type Amount = number | string;

export type NewOrder = {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  /** Required by Lambdaplex; makes retries idempotent. Max 32 characters. */
  newClientOrderId: string;
  quantity?: string;
  quoteOrderQty?: string;
  price?: string;
  timeInForce?: TimeInForce;
};

export type OrderAck = {
  symbol: string;
  orderId: string;
  clientOrderId: string;
  transactTime: number;
  acceptedExpireTime?: number;
};

export type Order = {
  symbol: string;
  orderId: string;
  clientOrderId: string;
  side: OrderSide;
  type: OrderType;
  timeInForce?: TimeInForce;
  status: OrderStatus;
  price: Amount;
  origQty: Amount;
  executedQty: Amount;
  cumulativeQuoteQty: Amount;
  time: number;
  updateTime: number;
};

export type CancelAck = Omit<Order, "time" | "updateTime" | "clientOrderId"> & {
  origClientOrderId: string;
  transactTime: number;
};

export type Balance = { asset: string; free: Amount; locked: Amount };

export type Account = { balances: Balance[]; commissionRates?: { maker: number; taker: number } };

/** A settlement-final fill. `settlementTransactionId` is the Hedera transaction that moved the tokens. */
export type Fill = {
  cursorId: number;
  orderId: string;
  price: Amount;
  qty: Amount;
  quoteQty: Amount;
  commission: Amount;
  commissionAsset: string;
  time: number;
  isBuyer: boolean;
  isMaker: boolean;
  selfTrade?: boolean;
  settlementTransactionId: string;
};

export type OrderFillsPage = {
  contract: "ORDER_SCOPED_FILLS_V1";
  finality: "SETTLEMENT_FINAL";
  symbol: string;
  presence: "PRESENT" | "ABSENT";
  order?: {
    orderId: string;
    clientOrderId: string;
    side: OrderSide;
    status: OrderStatus;
    terminal: boolean;
    executedQty: string;
    cumulativeQuoteQty: string;
  };
  settledExecutedQty: string;
  settledCumulativeQuoteQty: string;
  pendingSettlementQty: string;
  fills: Fill[];
  hasMore?: boolean;
  nextPageAfterCursorId?: number;
};
