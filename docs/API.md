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

## WebSocket messages (Hub → apps)
`decision`, `confirm_request`, `confirm_resolved`, `core_update` (balance/activity), `handoff`, `ledger_append`,
`call_update` (transcript lines), `test_progress`. All typed in `packages/shared/src/ws.ts`.
