# Architecture

## Components
| Component | Runs on | Responsibility | Talks to |
|---|---|---|---|
| Aero voice agent (Hindi/English) | Bolna graph agent, number A | Identify caller, understand request, read back, `propose_action`, speak outcomes | Halyn API (custom functions); receives events |
| Aero voice agent (English) | Bolna graph agent, web only | Same, for US browser calls | Same |
| Halyn Confirm | Bolna agent, outbound from B | Read back the action to the registered number; yes/no or keypad 1/2 → `confirm_result` | Halyn API |
| Saksham's Assistant | Bolna agent, outbound from B | Gets a Pass code (`get_pass_code`), calls Aero, completes the task | Halyn API, Aero agent |
| Test callers | Bolna agents, outbound from B | Normal-customer personas (attacker personas only if Bolna approves) | Aero agent |
| Halyn API | Cloudflare Worker (Hono) | Tools, web REST, Gate, Signals, Pass, Confirm orchestration, Test runner | Bolna REST, TiDB, Hub DO, Aero Core, R2, KV, Sarvam |
| Hub | Durable Object (one per tenant, SQLite) | WebSocket fan-out (Hibernation API), confirmation timers (alarms), ordered ledger appends, idempotency cache | Halyn API, web apps |
| TiDB Starter | TiDB Cloud (MySQL) | System of record (`docs/DATA_MODEL.md`) | Halyn API via HTTP serverless driver |
| Aero Core | Separate Worker + D1 | Mock bank; every write requires a valid grant (`@halyn/sdk.verifyGrant`) | Called only by Halyn API |
| R2 / KV | Cloudflare | Clone clips, ledger exports, test reports / compiled policy packs, agent ids | Halyn API, scripts |
| Web | Vercel (Next.js) | `/stage`, `/console`, `/aero`, `/assistant` | Halyn API REST + Hub WebSocket |

## Main flow (`propose_action`)
1. Bolna calls `POST /tools/propose_action` (IP allowlist + `x-halyn-secret`). Zod-validate.
2. Idempotency: key `(run_id, params_hash)` in the Hub; repeat → return the stored result.
3. Load customer, Pass state, counters (TiDB) and compiled pack (KV); compute signals and coaching score (keywords now, Sarvam LLM with 1.5 s budget).
4. `gate.decide(...)` (pure).
5. Persist request + decision (TiDB, one transaction); append ledger entries through the Hub (ordered hash chain).
6. Respond to Bolna within 300 ms: `{request_id, status: "pending"}`.
7. `ctx.waitUntil`: fire the outcome event into the call (`POST /v1/call/{run_id}/events`):
   - allow → sign grant → call Aero Core → event `done` with `{reference}`.
   - step_up → Hub starts Confirm (WebSocket prompt to Aero app + Bolna outbound call to the registered number) and a 60 s alarm.
   - hold → create handoff; event `hold`; agent explains and transfers.
   - deny → event `deny`.
8. Every state change is broadcast by the Hub to the Stage/Console/Aero app.

## Confirmation
- Passkey: Aero app receives `confirm_request` over WebSocket, shows the exact action, calls `POST /approvals/:id/options` and `/verify` (WebAuthn, challenge = SHA-256 of canonical action + request id).
- Callback: Bolna outbound from B to the registered number with `user_data` = action summary + request id; Confirm agent reports via `confirm_result`.
- Hub resolves first answer; cancels the other channel (stops the call if still ringing); alarm → timeout.

## Failure behaviour (fail closed)
| Failure | Result |
|---|---|
| API slow/down | Agent graph has only event edges out of `propose`; after 8 s of no event it plays the "can't complete now" static line. No action |
| Event injection 404 (call ended) | Logged; decision stands; customer sees it in the app |
| Confirm unanswered 60 s | deny `C_TIMEOUT`, alert |
| Grant invalid/expired/reused | Aero Core 401; ledger `E_GRANT_*`; no retry |
| Webhook missing | Calls backfilled by polling executions; decisions don't depend on webhooks |
| Sarvam LLM down | Keyword layer only |
| TiDB down | Writes deny `E_FAIL_CLOSED` |

## Security
Ed25519 grants (WebCrypto), passkeys (WebAuthn), Bolna IP allowlist + shared secret, secrets in Cloudflare/Vercel only,
masked logs, tenant filter on every query, synthetic data only. Details: `docs/PASS.md`, `docs/COMPLIANCE.md`.
