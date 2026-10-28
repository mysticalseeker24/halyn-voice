# Testing — the rulebook

**Goal:** prove the invariants in `CLAUDE.md` §2 and the 12 scenarios in `docs/SCENARIOS.md`, continuously, without
spending call minutes. Real calls are the last layer, not the first.

## Pyramid
| Layer | Tooling | What it covers | Where |
|---|---|---|---|
| Unit | Vitest | Pure logic: Gate, policy compile, money, canonical JSON, reason codes, coaching lexicon, Pass codes, grant sign/verify, ledger hashing | `**/*.test.ts` next to code |
| Property | fast-check | Invariants: monotonic signals, coaching never step-up, critical never via Pass, readback false never allow, determinism, ledger tamper detection, grant params binding | `*.prop.test.ts` |
| Worker integration | `@cloudflare/vitest-plugin` (formerly `vitest-pool-workers`; Miniflare: Worker, Durable Object, D1, KV, R2) + the gated TiDB suite on `halyn_test` (ADR-013) | Routes, auth (IP + secret), Hub ordering, alarms/timeouts, idempotency, Aero Core grant enforcement; the six tools, Confirm (both legs, first answer wins, timeout), passkeys, execution failures — through `test/fixtures/app.ts` (real app, Hub, Aero Core in-process; Bolna recorder) | `apps/*/test/int`, `apps/api/src/**/*.test.ts` |
| Contract | Recorded Bolna payloads (`tests/fixtures/bolna/*.json`) + Zod | Tool requests, webhook payloads, event bodies we send; a schema change in Bolna fails here first. Table-driven by file-name prefix (README there): a new file is a new case; the real API must answer every tool and webhook fixture | `apps/api/test/contract` (int) |
| Scenario acceptance | Halyn Test runner, text mode (`apps/api/src/test-runner`, ADR-019) | All 12 scenarios end to end through real Halyn code; Bolna and customer answers simulated from `scenarios.yaml` (its JSON twin, kept equal by a test); plus every rule in SCENARIOS.md "Rules every scenario also checks" (chain verifies with the head anchor, causal order, no ungranted Aero Core request, `propose_action` < 300 ms, no unmasked number in any log line). Scenarios a later step completes are listed as `pending (Step N)`, never silently skipped | `pnpm test:scenarios` |
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
  and Aero Core's grant check (`apps/aero-core/src/grant`, `src/core/commit.ts`); ≥ 60% elsewhere (speed mode) (`vitest --coverage`,
  thresholds enforced in config).
- Aero Core tests sign grants with a throwaway Ed25519 key generated per run (`apps/aero-core/vitest.config.ts`) and
  seed a fresh customer per test from the demo template; the integration suite covers every 401 code (REUSED with its
  outcome details), a concurrent double-spend of one grant (exactly one succeeds) and different grants racing one
  balance (never below zero; losers leave no jti). Unit tests change D1 between a handler's read and its batch for
  every write (`src/core/preconditions.test.ts`: nothing written) and stream oversized, multibyte and invalid-UTF-8
  bodies at the byte cap (`src/grant/params.test.ts`, with a fast-check property).
- `pnpm verify` = lint + typecheck + unit + int + scenarios + build. CI runs the same.
- API tests run the real Aero Core app in-process (`apps/api/test/fixtures/aero-core.ts`) on a Miniflare D1 with this
  run's throwaway Ed25519 keys (`apps/api/vitest.config.ts`), each harness on its own tenant. Bolna is a recorder; the
  test bindings point Bolna and Aero Core URLs at dead hosts and blank `TIDB_DATABASE_URL`, so a test can never reach a
  real service even though `apps/api/.dev.vars` is loaded.
- The `propose_action` hot path is asserted to make no TiDB call (no directory load, no ledger or mirror flush while it
  answers). Passkey verification CPU is measured in `src/webauthn/verify.test.ts` (0.23 ms per ES256 check).
- Record a real Bolna payload into `tests/fixtures/bolna/` the first time you see one (mask numbers to last 4).
- Voice smoke results go to `docs/STATE.md` scenario table and `docs/COMPLIANCE.md` session log.

