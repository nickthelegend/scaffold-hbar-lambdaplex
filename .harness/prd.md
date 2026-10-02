# Lambdaplex Terminal: product brief for agents

## What exists

- `@sh/lambdaplex`: typed Lambdaplex client with Signature V1/V2, exact decimal rules, a TWAP executor that waits for
  settlement-final fills, and an HCS track-record format.
- Next.js terminal: markets, live order book/trades/chart (REST + WebSocket), order form validated against live rules,
  balances and open orders via server routes, TWAP jobs, track-record viewer that verifies settlement transactions
  on the mainnet mirror node, and a StrategyRegistry UI.
- `StrategyRegistry.sol` on Hedera testnet linking strategies to operators, HCS topics and parameter hashes.

## Non-negotiables

See `AGENTS.md` → Rules. Keys never reach the browser; trading is gated by `TRADING_ENABLED`; amounts are decimal
strings; fills are published only once settlement-final.

## Acceptance

`acceptance-contract.json` is the gate; tests, lint and build must pass.
