# API contract

Base: Halyn API Worker. All bodies JSON, validated with Zod schemas from `packages/shared`. Errors:
`{ "error": { "code": "<REASON_CODE>", "message": "...", "details"?: {…} } }` (`ErrorEnvelopeSchema`; `details` is
optional, flat — at most 16 string/number/boolean/null values — and so far only Aero Core sends it, see below).

## Auth
| Surface | Auth |
|---|---|
| `/tools/*`, `/webhooks/*` (Bolna) | Source IP ∈ Bolna list (`CF-Connecting-IP`) **and** `x-halyn-secret` header (on `/webhooks/*` also `?key=`, ADR-022: Bolna webhooks send no headers). Both or 401 |
| `/web/*` (apps) | Bearer session token (demo login), tenant from token |
| `/core/*` (Aero Core Worker) | Valid Halyn grant in `x-halyn-grant`; else 401 `E_GRANT_MISSING` / `E_GRANT_INVALID` / `E_GRANT_EXPIRED` / `E_GRANT_REUSED` / `E_PARAMS_MISMATCH` |
| `/ws` (Hub) | One-time ticket from `POST /web/ws-ticket` (Bearer session) as query param, role tag; never the session token (ADR-021) |

Details (Step 5, `apps/api/src/auth`):
- **Bolna guard:** both checks always run; a wrong IP, a missing or wrong secret, or no credentials all get the same
  401 `{"error":{"code":"E_UNAUTHORIZED","message":"Unauthorized"}}`. Unconfigured → 500 `E_FAIL_CLOSED`.
- **Sessions:** `POST /web/session` (`{kind:"customer", customer_id}` or `{kind:"console"}`; when `DEMO_ACCESS_CODE` is set,
  header `x-demo-code` too) returns `{token, tenant_id, kind, customer_id, expires_at}`. The token is a compact JWS
  (HS256 with `SESSION_SECRET`, `typ: halyn-session+jwt`, ≤ 12 h): a different key and algorithm from grants and Passes,
  so a session can never pass as either. The tenant always comes from the token. `GET /web/me` returns the session.
- **WebSocket** (ADR-021): browsers can't set headers on a WebSocket, and a URL may be kept by edge logs, so the session
  token never goes in one. First `POST /web/ws-ticket` `{role}` with `Authorization: Bearer <session>` (CORS like every
  `/web/*` route) → `{ticket, expires_at}` (`WsTicketRequestSchema` / `WsTicketResponseSchema`, `cache-control:
  no-store`). Customers may ask for `aero` or `assistant`, console users for `stage` or `console`; another role is 401,
  an unknown role 400. The ticket is opaque and URL-safe: ≥ 256 random bits, kept in the tenant's Hub (its SHA-256 only)
  bound to the tenant, the session's kind and customer and the role, valid for 30 s, single use, sealed with an HMAC so
  only tickets this API issued reach a Hub. Then `GET /ws?ticket=<ticket>&role=<role>` (URL-encode the ticket) with the
  WebSocket upgrade → 101. A used, expired, forged, re-labelled or other-tenant ticket, or one presented for another role
  (which also burns it), is 401 `E_UNAUTHORIZED`; so is any `?token=` (never silently accepted). Ask for a fresh ticket
  for every (re)connect. Neither the session nor the ticket is logged (the request log writes the path only).
- **Errors:** 400 `E_BAD_REQUEST` (validation, with the message), 401 `E_UNAUTHORIZED`, 404 `E_NOT_FOUND`, 500
  `E_FAIL_CLOSED` (never with internal detail). Every request writes one masked JSON log line (path only).
- **Health:** `GET /health` → `{ok:true, service:"halyn-api"}`, no secrets or database needed.

