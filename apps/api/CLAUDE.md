# apps/api — Halyn API (Cloudflare Worker, Hono) + Hub Durable Object

Read with: `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/GATE.md`, `docs/DATA_MODEL.md`.

## Layout
```
src/index.ts            createApp(deps): /health, /tools/* + /webhooks/* (guarded), /web/* (CORS + session), /ws (ticket)
src/env.ts              Zod env groups, validated lazily per route group (requireEnv → 500 E_FAIL_CLOSED)
src/http/               error envelope (reason codes → status), masked JSON request log, AppEnv typing
src/auth/               bolnaGuard (IP allowlist AND x-halyn-secret), HS256 session tokens, requireSession, ws-ticket
                        (one-time WebSocket tickets: seal/open, roles per session kind; ADR-021)
src/tools/              the six Bolna tools + POST /webhooks/bolna (common.ts: normalise + run-id fallback)
src/flow/               context (AppDeps: clock, rng, bolnaFetch, coreTransport), dispatch after propose, execute
                        (grant → Aero Core → done | deny | handoff, core_update)
src/web/                session, me, ws-ticket + ws, aero home, passkeys + approvals (options/verify/decline), ledger, stage
src/webauthn/           strict CBOR + WebAuthn registration/assertion verify on WebCrypto (ADR-018)
src/packs/              compiled packs from KV (pack:<tenant>:<region>)
src/hub/                HubDO (ADR-014, ADR-016): ordered ledger lane + outboxes → TiDB (ledger, mirror), idempotency,
                        confirmation alarms (+ the timeout event), WebSockets, and the call-time read model (store.ts)
                        with the proposal/confirmation logic (flows.ts, call-context.ts), the alarm's sweep of requests
                        whose Worker died — approved but never claimed, or mid-execution (reconcile.ts, ADR-020) — and
                        the WebSocket tickets (ADR-021). Use hub/client.ts hubFor()
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
src/test-runner/        runner.ts (one scenario through a Harness), spec.ts (scenarios.json twin), live.ts (Stage runs)
drizzle/                SQL migrations from drizzle-kit (committed; pnpm db:migrate applies them)
test/                   int (offline), db (gated TiDB suite, ADR-013), scenarios, contract, fixtures/ (api, app = the
                        whole API in Miniflare, aero-core in-process, webauthn soft passkey, db, gate, pass)
```

## Rules here
- Respond to Bolna tools within 300 ms; do slow work in `c.executionCtx.waitUntil`. No TiDB on any tool path: tools read
  and write the Hub; TiDB gets rows from the Hub's outboxes (ADR-016).
- 10 ms CPU budget: WebCrypto only; compiled packs from KV; no YAML at runtime; no big deps.
- All ledger appends go through the HubDO (never write `ledger_entries` directly elsewhere).
- Call the Hub through `hubFor(env, tenant_id)`: its RPC methods return values, never throw (ADR-014).
- Every DB helper takes `tenant_id` first; never write a query without it.
- `gate/`, `grants/`, `ledger/`, `pass/` never import from `db/`, `bolna/` or `hub/` (keep them pure; enforced by lint rule).
- Any thrown error on a write path becomes `deny` + `E_FAIL_CLOSED` and an event to the call.
