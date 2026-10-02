# Agent instructions

Briefing for coding agents (Claude Code, Cursor, Codex). Claude Code loads it through `CLAUDE.md`.

This is the **Lambdaplex Terminal** Scaffold-HBAR template: a Next.js terminal and a TypeScript SDK for Lambdaplex
(Hedera's order-book exchange, mainnet only), a TWAP bot, an HCS track record, and a `StrategyRegistry` contract on
Hedera testnet. Read `README.md` → "How Lambdaplex works" before touching signing or order flow.

Yarn only (`yarn <script>`); the root `package.json` pins Yarn 3.2.3.

## Commands

```bash
yarn next:dev                     # terminal on http://localhost:3000 (read-only without keys)
yarn lambdaplex:test              # SDK unit tests (signing vectors, rules, TWAP, track record)
yarn lambdaplex:test:live         # SDK against the real Lambdaplex API
yarn lambdaplex:twap --total 10 --slices 2 [--live]
yarn lambdaplex:topic:create      # HCS topic for the track record
yarn foundry:test                 # StrategyRegistry
yarn foundry:deploy --network hedera_testnet
yarn next:test && yarn next:check-types && yarn lint && yarn next:build
```

## Layout

| Path | What |
|---|---|
| `packages/lambdaplex/src/signing.ts` | Signature V1 (query) and V2 (headers). Changing it must keep the vector tests green |
| `packages/lambdaplex/src/client.ts` | Typed REST client, server-time sync, `LambdaplexError` |
| `packages/lambdaplex/src/decimal.ts`, `filters.ts` | Exact decimal maths and exchange rules |
| `packages/lambdaplex/src/twap.ts` | Pure planning (`planSlices`, `planSlice`, `slicePrice`, `validateTwapConfig`) + `runTwap` |
| `packages/lambdaplex/src/trackRecord.ts`, `hcs.ts` | Entry schema (browser-safe) and HCS publish/read (server) |
| `packages/lambdaplex/src/index.ts` / `server.ts` | Browser-safe vs Node-only entry points |
| `packages/nextjs/lib/*.server.ts` | Server singletons: signed client, trading gate, TWAP job store |
| `packages/nextjs/app/api/lambdaplex/*`, `app/api/bots/*` | Route handlers; the only place keys are used |
| `packages/nextjs/hooks/lambdaplex/*`, `components/lambdaplex/*` | UI data hooks and components |
| `packages/foundry/contracts/StrategyRegistry.sol` | On-chain directory + HCS checkpoints |

## Rules

1. **Never import `@sh/lambdaplex/server` or `~~/lib/*.server` from client components.** Keys must not reach the
   browser. Browser code uses `@sh/lambdaplex` and `utils/lambdaplex/api.ts` (`publicApi` for market data,
   `serverApi` for our routes).
2. **Every trading route checks `tradingEnabled()` first**, then `rejectCrossSite(req)` on POST/DELETE
   (`{ requireJson: true }` for POST), and validates input formats before calling the SDK.
3. **Prices and quantities are decimal strings.** Use `decimal.ts` helpers; never `Number` maths for amounts sent to
   the exchange.
4. **Signature V1 signs params in send order.** Build queries with `signedQuery`, never by hand.
5. **Fills are final only when `order.terminal && pendingSettlementQty == "0"`.** Don't publish track-record entries
   before that.
6. **Never re-trade an order the exchange may hold.** In `runTwap`, a slice is carried only when it certainly
   executed nothing (4xx rejection, or an ambiguous failure followed by an ABSENT lookup by client order id).
   Anything else is resolved through `allOrderFills` or stops the run as `unresolved`. Event callbacks are
   best-effort and must never change trading. Keep `runTwap.test.ts` green when touching this.
7. **Track-record entries are schema-versioned (`v: 1`).** Add fields compatibly or bump `v` and keep decoding the
   old one. Amounts are plain decimal strings; `decodeEntry` drops anything else.
8. **No simulated exchange or HTTP mocks in tests.** Unit tests use published vectors and real captured responses
   (`test/fixtures`); anything needing the API goes in `test/live`, which must stay public-API only (never place
   orders). The only allowed double is an in-memory implementation of `TwapClient` for `runTwap` tests.
9. **Read keys lazily.** Module-level code must not parse keys; surface problems through `configError`.

## Conventions

- `useScaffoldReadContract` / `useScaffoldWriteContract` for the registry (contract name `StrategyRegistry`).
- DaisyUI components; loading, empty and error states for every data block; `"use client"` where hooks are used.
- `type` over `interface`; comments explain *why* (Lambdaplex/Hedera specifics), not *what*.
