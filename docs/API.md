# API contract

Base: Halyn API Worker. All bodies JSON, validated with Zod schemas from `packages/shared`. Errors:
`{ "error": { "code": "<REASON_CODE>", "message": "..." } }`.

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
`POST /core/cards/freeze` · `POST /core/fees/waive` · `POST /core/loans/emi-date` · `POST /core/transfers` ·
`GET /core/statement` · `GET /core/balance` — every write needs `x-halyn-grant`; reads need a read grant too.

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
`kid`, valid signature → claims schema (`iss`, `aud`, version, lifetime) → action equals the route's → `sub` / `tenant`
equal `expectedSub` / `expectedTenant` when given → `iat` at most 5 s in the future (all `E_GRANT_INVALID`) → not
expired, no leeway (`E_GRANT_EXPIRED`) → params hash (`E_PARAMS_MISMATCH`). `E_GRANT_REUSED` is Aero Core's own
check: insert the `jti` into `used_grants` atomically with the write. Params name a resource only within one customer
(a card's last 4 digits are not unique), so Aero Core acts on `claims.sub`'s accounts or passes `expectedSub`.

**Canonical JSON** (`packages/shared/src/canonical-json.ts`) is what every hash and signature covers: keys sorted by
UTF-16 code units at every depth, no whitespace, numbers and strings exactly as `JSON.stringify` writes them;
anything that is not plain JSON data (NaN, Infinity, BigInt, Dates, class instances, cycles) fails closed.

## WebSocket messages (Hub → apps)
`decision`, `confirm_request`, `confirm_resolved`, `core_update` (balance/activity), `handoff`, `ledger_append`,
`call_update` (transcript lines), `test_progress`. All typed in `packages/shared/src/ws.ts`.
