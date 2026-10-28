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
| Hub | Durable Object (one per tenant, SQLite) | WebSocket fan-out (Hibernation API), confirmation timers (alarms), ordered ledger appends, idempotency cache, sweep of requests whose Worker died after the decision or mid-execution (ADR-020), one-time WebSocket tickets (ADR-021) | Halyn API, web apps, Aero Core and Bolna (sweep and timeouts only) |
| TiDB Starter | TiDB Cloud (MySQL) | System of record (`docs/DATA_MODEL.md`) | Halyn API via HTTP serverless driver |
| Aero Core | Separate Worker + D1 | Mock bank; every route (reads too) requires a valid single-use grant (`@halyn/sdk.verifyGrant`; jti recorded in the same D1 batch as the effect) | Called only by Halyn API |
| R2 / KV | Cloudflare | Clone clips, ledger exports, test reports / compiled policy packs, agent ids | Halyn API, scripts |
| Web | Vercel (Next.js) | `/stage`, `/console`, `/aero`, `/assistant` | Halyn API REST + Hub WebSocket |

## Main flow (`propose_action`) — Step 7, ADR-016
1. Bolna calls `POST /tools/propose_action` (IP allowlist + `x-halyn-secret`). Normalise Bolna's substituted strings,
   Zod-validate the envelope, hash the raw params (`params_hash`).
2. In the Worker: keyword coaching and distress signals (pure lexicons; the Sarvam LLM layer is Step 11), the compiled
   packs from KV (cached per isolate), whether the Confirm callback may ring now.
3. ONE Hub RPC, inside the tenant's serial lane: idempotency on `(run_id, params_hash)` (the same request for the whole call,
   whatever its age or state) → the call's state (identified by `lookup_customer`, or now by the calling number) → the Gate context from
   the Hub's own rows (proof, Pass uses, limits per local period, transfers in 10 min, calls in the last hour, unusual
   hour) → `gate.decide(...)` (pure) → the request record and ledger `proposed`, `decided` → for a step-up the
   confirmation timer, ledger `confirm_requested` and the `confirm_request` push to the Aero app → for a hold the handoff.
   TiDB is not touched: the Hub's mirror outbox writes request, decision, call and handoff rows to TiDB later.
