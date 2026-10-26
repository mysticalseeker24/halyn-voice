# apps/api — Halyn API (Cloudflare Worker, Hono) + Hub Durable Object

Read with: `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/GATE.md`, `docs/DATA_MODEL.md`.

## Layout
```
src/index.ts            Hono app: /health, /tools/* + /webhooks/* (guarded), /web/* (session), /ws
src/env.ts              Zod env groups, validated lazily per route group (requireEnv → 500 E_FAIL_CLOSED)
src/http/               error envelope (reason codes → status), masked JSON request log, AppEnv typing
src/auth/               bolnaGuard (IP allowlist AND x-halyn-secret), HS256 session tokens, requireSession
src/tools/              lookup_customer, verify_pass, propose_action, get_pass_code, confirm_result, check_decision
src/web/                routes for the four apps (POST /web/session, GET /web/me, GET /ws so far)
src/hub/                HubDO (ADR-014): ordered ledger lane + SQLite outbox → TiDB, idempotency, confirmation alarms,
                        WebSockets (Hibernation, role tags). RPC returns HubResult; use hub/client.ts hubFor(env, tenant)
src/gate/               PURE: decide(), resolveStepUp(), toDecision(), input schemas  (≥95% coverage, property tests)
src/signals/            coaching-lexicon.ts + distress-lexicon.ts (PURE keyword layers, ≥95%); later: unregistered
                        number, bursts, unusual hour, velocity, Sarvam coaching LLM (1.5 s budget, I/O)
src/pass/               PURE: issue, sign/verify token, code mint/verify (rows in, updates out), revoke  (≥95%)
src/grants/             PURE: signGrant (Ed25519 via @halyn/shared crypto, params hash, jti)  (≥95%)
src/ledger/             PURE: nextLedgerEntry (masked payload, chain hash), verifyLedger  (≥95%)
src/platform/           runtime adapters for pure modules: cryptoRng (the only getRandomValues call)
src/confirm/            orchestration: passkey prompt + Bolna callback, first answer wins
src/bolna/              REST client: events, outbound calls, executions (typed, mocked in tests)
src/core-client/        calls Aero Core with x-halyn-grant
src/db/                 Drizzle schema (mysql-core), TiDB HTTP client, tenant-first query helpers, seed builder (ADR-013)
src/test-runner/        scenarios.yaml runner (text mode), voice mode orchestration
drizzle/                SQL migrations from drizzle-kit (committed; pnpm db:migrate applies them)
test/                   int (offline), db (gated TiDB suite, ADR-013), scenarios, contract, fixtures/ (api, db, gate, pass)
```

## Rules here
- Respond to Bolna tools within 300 ms; do slow work in `c.executionCtx.waitUntil`.
- 10 ms CPU budget: WebCrypto only; compiled packs from KV; no YAML at runtime; no big deps.
- All ledger appends go through the HubDO (never write `ledger_entries` directly elsewhere).
- Call the Hub through `hubFor(env, tenant_id)`: its RPC methods return values, never throw (ADR-014).
- Every DB helper takes `tenant_id` first; never write a query without it.
- `gate/`, `grants/`, `ledger/`, `pass/` never import from `db/`, `bolna/` or `hub/` (keep them pure; enforced by lint rule).
- Any thrown error on a write path becomes `deny` + `E_FAIL_CLOSED` and an event to the call.
