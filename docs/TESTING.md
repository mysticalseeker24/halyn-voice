# Testing — the rulebook

**Goal:** prove the invariants in `CLAUDE.md` §2 and the 12 scenarios in `docs/SCENARIOS.md`, continuously, without
spending call minutes. Real calls are the last layer, not the first.

## Pyramid
| Layer | Tooling | What it covers | Where |
|---|---|---|---|
| Unit | Vitest | Pure logic: Gate, policy compile, money, canonical JSON, reason codes, coaching lexicon, Pass codes, grant sign/verify, ledger hashing | `**/*.test.ts` next to code |
| Property | fast-check | Invariants: monotonic signals, coaching never step-up, critical never via Pass, readback false never allow, determinism, ledger tamper detection, grant params binding | `*.prop.test.ts` |
| Worker integration | `@cloudflare/vitest-pool-workers` (Miniflare: Worker, Durable Object, D1, KV, R2) + TiDB dev branch (or a local MySQL container) | Routes, auth (IP + secret), Hub ordering, alarms/timeouts, idempotency, Aero Core grant enforcement | `apps/*/test/int` |
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
- Coverage: ≥ 95% lines and branches for `packages/shared`, `apps/api/src/{gate,pass,ledger,grants}`; ≥ 80% elsewhere
  (`vitest --coverage`, thresholds enforced in config).
- `pnpm verify` = lint + typecheck + unit + int + scenarios + build. CI runs the same.
- Record a real Bolna payload into `tests/fixtures/bolna/` the first time you see one (mask numbers to last 4).
- Voice smoke results go to `docs/STATE.md` scenario table and `docs/COMPLIANCE.md` session log.

## Test data
Seed is deterministic (`scripts/seed.ts`, fixed ULIDs and clock). The real customer number comes from
`CUSTOMER_PHONE` and never appears in fixtures or snapshots.