4. Respond to Bolna: `{request_id, status: "pending"}` (measured median 10 ms in Miniflare; budget 300 ms).
5. `ctx.waitUntil`: the outcome event into the call (`POST /v1/call/{run_id}/events`), then:
   - allow → event `allow` → claim the request once → sign a grant (≤ 60 s, exact params) → the Hub keeps that grant
     (its own SQLite only) and appends `grant_issued` → Aero Core → ledger `executed` → event `done`
     `{reference, summary}` → `core_update` to the apps. A bank refusal → ledger `core_rejected`, event
     `deny E_CORE_REJECTED`; an unknown outcome after one retry with the same grant → `deny E_FAIL_CLOSED`, ledger marked
     `reconcile: needed` and a specialist handoff (ADR-017, ADR-020). If the Worker dies after the claim, the Hub's
     alarm finishes the request (see "Failure behaviour").
   - step_up → event `step_up` and, in parallel, the Confirm call to the registered number (passkey only when it cannot
     ring: outside 09:00–21:00 IST, not configured, or the number is not the customer's).
   - hold → event `hold` (the Hub opened the handoff); the agent explains and transfers.
   - deny → event `deny`.
6. Every state change is broadcast by the Hub to the Stage/Console/Aero app.

## Confirmation
- Passkey: Aero app receives `confirm_request` over WebSocket, shows the exact action, calls
  `POST /web/approvals/:id/options` and `/verify` (WebAuthn; challenge = SHA-256 of the canonical request id, action,
  params hash and a nonce; ADR-018), or `/decline` (no passkey needed).
- Callback: Bolna outbound from B to the registered number (only `CUSTOMER_PHONE`, and only when its hash is the
  customer's registered number) with `user_data` = `customer_name` (spoken form), `action_summary`, `request_id`,
  `language`; the Confirm agent reports via `confirm_result`. Its run id must be exactly the Confirm call Halyn placed
  for that request: until that call is attached (or if it was never placed) no call can answer on this leg — not the
  Aero call, not a call known only by `sid:<call_sid>` (404, nothing recorded). So the callback needs Bolna's run id
  (`%(execution_id)s`, or the webhook's call sid → run id map); without it only the passkey and the timeout remain.
- The Hub settles the first answer (invariant 10) into the final outcome with the Gate's post-approval rules and the
  pack the Gate decided with (approved → execute, or a handoff above the new-payee cap / without an Aero Core route /
  for a tier-4 hold; declined → `denied`). A passkey answer stops a Confirm call that is still queued. The Hub's alarm
  answers `timeout` after 60 s and sends the `timeout` event itself (nobody else is awake then). The deadline is the
  Hub's, checked in its lane on every answer: an answer at or after it while the alarm is late (queued, or the Hub busy)
  never counts — the Hub settles the timeout first exactly as the alarm would (deny `C_TIMEOUT`, ledger, apps,
  `timeout` event, the Confirm call stopped) and records the answer as ignored; the alarm then finds nothing to do.

## Failure behaviour (fail closed)
| Failure | Result |
|---|---|
| API slow/down | Agent graph has only event edges out of `propose`; after 8 s of no event it plays the "can't complete now" static line. No action |
| Event injection 404 (call ended) | Logged; decision stands; customer sees it in the app |
| Confirm unanswered 60 s | deny `C_TIMEOUT`, alert |
| Hub alarm late; an answer (passkey or callback, approve or decline) arrives at or after the 60 s deadline | Never counts: the Hub settles the timeout first (deny `C_TIMEOUT`, one `timeout` event, the Confirm call stopped), records the answer as ignored; nothing executes. Passkey: 400 "already answered"; `confirm_result`: `{ok:true}` |
| Grant invalid/expired/reused | Aero Core 401; ledger `core_rejected` with the `E_GRANT_*` code; no retry. REUSED with `details.outcome = executed` on Halyn's own retry = executed earlier (`done`) |
| Aero Core refuses (400/404) | Nothing executed; ledger `core_rejected`, event `deny E_CORE_REJECTED` |
| Aero Core answer lost / 5xx / `outcome: unknown` | One retry with the same grant; still unknown → `deny E_FAIL_CLOSED`, ledger `core_rejected` with `reconcile: needed` + the jti, and a specialist handoff (a human checks Aero Core by reference). An `E_GRANT_EXPIRED` answer to a grant that may have run already counts as unknown, never as "not executed" |
| Worker dies after the decision (allow, or a step-up approved) but before claiming the request | Every approval arms the Hub's alarm. A request still `approved` 30 s later with no execution started is swept (same ≤ 10 per alarm bound as below; ADR-020): nothing was signed or sent to Aero Core → `failed`, `deny E_FAIL_CLOSED`, ledger `core_rejected` (`by: sweep`, `detail: not_claimed`), one event. A late Worker's `beginExecution` then gets nothing: no grant, no Aero Core call, no second event |
| Worker dies between claiming a request (`executing`) and recording the outcome | The Hub's alarm sweeps requests `executing` for 30 s (≤ 10 per alarm; ADR-020). No grant noted → nothing reached Aero Core → `failed`, `deny E_FAIL_CLOSED`. Grant noted with ≥ 10 s to live → the SAME grant is presented again: executed (or REUSED with `details`) → `executed`, `done`, `core_update`; bank refusal → `deny E_CORE_REJECTED`; still unknown → as above. Grant expired → never presented; unknown as above. The call hears exactly one event; never a second grant. A late Worker finish is a no-op (first finish wins); an execution reported after a final `failed` still goes on the ledger (`reconcile: needed`) with a handoff |
| Hub cannot read its directory (TiDB down on a cold Hub) | Tools answer 500 `E_FAIL_CLOSED`; the graph's 8 s silence plays "can't complete now" |
| No policy pack in KV for the region | `deny E_FAIL_CLOSED` (recorded) |
| Run id did not substitute | Keyed by `sid:<call_sid>`; no events, the agent polls `check_decision` |
| Webhook missing | Calls backfilled by polling executions; decisions don't depend on webhooks |
| Sarvam LLM down | Keyword layer only |
| TiDB down | Tools keep answering from the Hub; the ledger and mirror outboxes keep the rows and retry with backoff (ADR-016) |

## Security
Ed25519 grants (WebCrypto), passkeys (WebAuthn), Bolna IP allowlist + shared secret, secrets in Cloudflare/Vercel only,
masked logs, tenant filter on every query, synthetic data only. Details: `docs/PASS.md`, `docs/COMPLIANCE.md`.