## Invariant map (CLAUDE.md §2 → the tests that prove it)
| # | Invariant | Proof |
|---|---|---|
| 1 | No action without a grant | `apps/aero-core/test/int` (every 401 code, double-spend), `src/grant/*.test.ts` + `require-grant.prop`, `packages/sdk` verify-grant (+ adversarial), API `src/flow/execute.test.ts`, scenario 11 |
| 2 | Fail closed | `apps/api/src/flow/fail-closed.test.ts` (grant sign failure, Aero Core 500/lost answer/503, Bolna 5xx/timeout, Confirm call down), `execute.test.ts`, bad-params cases in `tools.test.ts`, `hub/reconcile.test.ts` (a Worker dying after the claim / after the grant / after Aero Core committed; the sweep's every path: no grant, same grant executed or REUSED, refused, still unknown, expired, no Aero Core; one event per call; the grant only in Hub SQLite; never two grants; a late Worker finish is a no-op; Worker and sweep presenting one grant at once → one write; bounded per alarm; a request approved — outright or after a step-up — that no Worker claims within 30 s → arms the alarm, `failed` `deny E_FAIL_CLOSED`, one event, and a late Worker then signs and sends nothing; a claim inside the 30 s is left to the Worker; approvals share the per-alarm bound), `core-client/client.test.ts` (EXPIRED on a possibly-used grant is unknown) |
| 3 | Voice is never proof | `gate/decide.prop.test.ts` (signals never lower the tier), scenarios 3, 3b, 4, `webauthn/fuzz.test.ts` (no tampered assertion verifies) |
| 4 | Coaching → hold | `decide.prop.test.ts` (coaching ≥ threshold is never allow/step_up), scenario 4 |
| 5 | Critical never in a Pass | `decide.prop.test.ts` (non-pass-eligible actions gain no proof), `pass/*.test.ts`, scenario 6 |
| 6 | Append-only hash-chained ledger | `packages/shared` `ledger.prop.test.ts`, `ledger/next-entry.test.ts`, `test/int/hub.test.ts` (50 concurrent appends), every scenario verifies the chain |
| 7 | Idempotent proposals (strict) | `tools.test.ts` (same `(run_id, params_hash)` = same request at any age/state, one Aero Core write), `test/int/hub.test.ts`, `db/schema.test.ts` (unique index), scenario 12 (each transfer is its own call) |
| 8 | Tenant isolation | `hub/tenant-isolation.test.ts` (every Hub RPC refuses another tenant — a `satisfies Record<keyof HubRpc,…>` table, so a new RPC cannot ship unproven; two tenants side by side on one D1/KV), `hub-do.test.ts`, `pass.adversarial.test.ts` |
| 9 | Money is integers | `packages/shared` `money.prop.test.ts`, `fail-closed.test.ts` (fractions, exponents, hex, huge, negative, null never execute), `decide.prop.test.ts` |
| 10 | First answer wins; 60 s → deny | `confirm/race.test.ts` (passkey approve/decline, keypad/speech approve/decline and the alarm raced in 12 shuffled orders, half 1 s before the deadline, half on it — where the timeout wins in every order), `confirm/late-answer.test.ts` (alarm late, clock past the deadline: a callback approval, a passkey approval signed in time but sent late, a decline on the deadline → each refused, deny `C_TIMEOUT` once, one event, nothing executed), `hub-do.test.ts` (deadline − 1 ms counts, deadline does not), `tools.test.ts` (only the Confirm call Halyn placed may answer on the callback leg: not before it is attached, not when it was never placed, not the Aero call, not a `sid:` call), `test/int/hub.test.ts`, `web.test.ts` |
Also enumerated from the router (`src/http/surface.test.ts`): every `/tools/*` and `/webhooks/*` route needs the Bolna IP
AND the secret; CORS is an allow-list (no `*`, no prefix/suffix/null origins). WebSocket tickets (`test/int/ws.test.ts`,
`web/ws-route.test.ts`, ADR-021): one socket per ticket; expired, forged, re-labelled, other-tenant and wrong-role tickets
and any `?token=` are refused; neither the session nor the ticket reaches a log line. Logs never carry a full phone number
(`fail-closed.test.ts` afterEach, scenario runner rules).

## Test data
Seed is deterministic (`scripts/seed.ts`, fixed ULIDs and clock). The real customer number comes from
`CUSTOMER_PHONE` and never appears in fixtures or snapshots.
