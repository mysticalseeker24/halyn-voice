# API contract

Base: Halyn API Worker. All bodies JSON, validated with Zod schemas from `packages/shared`. Errors:
`{ "error": { "code": "<REASON_CODE>", "message": "...", "details"?: {…} } }` (`ErrorEnvelopeSchema`; `details` is
optional, flat — at most 16 string/number/boolean/null values — and so far only Aero Core sends it, see below).

## Auth
| Surface | Auth |
|---|---|
| `/tools/*`, `/webhooks/*` (Bolna) | Source IP ∈ Bolna list (`CF-Connecting-IP`) **and** `x-halyn-secret` header. Both or 401 |
| `/web/*` (apps) | Bearer session token (demo login), tenant from token |
| `/core/*` (Aero Core Worker) | Valid Halyn grant in `x-halyn-grant`; else 401 `E_GRANT_MISSING` / `E_GRANT_INVALID` / `E_GRANT_EXPIRED` / `E_GRANT_REUSED` / `E_PARAMS_MISMATCH` |
| `/ws` (Hub) | Session token as query param, role tag |

Details (Step 5, `apps/api/src/auth`):
- **Bolna guard:** both checks always run; a wrong IP, a missing or wrong secret, or no credentials all get the same
  401 `{"error":{"code":"E_UNAUTHORIZED","message":"Unauthorized"}}`. Unconfigured → 500 `E_FAIL_CLOSED`.
- **Sessions:** `POST /web/session` (`{kind:"customer", customer_id}` or `{kind:"console"}`; when `DEMO_ACCESS_CODE` is set,
  header `x-demo-code` too) returns `{token, tenant_id, kind, customer_id, expires_at}`. The token is a compact JWS
  (HS256 with `SESSION_SECRET`, `typ: halyn-session+jwt`, ≤ 12 h): a different key and algorithm from grants and Passes,
  so a session can never pass as either. The tenant always comes from the token. `GET /web/me` returns the session.
- **WebSocket:** `GET /ws?token=<session>&role=<role>` (browsers can't set headers on a WebSocket; the query string is
  never logged). Customers may listen as `aero` or `assistant`, console users as `stage` or `console`; anything else is 401.
- **Errors:** 400 `E_BAD_REQUEST` (validation, with the message), 401 `E_UNAUTHORIZED`, 404 `E_NOT_FOUND`, 500
  `E_FAIL_CLOSED` (never with internal detail). Every request writes one masked JSON log line (path only).
- **Health:** `GET /health` → `{ok:true, service:"halyn-api"}`, no secrets or database needed.

## Bolna-facing tools
| Endpoint | Request | Response (≤ 300 ms) |
|---|---|---|
| `POST /tools/lookup_customer` | `{run_id, from_number, claimed_name?}` | `{customer_found, customer_name?, region?, registered: boolean, language?}` |
| `POST /tools/verify_pass` | `{run_id, from_number, code}` | `{valid, assistant_name?, scopes_summary?}` (never echoes the code) |
| `POST /tools/propose_action` | `{run_id, from_number?, channel, action, params, readback_confirmed, caller_quotes[]}` | `{request_id, status: "pending"}`; outcome arrives as an event |
| `POST /tools/get_pass_code` | `{run_id, pass_token}` (assistant only) | `{code}` (6 digits, 5 min, single use, bound to calling number) |
| `POST /tools/confirm_result` | `{run_id, request_id, answer: "approve"\|"decline", method: "speech"\|"keypad"}` | `{ok}` |
| `POST /tools/check_decision` | `{run_id, request_id}` | fallback polling if event injection fails Day-0 |
| `POST /webhooks/bolna` | Bolna execution payload | `{ok}` |

Tool requests strip unknown keys (a new Bolna context field cannot break a live call); responses are strict.
`propose_action` validates only the envelope at the boundary: an unknown action or params that fail the action's
schema (`parseActionParams`) become a recorded `deny` with `E_FAIL_CLOSED`, never an HTTP 400. Caller quotes are
trimmed to the last 5, 300 chars each. `verify_pass` accepts spoken codes ("4 7 2 9 1 5").

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

## Web (apps)
| Endpoint | Purpose |
|---|---|
| `POST /web/session` | Demo login (customer or console user) |
| `GET /web/aero/home` | Balance, activity, alerts for the customer |
| `POST /web/approvals/:id/options` · `POST /web/approvals/:id/verify` | Passkey challenge / verify |
| `POST /web/passkeys/register/options` · `/verify` | One-time passkey registration |
| `POST /web/passes` · `DELETE /web/passes/:id` · `GET /web/passes` | Issue / revoke / list Passes |
| `POST /web/assistant/tasks` | Start the Assistant's outbound call to Aero |
| `POST /web/stage/run/:scenario` · `POST /web/stage/region` | Stage controls |
| `GET /web/calls` · `/web/calls/:id` · `/web/policies` · `/web/handoffs` · `POST /web/handoffs/:id/resolve` | Console |
| `GET /web/ledger` · `GET /web/ledger/verify` · `GET /web/ledger/export` | Ledger |
| `POST /web/tests/runs` · `GET /web/tests/runs/:id` · `GET /web/tests/permission-map` | Halyn Test |
| `GET /ws` | WebSocket to the tenant Hub |

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