## Bolna-facing tools
| Endpoint | Request | Response (≤ 300 ms) |
|---|---|---|
| `POST /tools/lookup_customer` | `{run_id, from_number, claimed_name?}` | `{customer_found, customer_name?, region?, registered: boolean, language?}` |
| `POST /tools/verify_pass` | `{run_id, from_number, code}` | `{valid, assistant_name?, scopes_summary?}` (never echoes the code) |
| `POST /tools/propose_action` | `{run_id, from_number?, channel, action, params, readback_confirmed, caller_quotes[]}` | `{request_id, status: "pending"}`; outcome arrives as an event |
| `POST /tools/get_pass_code` | `{run_id, pass_token?}` (assistant only; no token = the Pass bound to the Assistant call Halyn placed) | `{code}` (6 digits, 5 min, single use, bound to calling number) |
| `POST /tools/confirm_result` | `{run_id, request_id, answer: "approve"\|"decline", method: "speech"\|"keypad"}` | `{ok}` |
| `POST /tools/check_decision` | `{run_id, request_id}` | fallback polling if event injection fails Day-0 |
| `POST /webhooks/bolna` | Bolna execution payload | `{ok}` |

Tool requests strip unknown keys (a new Bolna context field cannot break a live call); responses are strict.
`propose_action` validates only the envelope at the boundary: an unknown action or params that fail the action's
schema (`parseActionParams`) become a recorded `deny` with `E_FAIL_CLOSED`, never an HTTP 400. Caller quotes are
trimmed to the last 5, 300 chars each. `verify_pass` accepts spoken codes ("4 7 2 9 1 5").

How the tools behave (Step 7, `apps/api/src/tools`; ADR-016):
- **Bodies as Bolna sends them.** Every param is a `%(name)s` substitution, so bodies are normalised first
  (`normalizeToolBody`, `packages/shared/src/bolna-payloads.ts`): an empty value, `None`/`null` or an unsubstituted
  `%(…)s` is dropped; `"true"`/`"yes"` become booleans; phone numbers without `+` become E.164 (10 digits starting 6–9
  or `0`+10 digits are Indian); `caller_quotes` may be a list, a JSON list in a string or plain text; `params` may be an
  object, a JSON string, or — as the Day-0 agent sends it — the action's param names as top-level keys; integer params
  written as digits become numbers. Every tool also takes Bolna's auto-injected `call_sid`. Then the strict schema
  decides (400 `E_BAD_REQUEST` for a malformed envelope).
- **Run id fallback.** When `run_id` did not substitute, the call is the run id an earlier webhook mapped to that
  `call_sid`, else `sid:<call_sid>`. Events need a real run id (a Bolna UUID), so a `sid:` call learns its outcome only
  through `check_decision`.
- **`lookup_customer`** hashes the calling number (`PHONE_HASH_PEPPER`) and looks it up in the tenant's Hub; failing
  that, a `claimed_name` (full name, spoken name, or a unique first name) identifies the customer with
  `registered: false` — never proof, but it tells the Gate whose devices a step-up goes to (scenario 3).
  `customer_name` is the **spoken form** (Devanagari for Saksham, CLAUDE.md §8); screens use the Roman name.
- **`get_pass_code`** verifies the Pass token (EdDSA, Halyn's JWKS, this tenant) and mints a code bound to the
  assistant's calling number (`from_number`, or the Pass's only number); a refused Pass is 400. **`verify_pass`** answers
  `{valid:false}` for every failure (the reason goes to the log); the 5th failure locks the Pass (ledger `pass_locked`).
- **`propose_action`** answers `{request_id, status:"pending"}` after ONE Hub call (measured median 10 ms in
  Miniflare): idempotency, the Gate on the Hub's rows, request + decision + ledger entries, and for a step-up the
  confirmation timer and the `confirm_request` push. No TiDB on this path. The same `(run_id, params_hash)` is the same
  request for the whole call, whatever its age or state (invariant 7): a retry returns the existing `request_id` and never a second decision, grant or write. Slow work
  runs in `waitUntil`: the outcome event, the Confirm call, grant → Aero Core → `done`.
- **`confirm_result`** answers `{ok:true}` whether or not the answer counted (first answer wins, invariant 10; an answer
  at or after the 60 s deadline never counts — the Hub settles the timeout first if its alarm has not run yet). 404
  `E_NOT_FOUND` "No such confirmation", with nothing recorded, unless the run id is exactly the Confirm call Halyn placed
  for that request: before that call is attached, when it was never placed, from the Aero call itself or from a call
  known only as `sid:<call_sid>`, no call can answer on the callback leg.
