# Lambdaplex Terminal: trade Hedera's order book from your own app

[![CI](https://github.com/nickthelegend/scaffold-hbar-lambdaplex/actions/workflows/ci.yaml/badge.svg)](https://github.com/nickthelegend/scaffold-hbar-lambdaplex/actions/workflows/ci.yaml) · **Live demo (read-only): <https://terminal-production-2a39.up.railway.app>**

A Scaffold-HBAR template for building on [Lambdaplex](https://www.lambdaplex.io), the Hedera-native order-book
exchange. It gives you:
- a **live terminal**: markets, order book and trades over REST and WebSocket, plus a price chart;
- **Ed25519-signed trading** from server routes, so keys never touch the browser;
- a **TWAP bot** that reports fills only once they are settlement-final on Hedera;
- a **verifiable track record** on the Hedera Consensus Service, indexed on-chain by a `StrategyRegistry`.

```bash
npm create scaffold-hbar@latest -- --template nickthelegend/scaffold-hbar-lambdaplex
```

| | |
|---|---|
| Ecosystem integration | **Lambdaplex**: REST + WebSocket market data, Signature V1/V2 request signing, orders, order-scoped settlement-final fills |
| Hedera services | **HCS** (append-only track record, submit-key gated) · **Smart contracts** (`StrategyRegistry`) · **Mirror node** (record reads, settlement verification) · Hedera **transaction ids** as settlement proofs |
| Stack | Next.js App Router · `@sh/lambdaplex` TypeScript SDK · Foundry · Hiero SDK · Yarn workspaces |

Lambdaplex runs on Hedera **mainnet** only. Everything read-only works for everyone straight away. Trading needs
your own API key. The track record and registry live on testnet by default. That matches the bounty brief's
allowance for protocols without a testnet deployment.

---

## Contents

1. [Quickstart (no keys)](#quickstart-no-keys)
2. [Trading](#trading)
3. [TWAP bot](#twap-bot)
4. [Verifiable track record](#verifiable-track-record)
5. [How Lambdaplex works, and what this template handles for you](#how-lambdaplex-works-and-what-this-template-handles-for-you)
6. [Architecture](#architecture)
7. [The `@sh/lambdaplex` SDK](#the-shlambdaplex-sdk)
8. [StrategyRegistry contract](#strategyregistry-contract)
9. [Testing](#testing)
10. [Configuration](#configuration)
11. [Security model](#security-model)
12. [Proof](#proof)
13. [Working with AI agents](#working-with-ai-agents)

---

## Quickstart (no keys)

Prerequisites: Node ≥ 20.18.3, Yarn via `corepack enable` (the repo pins Yarn 3.2.3), Git, and Foundry if you
want to work on contracts. The template is Yarn-only.

```bash
npm create scaffold-hbar@latest -- --template nickthelegend/scaffold-hbar-lambdaplex
cd my-hedera-dapp
yarn next:dev                                   # http://localhost:3000
```

- `/` lists every Lambdaplex market with its last price and trading rules.
- `/trade/HBAR-USDC` shows the live order book (WebSocket `@depth` + REST snapshots), the trade tape, a price chart
  and the order form. Click a book level to copy its price.
- `/bots` runs a **dry-run TWAP**: every slice is planned and validated against the live book, and nothing is sent.
- `/registry` lists strategies registered on-chain.
- `/api/health` is a JSON health check.

From the terminal:

```bash
yarn lambdaplex:twap --total 10 --slices 2        # dry run against live market data
yarn lambdaplex:test                              # SDK unit tests
yarn lambdaplex:test:live                         # tests against the real Lambdaplex API
```

## Trading

1. In the Lambdaplex app, connect your Hedera wallet and create an **API key**. Keep its Ed25519 private key. The SDK
   accepts base64 PKCS#8 (what Lambdaplex shows), PEM, or a 32-byte hex seed.
2. Fund the account with HBAR and USDC. The exchange minimum is 5 USDC per order.
3. Configure the server:

   ```bash
   cp packages/nextjs/.env.example packages/nextjs/.env.local
   # LAMBDAPLEX_API_KEY=...  LAMBDAPLEX_PRIVATE_KEY=...  TRADING_ENABLED=true
   ```

4. Restart `yarn next:dev`. The trade page now shows balances and open orders and enables the order form.

The order form validates every order against the market's live rules before sending: tick size, lot step, minimum
quantity, minimum notional, and the percent-price band around the best price. The server re-validates it
(`app/api/lambdaplex/orders`). Problems are explained in plain words instead of surfacing as exchange rejections.

## TWAP bot

A **time-weighted average price** executor ([`packages/lambdaplex/src/twap.ts`](packages/lambdaplex/src/twap.ts)):

1. Split `total` into `slices` equal parts (exactly, in decimal arithmetic).
2. For each slice, read the best opposite price and place an **IOC limit** capped at `maxSlippageBps` from it. The
   cap is rounded to the tick *inside* the bound.
3. Size BUYs in whole lots within the quote budget. If a slice is below the exchange minimum, it **rolls into the
   next slice** rather than failing.
4. Poll `/api/v2/order/fills` until the order is `terminal` and `pendingSettlementQty == 0`. Only then are fills
   reported, each with its Hedera `settlementTransactionId`.
5. Carry anything unfilled into the next slice, and stop after 3 consecutive failures.

Run it from the UI (`/bots`, jobs run inside the Next server) or as a long-lived CLI process:

```bash
yarn lambdaplex:twap --symbol HBAR-USDC --side BUY --total 10 --slices 2 --interval 60 --slippage-bps 50 --live
```

## Verifiable track record

Signal sellers and copy-trading products have a trust problem: anyone can post a screenshot of their P&L. This
template publishes every settled fill to an **HCS topic** whose **submit key** belongs to the strategy operator:

- **Ordered and immutable.** Messages get consensus timestamps and sequence numbers and can't be edited or removed.
- **Attributable.** Only the operator's key can append, so nobody can impersonate the strategy.
- **Checkable.** Each entry carries the Hedera transaction id that settled the trade. `/bots` looks every one up on
  the mainnet mirror node and shows **verified** only if it exists and succeeded.

```bash
yarn lambdaplex:topic:create          # prints TRACK_RECORD_TOPIC_ID; put it in .env.local
```

Entry format (`v: 1`, under 1 KiB, decoded strictly; anything malformed is ignored):

```json
{"v":1,"strategy":"twap-hbar-usdc","venue":"lambdaplex","symbol":"HBAR-USDC","side":"BUY",
 "orderId":"…","clientOrderId":"twap-x1-0","price":"0.101057","qty":"49","quoteQty":"4.951793",
 "commission":"0.0049","commissionAsset":"HBAR","time":1790969771400,"settlementTx":"0.0.…@1790969771.400000000"}
```

## How Lambdaplex works, and what this template handles for you

Lambdaplex is "an order placement and authorization protocol". Traders sign orders off-chain, a matching service
pairs them, and an on-chain **settlement contract** verifies each trade against the signed conditions before moving
tokens. Fills therefore have a Hedera transaction id, which this template treats as the proof of a trade.

| Concern | What the template does | Code |
|---|---|---|
| **Signature V1** (orders, account, fills) | Params in send order + `recvWindow` + `timestamp`, `k=v&…`, Ed25519, base64 `signature` param | [`signing.ts`](packages/lambdaplex/src/signing.ts) |
| **Signature V2** (`X-PLEX-*` headers) | Canonical text `LPX-ED25519-V2\n<key>\n<METHOD>\n<path>\n<ts>\n<recvWindow>\n<sha256(body)>\n` | [`signing.ts`](packages/lambdaplex/src/signing.ts) |
| Clock skew | Syncs with `/api/v1/time` before the first signed call | [`client.ts`](packages/lambdaplex/src/client.ts) |
| Exchange rules | Tick, step, min qty, min notional, per-side price band; exact decimal maths, never floats | [`filters.ts`](packages/lambdaplex/src/filters.ts), [`decimal.ts`](packages/lambdaplex/src/decimal.ts) |
| Idempotency | `newClientOrderId` is required by Lambdaplex; generated per order or per TWAP slice | `orders/route.ts`, `twap.ts` |
| Finality | IOC orders can report `EXPIRED` before their fills settle; the bot waits for `terminal && pendingSettlementQty == 0` | `twap.ts` |
| Live data | WebSocket `subscribe` to `<symbol>@depth` and `<symbol>@trade`; depth diffs trigger REST snapshots, trades stream in; polling fallback | [`useMarketStream.ts`](packages/nextjs/hooks/lambdaplex/useMarketStream.ts) |
| Errors | RFC 7807 problem details and `{code,msg}` mapped to `LambdaplexError`; signed URLs are never echoed back | `client.ts`, `lambdaplex.server.ts` |

The signing code is checked byte-for-byte against the **Hummingbot connector's published vectors** (V1) and the
**deterministic vector in the Lambdaplex docs** (V2).

## Architecture

```
Browser ──REST/WS (public, CORS open)──────────────▶ api.lambdaplex.io
   │
   ├──▶ Next.js route handlers (server only) ──Signature V1──▶ api.lambdaplex.io (orders, account, fills)
   │        └── TWAP jobs ──fills──▶ HCS topic (Hiero SDK, operator key)
   │
   ├──▶ Mirror node (testnet): track-record topic messages, topic submit key
   ├──▶ Mirror node (mainnet): settlement transaction lookups
   └──▶ StrategyRegistry (Hedera testnet, wagmi)
```

```
packages/
├── lambdaplex/        @sh/lambdaplex: signing, client, rules, decimal, TWAP, track record (+ unit & live tests, CLIs)
├── foundry/           StrategyRegistry.sol + tests + deploy script
└── nextjs/            terminal UI, server routes (app/api/lambdaplex, app/api/bots), hooks, mirror-node utils
```

## The `@sh/lambdaplex` SDK

Two entry points keep server secrets out of browser bundles:

- `@sh/lambdaplex`, browser-safe: `marketRules`, `validateLimitOrder`, decimal helpers, `planSlices`/`planSlice`,
  `runTwap`, track-record encode/decode/summarise, types.
- `@sh/lambdaplex/server`, Node only: `LambdaplexClient`, `signV1`/`signV2Headers`/`loadEd25519Key`,
  `createTrackRecordTopic`, `publishEntry`, `readTrackRecord`, `verifySettlement`.

```ts
import { LambdaplexClient } from "@sh/lambdaplex/server";

const lp = new LambdaplexClient({ apiKey: process.env.LAMBDAPLEX_API_KEY, privateKey: process.env.LAMBDAPLEX_PRIVATE_KEY });
const book = await lp.depth("HBAR-USDC", 5);
const ack = await lp.placeOrder({
  symbol: "HBAR-USDC", side: "BUY", type: "LIMIT", timeInForce: "IOC",
  price: book.asks[0][0], quantity: "50", newClientOrderId: "my-order-1",
});
const fills = await lp.orderFills("HBAR-USDC", ack.orderId); // settlementTransactionId per fill
```

## StrategyRegistry contract

[`packages/foundry/contracts/StrategyRegistry.sol`](packages/foundry/contracts/StrategyRegistry.sol) is an on-chain
directory that other contracts and apps can trust:

| Function | Purpose |
|---|---|
| `register(name, topicNum, venueAccount, paramsHash)` | Binds a strategy to its operator, HCS topic `0.0.<topicNum>`, Lambdaplex account and parameter hash |
| `update`, `setActive`, `transferOperator` | Operator-only maintenance |
| `anchorCheckpoint(id, sequenceNumber, runningHash, realizedPnl)` | Anchors the topic's 48-byte running hash at a sequence number; checkpoints only move forward |
| `getStrategy`, `latestCheckpoint`, `listStrategies(offset, limit)`, `strategiesOf(operator)` | Reads |

A copy-trading vault, for example, can require a strategy to be registered and active, with a recent checkpoint.

```bash
yarn foundry:test
yarn foundry:account:generate                   # fund the address at https://portal.hedera.com/faucet
yarn foundry:deploy --network hedera_testnet    # writes packages/nextjs/contracts/deployedContracts.ts
```

## Testing

No simulated exchange anywhere: unit tests use published vectors and real captured API responses, and live tests
hit the real API.

| Suite | Command | What it proves |
|---|---|---|
| SDK unit | `yarn lambdaplex:test` | V1 signatures equal Hummingbot's vectors, V2 equals the docs vector; decimal maths; rule validation on a captured `exchangeInfo`; TWAP slicing, pricing and roll-over; track-record schema |
| SDK live | `yarn lambdaplex:test:live` | Real API: markets and rules parse, book is sane, a full TWAP plans against the live book, and (with keys) a signed `/account` call authenticates |
| Contracts | `yarn foundry:test` | Registry access control, validation, monotonic checkpoints, paging, fuzzed registration |
| Frontend | `yarn next:test` | Number formatting, HCS message decoding |
| Quality | `yarn lint && yarn next:check-types && yarn next:build` | ESLint/Prettier, forge fmt, `tsc` across packages, production build |

## Configuration

`packages/nextjs/.env.local` (copy from `.env.example`):

| Variable | Side | Purpose |
|---|---|---|
| `LAMBDAPLEX_API_KEY`, `LAMBDAPLEX_PRIVATE_KEY` | server | Signing; required for trading |
| `TRADING_ENABLED` | server | Must be `true` for orders and live TWAPs, even with keys present |
| `HEDERA_NETWORK`, `HEDERA_OPERATOR_ID`, `HEDERA_OPERATOR_KEY` | server | Operator that publishes the HCS track record |
| `TRACK_RECORD_TOPIC_ID` / `NEXT_PUBLIC_TRACK_RECORD_TOPIC_ID` | server / browser | Topic to publish to / display |
| `STRATEGY_NAME` | server | Name written into each entry |
| `NEXT_PUBLIC_LAMBDAPLEX_API_BASE`, `NEXT_PUBLIC_LAMBDAPLEX_WS_URL` | browser | Override endpoints |

## Security model

- **Keys stay on the server.** Only route handlers (`import "server-only"`) and the CLI read them. The browser
  bundle imports `@sh/lambdaplex`, never `@sh/lambdaplex/server`.
- **Read-only by default.** `TRADING_ENABLED` must be explicitly `true`. Hosted demos run without it.
- **Defence in depth on orders.** Symbol and decimal formats are checked, then the live market rules, before signing.
- **Error hygiene.** Error responses carry the exchange's message but never the signed request URL.
- **Track-record integrity** comes from HCS consensus ordering plus the topic's submit key, not from this app.
- The demo TWAP job store is in-memory: fine for a dev server, not for production. Use the CLI under a process
  manager for real bots.

## Proof

<!-- PROOF:START -->
Pending: StrategyRegistry deployment, track-record topic, and a live mainnet TWAP.
<!-- PROOF:END -->

## Working with AI agents

[`AGENTS.md`](AGENTS.md) briefs coding agents on the packages, invariants and commands. [`.harness/`](.harness/)
holds a [Hedera Harness](https://github.com/hedera-dev/hedera-harness) recipe with static, build and route
validators.

## License

MIT. See [LICENCE](LICENCE). Built on [Scaffold-HBAR](https://github.com/hedera-dev/scaffold-hbar). Lambdaplex is a
product of Lambdaplex Labs; this template is an independent integration.
