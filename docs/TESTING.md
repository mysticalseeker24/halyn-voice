# Testing — the rulebook

**Goal:** prove the invariants in `CLAUDE.md` §2 and the 12 scenarios in `docs/SCENARIOS.md`, continuously, without
spending call minutes. Real calls are the last layer, not the first.

## Pyramid
| Layer | Tooling | What it covers | Where |
|---|---|---|---|
| Unit | Vitest | Pure logic: Gate, policy compile, money, canonical JSON, reason codes, coaching lexicon, Pass codes, grant sign/verify, ledger hashing | `**/*.test.ts` next to code |
| Property | fast-check | Invariants: monotonic signals, coaching never step-up, critical never via Pass, readback false never allow, determinism, ledger tamper detection, grant params binding | `*.prop.test.ts` |
| Worker integration | `@cloudflare/vitest-plugin` (formerly `vitest-pool-workers`; Miniflare: Worker, Durable Object, D1, KV, R2) + the gated TiDB suite on `halyn_test` (ADR-013) | Routes, auth (IP + secret), Hub ordering, alarms/timeouts, idempotency, Aero Core grant enforcement | `apps/*/test/int` |
| Contract | Recorded Bolna payloads (`tests/fixtures/bolna/*.json`) + Zod | Tool requests, webhook payloads, event bodies we send; a schema change in Bolna fails here first | `apps/api/test/contract` |
| Scenario acceptance | Halyn Test runner, text mode | All 12 scenarios end to end through real Halyn code; Bolna and customer answers simulated from `scenarios.yaml` | `pnpm test:scenarios` |
| UI component | Vitest + Testing Library | Approval sheet, Pass card, decision badges (colour + word) | `apps/web` |
| E2E | Playwright (Chromium; WebAuthn virtual authenticator) | Stage runs a scenario; Aero app approves with a passkey; Pass issue/revoke; Console ledger verify | `apps/web/e2e` |
| Voice smoke | Real Bolna calls (`/run-scenario`) | Scenarios 1–6, 10 on the demo environment | Only with Saksham's go-ahead |
| Security | Unit + integration | Tampered grant, wrong params hash, replayed jti, expired grant, wrong IP, missing secret, replayed Pass code, code from wrong number, cross-tenant read | `*.security.test.ts` |
| Performance | Integration timers | `propose_action` p95 < 300 ms; Worker CPU < 10 ms (check `wrangler dev --test-scheduled` logs / analytics) | int |

## Rules
- **Never mock the Gate, Pass, Ledger or grant code** in scenario or integration tests. Mock only Bolna HTTP, Sarvam
  HTTP and the clock.
- Inject `clock` and `rng` everywhere; tests use fixed time.
- Every bug fix starts with a failing test.
- Coverage: ≥ 95% lines and branches for `packages/shared`, `packages/sdk`, `apps/api/src/{gate,pass,ledger,grants}`
  and Aero Core's grant check (`apps/aero-core/src/grant`, `src/core/commit.ts`); ≥ 80% elsewhere (`vitest --coverage`,
  thresholds enforced in config).
- Aero Core tests sign grants with a throwaway Ed25519 key generated per run (`apps/aero-core/vitest.config.ts`) and
  seed a fresh customer per test from the demo template; the integration suite covers every 401 code (REUSED with its
  outcome details), a concurrent double-spend of one grant (exactly one succeeds) and different grants racing one
  balance (never below zero; losers leave no jti). Unit tests change D1 between a handler's read and its batch for
  every write (`src/core/preconditions.test.ts`: nothing written) and stream oversized, multibyte and invalid-UTF-8
  bodies at the byte cap (`src/grant/params.test.ts`, with a fast-check property).
- `pnpm verify` = lint + typecheck + unit + int + scenarios + build. CI runs the same.
- Record a real Bolna payload into `tests/fixtures/bolna/` the first time you see one (mask numbers to last 4).
- Voice smoke results go to `docs/STATE.md` scenario table and `docs/COMPLIANCE.md` session log.

## Test data
Seed is deterministic (`scripts/seed.ts`, fixed ULIDs and clock). The real customer number comes from
`CUSTOMER_PHONE` and never appears in fixtures or snapshots.
