# apps/api — Halyn API (Cloudflare Worker, Hono) + Hub Durable Object

Read with: `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/GATE.md`, `docs/DATA_MODEL.md`.

## Layout
```
src/index.ts            Hono app, route mounting, error handler (reason codes), env validation (Zod)
src/auth/               bolnaGuard (IP allowlist + x-halyn-secret), session auth for /web
src/tools/              lookup_customer, verify_pass, propose_action, get_pass_code, confirm_result, check_decision
src/web/                routes for the four apps
src/hub/                HubDO: WebSockets (Hibernation API), alarms (confirm timeout), ledger append ordering, idempotency
src/gate/               PURE: decide(), resolveStepUp(), toDecision(), input schemas  (≥95% coverage, property tests)
src/signals/            coaching-lexicon.ts + distress-lexicon.ts (PURE keyword layers, ≥95%); later: unregistered
                        number, bursts, unusual hour, velocity, Sarvam coaching LLM (1.5 s budget, I/O)
src/pass/               issue, sign, code mint/verify, revoke  (≥95%)
src/grants/             sign grant (Ed25519 via WebCrypto), params hash  (≥95%)
src/ledger/             canonical entry, hash, verify  (≥95%)
src/confirm/            orchestration: passkey prompt + Bolna callback, first answer wins
src/bolna/              REST client: events, outbound calls, executions (typed, mocked in tests)
src/core-client/        calls Aero Core with x-halyn-grant
src/db/                 Drizzle schema (mysql-core) + queries (always filter tenant_id)
src/test-runner/        scenarios.yaml runner (text mode), voice mode orchestration
test/                   int (Workers pool), scenarios, contract (fixtures), security, fixtures/ (gate.ts: packs + builders)
```

## Rules here
- Respond to Bolna tools within 300 ms; do slow work in `c.executionCtx.waitUntil`.
- 10 ms CPU budget: WebCrypto only; compiled packs from KV; no YAML at runtime; no big deps.
- All ledger appends go through the HubDO (never write `ledger_entries` directly elsewhere).
- `gate/`, `grants/`, `ledger/`, `pass/` never import from `db/`, `bolna/` or `hub/` (keep them pure; enforced by lint rule).
- Any thrown error on a write path becomes `deny` + `E_FAIL_CLOSED` and an event to the call.
