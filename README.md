# Lambdaplex Terminal: trade Hedera's order book from your own app

[![CI](https://github.com/nickthelegend/scaffold-hbar-lambdaplex/actions/workflows/ci.yaml/badge.svg)](https://github.com/nickthelegend/scaffold-hbar-lambdaplex/actions/workflows/ci.yaml) · **Live demo (read-only): <https://terminal-production-2a39.up.railway.app>** · **Testnet: [StrategyRegistry](https://hashscan.io/testnet/contract/0.0.10852712) + [HCS topic](https://hashscan.io/testnet/topic/0.0.10852716)** ([proof](#proof)) · **[Demo video (67s)](https://github.com/nickthelegend/scaffold-hbar-lambdaplex/releases/download/demo-video/lambdaplex-terminal-demo.mp4)**

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

1. Validate the config (`validateTwapConfig`), then split `total` into `slices` equal parts (exactly, in decimal
   arithmetic).
2. For each slice, read the best opposite price and place an **IOC limit** capped at `maxSlippageBps` from it. The
   cap is rounded to the tick *inside* the bound and kept inside the market's percent-price band.
3. Size BUYs in whole lots within the quote budget. If a slice is below the exchange minimum, it **rolls into the
   next slice** rather than failing.
4. Poll `/api/v2/order/fills` (all pages) until the order is `terminal` and `pendingSettlementQty == 0`. Only then
   are fills reported, each with its Hedera `settlementTransactionId`.
5. Carry anything unfilled into the next slice, and stop after 3 consecutive failures.

**It never trades the same money twice.** Once the exchange may hold an order, the executor finds out what that
order executed before it carries anything:

- `onEvent` (and HCS publishing inside it) is best-effort. If it throws, the error goes to `onEventError` and the
  fill still counts.
- If the placement request fails without an HTTP status (network error, timeout) or with a 5xx, the bot looks the
  order up by its `newClientOrderId`. Found: it is tracked like any accepted order. Absent: the slice is carried.
- If settlement polling times out or keeps failing after an ack, an order that can no longer fill is counted at its
  matched quantity. Otherwise the run **stops** and reports the slice as `unresolved` (CLI exit code 2): check the
  account before trading that amount again.
- Stop (UI) or Ctrl-C (CLI) interrupts the wait between slices and is checked again right before every order. An
  order already sent is still followed to settlement.
- `unfilled` in the result is the carry plus every slice that never ran. Dry runs report everything as unfilled.

Run it from the UI (`/bots`, jobs run inside the Next server) or as a long-lived CLI process:

```bash
yarn lambdaplex:twap --symbol HBAR-USDC --side BUY --total 10 --slices 2 --interval 60 --slippage-bps 50 --live
```

## Verifiable track record

Signal sellers and copy-trading products have a trust problem: anyone can post a screenshot of their P&L. This
template publishes every settled fill to an **HCS topic** whose **submit key** belongs to the strategy operator:

- **Ordered and immutable.** Messages get consensus timestamps and sequence numbers and can't be edited or removed.
- **Attributable.** Only the operator's key can append, so nobody can impersonate the strategy.
- **Checkable.** Each entry carries the Hedera transaction id that settled the trade. `/bots` looks the newest 100
  up on the mainnet mirror node and shows **tx succeeded** if the transaction exists and succeeded. It does not
  match amounts against that transaction, so treat it as evidence, not proof. Totals cover every entry: reads
  follow the mirror node's `links.next` pagination.

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
| Clock skew | Syncs with `/api/v1/time` before the first signed call, every 10 minutes, and again (with one re-signed retry) after a timestamp/`recvWindow` rejection | [`client.ts`](packages/lambdaplex/src/client.ts) |
| Timeouts | Every request carries a 15 s `AbortSignal.timeout` (`timeoutMs`); the TWAP treats a timed-out order as unknown and looks it up | [`client.ts`](packages/lambdaplex/src/client.ts), `twap.ts` |
| Exchange rules | Tick, step, min qty, min notional, per-side price band; exact decimal maths, never floats | [`filters.ts`](packages/lambdaplex/src/filters.ts), [`decimal.ts`](packages/lambdaplex/src/decimal.ts) |
| Idempotency | `newClientOrderId` is required by Lambdaplex; generated per order or per TWAP slice, and used to find an order whose placement response was lost (`orderFills(symbol, { origClientOrderId })`) | `orders/route.ts`, `twap.ts` |
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

- `@sh/lambdaplex`, browser-safe: `marketRules`, `validateLimitOrder`, `validateMarketOrder`, decimal helpers,
  `planSlices`/`planSlice`, `validateTwapConfig`, `runTwap`, track-record encode/decode/summarise, types.
- `@sh/lambdaplex/server`, Node only: `LambdaplexClient` (incl. `allOrderFills`, `getOrderByClientId`,
  `configError`), `signV1`/`signV2Headers`/`loadEd25519Key`, `operatorClient`, `createTrackRecordTopic`,
  `publishEntry`, `readTrackRecord`, `verifySettlement`.

```ts
import { LambdaplexClient } from "@sh/lambdaplex/server";

const lp = new LambdaplexClient({ apiKey: process.env.LAMBDAPLEX_API_KEY, privateKey: process.env.LAMBDAPLEX_PRIVATE_KEY });
const book = await lp.depth("HBAR-USDC", 5);
const ack = await lp.placeOrder({
  symbol: "HBAR-USDC", side: "BUY", type: "LIMIT", timeInForce: "IOC",
  price: book.asks[0][0], quantity: "50", newClientOrderId: "my-order-1",
});
const fills = await lp.allOrderFills("HBAR-USDC", ack.orderId); // every page; settlementTransactionId per fill
```

## StrategyRegistry contract

[`packages/foundry/contracts/StrategyRegistry.sol`](packages/foundry/contracts/StrategyRegistry.sol) is an on-chain
directory that other contracts and apps can read. It records what operators claim; it does not check that the
registrant controls the topic, so consumers should compare the topic's submit key with the operator they expect.

| Function | Purpose |
|---|---|
| `register(name, topicNum, venueAccount, paramsHash)` | Binds a strategy to its operator, HCS topic `0.0.<topicNum>`, Lambdaplex account (≤ 64 bytes) and parameter hash |
| `update`, `setActive`, `transferOperator` | Operator-only maintenance. Moving to a different topic clears the checkpoint (`CheckpointReset`) |
| `anchorCheckpoint(id, sequenceNumber, runningHash, realizedPnl)` | Anchors the topic's 48-byte running hash at a sequence number; checkpoints only move forward |
| `getStrategy`, `latestCheckpoint`, `listStrategies(offset, limit)`, `strategiesOf(operator)` | Reads |

A copy-trading vault, for example, can require a strategy to be registered and active, with a recent checkpoint.

```bash
yarn foundry:test
yarn foundry:account:generate                   # fund the address at https://portal.hedera.com/faucet
yarn foundry:deploy --network hedera_testnet    # writes packages/nextjs/contracts/deployedContracts.ts
```

## Testing

No simulated exchange or HTTP mocks: unit tests use published vectors and real captured API responses, and live
tests hit the real (public) API. The one test double is `runTwap.test.ts`'s in-memory implementation of the four
client calls the executor makes, which is how the failure paths (lost responses, settlement timeouts, aborts,
throwing callbacks) are exercised without placing orders.

| Suite | Command | What it proves |
|---|---|---|
| SDK unit | `yarn lambdaplex:test` | V1 signatures equal Hummingbot's vectors, V2 equals the docs vector; decimal maths; rule validation on a captured `exchangeInfo`; TWAP slicing, pricing and roll-over; `runTwap` never over-executes (throwing callbacks, settlement timeouts, lost responses, aborts); track-record schema |
| SDK live | `yarn lambdaplex:test:live` | Real API: markets and rules parse, book is sane, a full TWAP plans against the live book, and (with keys) a signed `/account` call authenticates |
| Contracts | `yarn foundry:test` | Registry access control, validation, bounded `venueAccount`, monotonic checkpoints, checkpoint reset on topic change, paging, fuzzed registration |
| Frontend | `yarn next:test` | Number formatting, HCS message decoding, mirror-node pagination links |
| Quality | `yarn lint && yarn next:check-types && yarn next:build` | ESLint/Prettier, forge fmt, `tsc` across packages, production build |

## Configuration

`packages/nextjs/.env.local` (copy from `.env.example`):

| Variable | Side | Purpose |
|---|---|---|
| `LAMBDAPLEX_API_KEY`, `LAMBDAPLEX_PRIVATE_KEY` | server | Signing; required for trading |
| `TRADING_ENABLED` | server | Must be `true` for orders and live TWAPs, even with keys present |
| `HEDERA_NETWORK`, `HEDERA_OPERATOR_ID`, `HEDERA_OPERATOR_KEY` | server | Operator that publishes the HCS track record (DER keys of either curve, or raw hex) |
| `HEDERA_OPERATOR_KEY_TYPE` | server | `ECDSA` (default) or `ED25519`, for raw hex operator keys |
| `TRACK_RECORD_TOPIC_ID` / `NEXT_PUBLIC_TRACK_RECORD_TOPIC_ID` | server / browser | Topic to publish to / display |
| `STRATEGY_NAME` | server | Name written into each entry |
| `NEXT_PUBLIC_LAMBDAPLEX_API_BASE`, `NEXT_PUBLIC_LAMBDAPLEX_WS_URL` | browser | Override endpoints |

## Security model

- **Keys stay on the server.** Only route handlers (`import "server-only"`) and the CLI read them. The browser
  bundle imports `@sh/lambdaplex`, never `@sh/lambdaplex/server`.
- **Read-only by default.** `TRADING_ENABLED` must be explicitly `true`. Hosted demos run without it. A malformed
  `LAMBDAPLEX_PRIVATE_KEY` disables trading and is reported as `configError` by `/api/health` and
  `/api/lambdaplex/status`; it never takes the app down.
- **No auth, so keep trading deployments private.** `TRADING_ENABLED` is a switch, not a login: anyone who can reach
  a trading-enabled server can trade with its key. Run it on localhost or behind your own auth.
- **CSRF.** State-changing routes (`POST`/`DELETE` orders, `POST /api/bots/twap`, `DELETE /api/bots/twap/[id]`)
  refuse a browser `Origin` from another host (403), and POSTs must be `application/json` (415), which a cross-site
  form cannot send. Requests without `Origin` (curl, scripts) are allowed.
- **Defence in depth on orders.** Symbol and decimal formats are checked, then the live market rules, before signing.
- **Error hygiene.** Error responses carry the exchange's message but never the signed request URL.
- **Track-record integrity** comes from HCS consensus ordering plus the topic's submit key, not from this app.
- The demo TWAP job store is in-memory and bounded (5 running jobs, the newest 20 finished ones kept): fine for a
  dev server, not for production. Use the CLI under a process manager for real bots.

## Proof

<!-- PROOF:START -->
Everything below can be checked on HashScan and the mirror node.

**Hedera testnet: the on-chain half**

| What | Link |
|---|---|
| `StrategyRegistry` deployed with `yarn foundry:deploy --network hedera_testnet` as contract `0.0.10852712` (`0xfcB9…21d0`), 2.30M gas | [contract](https://hashscan.io/testnet/contract/0.0.10852712) · [deploy tx](https://hashscan.io/testnet/transaction/1791091602.803556288) |
| HCS track-record topic `0.0.10852716` created with `yarn lambdaplex:topic:create`; the submit key is the operator's ECDSA key and there is no admin key, so the record can't be deleted | [topic](https://hashscan.io/testnet/topic/0.0.10852716) · [create tx](https://hashscan.io/testnet/transaction/1791091631.604196395) |
| Strategy #0 `TWAP HBAR-USDC` registered, linked to topic `0.0.10852716`. `paramsHash` = keccak256 of `{"strategy":"twap","symbol":"HBAR-USDC","side":"BUY","total":"50","slices":10,"intervalSeconds":60,"maxSlippageBps":50}` | [register tx](https://hashscan.io/testnet/transaction/1791091653.293133128) |

The hosted terminal's [`/registry`](https://terminal-production-2a39.up.railway.app/registry) page reads strategy #0 from
the contract, and `/bots` reads the topic from the mirror node.

**Hedera mainnet: the Lambdaplex half**

Lambdaplex only runs on mainnet. CI's `live` job calls its public REST API on every push: it parses the live market
rules, checks the HBAR-USDC book, plans a full dry-run TWAP against live data, and validates an order built from the
current best ask. The [CI runs](https://github.com/nickthelegend/scaffold-hbar-lambdaplex/actions/workflows/ci.yaml)
are the evidence. The [hosted terminal](https://terminal-production-2a39.up.railway.app) streams the live HBAR-USDC
book and trades over WebSocket. Its trading routes are switched off (`TRADING_ENABLED=false`), so a public demo can't
spend anyone's funds.

A live TWAP fill needs a funded Lambdaplex API key, which this public deployment deliberately doesn't hold. With your
own key in `.env.local`, `yarn lambdaplex:twap` places real IOC slices, waits until each fill is settlement-final, and
appends it to your topic, where `/bots` verifies it against its mainnet settlement transaction.
<!-- PROOF:END -->

## Working with AI agents

[`AGENTS.md`](AGENTS.md) briefs coding agents on the packages, invariants and commands. [`.harness/`](.harness/)
holds a [Hedera Harness](https://github.com/hedera-dev/hedera-harness) recipe with static, build and route
validators.

## License

MIT. See [LICENCE](LICENCE). Built on [Scaffold-HBAR](https://github.com/hedera-dev/scaffold-hbar). Lambdaplex is a
product of Lambdaplex Labs; this template is an independent integration.