- **`check_decision`** answers the event the call is in now (`{status:"decided", event}`); 404 for another call's request.
- **`POST /webhooks/bolna`** takes Bolna's execution record (agent webhook or a tool's pre-call webhook), maps its call
  sid (`telephony_data.call_sid` or `provider_call_id`) to its run id and records the end of the call and its
  recording. Unreadable records get `{ok:false}` (no retry). For inbound calls it also records the hash of
  `telephony_data.from_number`: that number beats a tool body's `from_number` for the registered-number proof, and a
  record contradicting an earlier lookup withdraws it (Step 16; the LLM can see the tool's `from_number`).

## Events Halyn sends into calls (`POST https://api.bolna.ai/v1/call/{run_id}/events`)
| Event | Properties | Aero graph goes to |
|---|---|---|
| `allow` | `{request_id}` | `working` |
| `done` | `{reference, summary}` | `confirmed` |
| `step_up` | `{request_id, channels}` | `awaiting_confirmation` |
| `approved` | `{request_id}` | `working` |
| `denied` / `timeout` | `{request_id, reason}` | `refused` |
| `hold` | `{request_id, reason}` | `protect` → `transfer` |
| `deny` | `{request_id, reason}` | `refused` |
| `recorded` | `{request_id}` | (Confirm call) `bye`: sent after `confirm_result` stores the answer; the Confirm graph hangs up |

`reason` is the code that decided it (`C_DECLINED`, `C_TIMEOUT`, `S_COACHING`, `T_DISTRESS`, `I_NO_PROOF`, …). Two
outcomes arrive where the graph did not expect them before Step 7 (docs/BOLNA.md adds the edges): `deny` after `allow`
(from `working`) when Aero Core refused (`E_CORE_REJECTED`) or its answer was unknown (`E_FAIL_CLOSED`), and `hold` after
a step-up (from `awaiting_confirmation`) when an approved action must go to a specialist — above the new-payee cap
(`P_OVER_LIMIT`, `H_SPECIALIST`), no Aero Core route (`H_SPECIALIST`), or a tier-4 change waiting out its hold
(`P_TIER4_HOLD_24H`). A 404 from Bolna (the call ended) is logged and the decision stands. The `timeout` event is sent
by the Hub's own alarm.

## Web (apps)
| Endpoint | Purpose |
|---|---|
| `POST /web/session` | Demo login (customer or console user) |
| `GET /web/aero/home` | Balance, activity, card, loan, alerts, pending approvals for the customer (`AeroHomeSchema`) |
| `POST /web/approvals/:id/options` · `POST /web/approvals/:id/verify` · `POST /web/approvals/:id/decline` | Passkey challenge / verify `{response}` → `{ok, status:"approved"}` / decline `{}` → `{ok, status:"declined"}` |
| `POST /web/passkeys/register/options` · `/verify` | One-time passkey registration: `{options}` / `{response}` → `{ok:true}` |
| `POST /web/passes/options` · `POST /web/passes` · `DELETE /web/passes/:id` · `GET /web/passes` | Pass consent options (challenge binds the draft) / issue `{assistant, scopes, expires_in_days, response}` → `{pass, token}` / revoke → `{pass}` / list → `{passes}` (Step 10) |
| `POST /web/assistant/tasks` | `{task, pass_id}` → `{ok, execution_id}`: the Assistant agent calls A from B (09:00–21:00 IST), bound to that Pass, so its `get_pass_code` sends only `call_sid` |
| `POST /web/calls/session` | Customer: `{region?}` → Bolna's web-call session (single-use, ~120 s) for `@bolna/web-call`; region (default: the Stage's) picks the Aero agent; the run id is registered as this customer's browser call (channel `web`, proof `app_session`; in US the customer's US record) (Step 12) |
| `POST /web/stage/run/:scenario` · `POST /web/stage/region` | Stage controls |
| `GET /web/calls` · `GET /web/calls/:run_id` | Console: the newest 50 calls (`CallListResponseSchema`: channel, region, caller kind, registered, last 4, requests, last outcome) · one call: its requests (outcome, final, tier, reasons, signal codes, cue ids, status), handoffs, Bolna transcript (numbers masked; `transcript_status` ok / none / unavailable) and recording link (kept on the Hub call state from the webhook) (Step 13) |
| `GET /web/policies` | Console: the compiled packs from KV, read-only, and any `missing` region (calls there fail closed) |
| `GET /web/console/passes` · `DELETE /web/console/passes/:id` | Console: every Pass of the tenant with its customer · revoke one (`pass_revoked` in the ledger; 404 if unknown) |
| `GET /web/signals` | Console: counts per signal, reason code and coaching cue over the newest 500 requests, and the newest 20 flagged requests — ids and codes only, never the caller's words |
| `GET /web/integrations` | Console: each Bolna agent in env (Aero IN, aero-en, Confirm, Assistant) via `GET /v2/agent/{id}` — name, status, restricted, webhook **host** only; booleans for the IP allow-list, tool secret, Bolna and Sarvam keys; Aero Core `/health` (ok, ms); Hub mirror backlog and open sockets per role. Never a secret or `?key=` |
| `GET /web/handoffs` · `POST /web/handoffs/:id/resolve` | Console: `{handoffs}` newest first (Hub read model, check-in record) · `{action: release|block, note?}` → `{ok, status}`; first resolution wins (400 after); release of a held request approves it and the Worker executes it with a grant (Step 11) |
| `GET /web/ledger` · `GET /web/ledger/verify` · `GET /web/ledger/export` | Ledger · export = `LedgerExportSchema` (entries ≤ 5,000, head anchor, verify result) as an attachment |
| `POST /web/tests/runs` · `GET /web/tests/runs/:id` | Halyn Test (Step 15): `{region: IN|US|null}` → a suite run in the Hub (that pack's scenarios, or all) · the run (`:id` or `latest`), its `scorecard` (actions without a grant, attacks stopped, tasks completed, median propose_action ms, passed/failed/skipped/pending) and `previous` with the changed scenarios. Each scenario runs with `POST /web/stage/run/:scenario {mode:"text", suite_run_id}` (its own request); 3b is recorded as skipped in live mode |
| `GET /web/tests/permission-map` | Both bundled Aero graphs: every path to `propose_action`; GREEN when every edge into working / awaiting_confirmation / protect / confirmed / refused is an event edge, else RED with the path |
| `GET /web/tests/voice` · `POST /web/tests/voice/:persona` · `GET /web/tests/voice/:persona/:execution_id` | Voice personas (agents/test-*.json): which can call (`TEST_AGENT_*_ID` set, 09:00–21:00 IST) · place the B → A call (real money: Saksham's go-ahead) · read the execution back and score Aero's side of the call |
| `POST /web/ws-ticket` · `GET /ws` | One-time WebSocket ticket, then the WebSocket to the tenant Hub (Auth above) |

Built in Step 7 (`apps/api/src/web`; bodies in `packages/shared/src/api.ts` + `webauthn.ts`):
- **CORS** on `/web/*` for the origins in `WEB_ORIGIN` (comma-separated allow-list, never `*`): methods GET, POST,
  DELETE; headers `authorization`, `content-type`, `x-demo-code`. Preflight answers before the session check.
- **`GET /web/aero/home`** (customer): `accounts` (type, `last4: null` — Aero Core keeps no account number — and
  balance), `activity` (≤ 20, newest first), `card` and `loan` (`outstanding: null`) come from Aero Core's
  `statement.view` with a Halyn grant; `accounts` is empty when Aero Core is down. `alerts` (kind `blocked` / `approval`
  / `info`) and `pending_approvals` (the `confirm_request` fields) come from the customer's requests in the Hub.
- **Passkeys** (customer; ADR-018): registration options are WebAuthn creation options (`attestation: "none"`, user
  verification required, EdDSA/ES256/RS256), single-use challenge, 5 minutes. Approval options are request options for
  the customer's registered passkeys; the challenge binds the request id, action and params hash; 400 "Register a
  passkey first" without one. Verify checks origin, RP id, UP+UV, signature and sign count. Another customer's request
  is 404. An answer after another one counted, or at/after the 60 s deadline, is 400 `E_BAD_REQUEST` ("already
  answered"); the approval challenge lives 30 s past the deadline so a late assertion still reaches the Hub, which
  settles the timeout (if its alarm is late) and records the answer as ignored.
- **`GET /web/ledger?limit=N`** (console): the newest N entries (default 50, ≤ 500), oldest first, and `head_hash`.
  **`GET /web/ledger/verify`** (console): the whole chain against the Hub's head anchor (≤ 5,000 entries per request).
- **`POST /web/stage/run/:scenario`** `{mode:"text"}` (console) → `{test_run_id, scenario, mode}`: runs that scenario
  through the real tools against the live Hub (the Stage sees every message; progress as `test_progress`), with Bolna
  replaced by a recorder (no call is placed) and only declines simulated (ADR-019). `mode:"voice"` is refused (400).
  With `suite_run_id` the result is recorded into that Halyn Test run before `test_progress` (`test_run_id` = the suite,
  `completed`/`total` over its scenarios).
  **`POST /web/stage/region`** `{region}` → `{ok:true}` stores the Stage's region in the Hub (scenario 10 uses it, Step 12).
- `POST /web/session` also warms the tenant's Hub (its directory load from TiDB) in the background.

## Aero Core (`apps/aero-core`)
Every route needs `x-halyn-grant` — reads too. The request's params are exactly the action's params (docs/ACTIONS.md):
the **query string** for GET, the **JSON body** for POST. Routes and 200 bodies are `CORE_ROUTES` / `CORE_RESPONSES` in
`packages/shared/src/core.ts` (the API's core client uses the same schemas).

| Route | Actions (the grant's verified action picks one) | 200 body |
|---|---|---|
| `POST /core/cards/freeze` | `card.freeze` | `{action, reference, card: {last4, status: "frozen"}, already_frozen}` (idempotent) |
| `POST /core/fees/waive` | `fee.waive` (amount and currency must equal the fee's) | `{action, reference, fee: {id, status: "waived", amount}, balance}` |
| `POST /core/loans/emi-date` | `emi.move_date` | `{action, reference, loan: {id, emi_day, previous_emi_day}}` |
| `POST /core/transfers` | `transfer.saved`, `transfer.new_payee` (adds an unsaved payee), `wire.new` (adds a payee by routing last 4) | `{action, reference, transaction, balance}` |
| `GET /core/balance?account=…` | `balance.view` | `{action, account, balance, as_of}` |
| `GET /core/statement?account=…` | `statement.view` | `{action, account, balance, transactions (newest first, ≤ 20), as_of}` |

`reference` is `AERO-` + the last 6 characters of the grant's jti (speakable). Money is `{amount_minor, currency}`;
transfers debit the customer's primary account in the transfer's currency. A transaction is
`{id, kind, category, amount, description, payee_id, reference, created_at}` — payees by id, never a full number.

Errors (standard envelope). Configuration is checked first, so missing or invalid config is 500 `E_FAIL_CLOSED` even
for a request without a grant. Then: 401 for the grant codes below; 400 `E_BAD_REQUEST` when the bank refuses (fee
already waived or a different amount, balance too low, loan closed, account blocked, or granted params outside the
action's schema); 404 `E_NOT_FOUND` (no such card, fee, loan, saved payee or account **for the grant's customer**, or
no such route or method); 405 for `HEAD` on any core path (`Allow` names the route's method; Hono would otherwise run
the GET handler and spend a read grant); 500 `E_FAIL_CLOSED` (the database refused the batch, or a precondition
stopped holding between the handler's read and its batch). **Single use:** the jti is inserted into `used_grants` in
the same D1 batch as the effect, so of N concurrent requests with one grant exactly one executes and the rest get
`E_GRANT_REUSED`. A write the bank refuses (400/404/500) does not use the grant; a read uses its grant even when the
account is missing. **Atomic preconditions:** a D1 batch cannot branch, so each write's precondition is re-checked
inside its batch — the `used_grants` insert takes `customer_ref` from a subquery that yields a row only while it holds
(transfers: the same active primary account in the transfer's currency with enough balance, and for `transfer.saved`
the payee still saved; `fee.waive`: the fee still due with the same amount, currency and account, the account in the
fee's currency; `card.freeze`: the card still there; `emi.move_date`: the loan still active and on the day read). If it
no longer holds the whole batch aborts: no jti, no transaction, no payee.

**Outcome hint (`error.details`, `CoreOutcomeDetailsSchema` in `packages/shared/src/core.ts`).** An error without
`details` means nothing executed. Otherwise:

| Response | `details` | Meaning |
|---|---|---|
| 401 `E_GRANT_REUSED` | `{outcome: "executed", reference, request_id, used_at}` (the first use) | the grant executed earlier |
| 500 `E_FAIL_CLOSED` | `{outcome: "executed", reference, request_id, used_at}` | the batch committed but its result could not be read |
| 500 `E_FAIL_CLOSED` | `{outcome: "unknown"}` | the batch failed and Aero Core could not check whether it committed |

**The API's core client (Step 7) must:** treat 200 as executed; treat `E_GRANT_REUSED` on a retry of **its own**
grant as "already executed earlier — reconcile by `reference`", **never** as "not executed" (only Halyn holds the
grant, so nobody else can have used it); treat a 500 with `outcome: "executed"` the same way; on a timeout, a lost
response or `outcome: "unknown"`, retry once with the **same** grant while it is valid (it answers 200, REUSED +
executed, or a refusal) and fail closed if the outcome is still unknown; treat every other error as not executed.

**Grant** (`x-halyn-grant`, compact JWS, schema in `packages/shared/src/grant.ts`). Header
`{alg: "EdDSA", kid, typ: "halyn-grant+jwt"}`. Claims:

| Claim | Value |
|---|---|
| `v` | `halyn-grant/0.1` |
| `jti` | ULID; single use (inserted into `used_grants` in the same D1 batch as the write) |
| `iss` / `aud` | `halyn` / `aero-core` |
| `tenant` · `sub` | tenant id · customer id |
| `action` | the ActionId; must equal the route's action |
| `params_hash` | lower-case hex SHA-256 of `canonicalJson(params)` |
| `request_id` | the `action_requests` id (`req_…`) |
| `iat` · `exp` | Unix seconds, `0 < exp − iat ≤ 120` (invariant 1) |

Halyn signs with `signGrant` (`apps/api/src/grants`, default lifetime 60 s). Aero Core verifies with
`@halyn/sdk.verifyGrant`, in this order: present (`E_GRANT_MISSING`) → JWS is EdDSA, `typ: halyn-grant+jwt`, known
`kid`, valid signature → claims schema (`iss`, `aud`, version, lifetime) → action is the route's (or one of the route's,
`expectedAction` may be a list) → `sub` / `tenant` equal `expectedSub` / `expectedTenant` when given → `iat` at most
5 s in the future (all `E_GRANT_INVALID`) → not expired, no leeway (`E_GRANT_EXPIRED`) → params hash
(`E_PARAMS_MISMATCH`; a repeated query key, a body that is not JSON, not valid UTF-8, or over 4,096 **bytes** never
matches). `E_GRANT_REUSED` is Aero Core's own check: insert the `jti` into `used_grants` atomically with the write. A
request without the header is refused before its params are read. With a header, the body must be read before the
signature can be checked (the hash covers it), so it is capped as it streams in: once more than 4,096 bytes have
arrived (with or without a `content-length`) reading stops and the stream is cancelled. Aero Core passes `expectedTenant` = its `AERO_TENANT_ID` (`ten_aero`). Params
name a resource only within one customer (a card's last 4 digits are not unique), so Aero Core acts on `claims.sub`'s
rows only (it has no other way to know the customer).

**Canonical JSON** (`packages/shared/src/canonical-json.ts`) is what every hash and signature covers: keys sorted by
UTF-16 code units at every depth, no whitespace, numbers and strings exactly as `JSON.stringify` writes them;
anything that is not plain JSON data (NaN, Infinity, BigInt, Dates, class instances, cycles) fails closed.

## WebSocket messages (Hub → apps)
`decision`, `confirm_request`, `confirm_resolved`, `core_update` (balance/activity), `handoff`, `ledger_append`,
`call_update` (transcript lines), `test_progress`. All typed in `packages/shared/src/ws.ts`.

Who gets what (Step 7): `decision` (every proposal, and again with `final_outcome` after a step-up), `confirm_resolved`
and `handoff` go to every role; `confirm_request` to `aero` and `stage`; `ledger_append` and `test_progress` to `stage`
and `console`; `core_update` to every role after each Aero Core write (the Aero app refetches its home on it).
`decision` carries `cues` (coaching cue ids, never words) when layer 1 or 2 fired (Console Live). The Console (role
`console`) also gets end-of-call transcripts (`call_update`, numbers masked); assistant-call system lines go to `assistant` and `stage`.
