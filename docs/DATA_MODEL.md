# Data model

IDs are `<prefix>_<ULID>` (e.g. `req_01J…`, `pass_01J…`; max 64 chars); seed rows use readable bodies
(`ten_aero`, `cus_saksham`, `pass_demo`). A grant's `jti` is a bare ULID. Times are UTC `DATETIME(3)`. Money is
`BIGINT amount_minor` + `CHAR(3) currency`.
Every Halyn table has `tenant_id` and every query filters on it.

## TiDB (Halyn system of record, MySQL dialect, Drizzle `mysql-core`)
| Table | Columns (key ones) | Notes |
|---|---|---|
| `tenants` | id, name, default_region, signing_key_id, created_at | `ten_aero` |
| `customers` | id, tenant_id, name, region, registered_number_e164, registered_number_hash, passkey_credential (JSON), created_at | number stored hashed + last4 for lookup; full number only in env for the demo |
| `policy_packs` | id, tenant_id, region, version, compiled_json (JSON), source_sha | compiled from YAML |
| `passes` | id, tenant_id, customer_id, assistant_name, assistant_numbers (JSON), scopes (JSON), issued_at, expires_at, status, customer_sig, issuer_sig, failures | status: active / revoked / locked / expired |
| `pass_codes` | id, pass_id, code_hash, bound_number, expires_at, used_at | single use, 5 min |
| `calls` | id, tenant_id, bolna_execution_id, run_id, agent, channel, from_number_last4, started_at, ended_at, transcript_ref, recording_url, purpose | `purpose` = `security_demo` for scenarios 3/4 |
| `action_requests` | id, tenant_id, call_id, run_id, customer_id, action, params (JSON), params_hash, readback_confirmed, caller_quotes (JSON), created_at | unique (run_id, params_hash) |
| `decisions` | id, request_id, outcome, final_outcome, tier, base_tier, reasons (JSON), signals (JSON), coaching (JSON), decided_at | |
| `grants` | jti, request_id, params_hash, issued_at, expires_at, used_at | |
| `confirmations` | id, request_id, channel, status, answer, bolna_execution_id, answered_at | first answer wins |
| `handoffs` | id, tenant_id, request_id, call_id, reason, status, note, created_at, resolved_at | |
| `ledger_entries` | seq, tenant_id, type, ref_id, payload (JSON, masked), prev_hash, hash, created_at | append via Hub only |
| `test_runs` | id, tenant_id, suite, mode (text/voice), agent_version, started_at, finished_at, summary (JSON) | |
| `test_results` | id, run_id, scenario_id, outcome, expected, passed, metrics (JSON), evidence_ref | |

## D1 (Aero Core, SQLite) — the mock bank, physically separate
| Table | Columns |
|---|---|
| `accounts` | id, customer_ref, region, type, balance_minor, currency, status |
| `payees` | id, customer_ref, name, account_last4, ifsc_or_routing_last4, added_at, saved |
| `transactions` | id, account_id, kind, amount_minor, currency, payee_id, reference, grant_jti, created_at |
| `used_grants` | jti (PK), used_at |
| `loans`, `cards`, `fees` | minimal columns for scenarios 1, 2, 5 |

## Durable Object storage (Hub, SQLite)
`idempotency(key, response, expires_at)`, `pending_confirmations(request_id, channels, deadline)`,
`ledger_head(seq, hash)`, `sockets` (via Hibernation API tags: role=stage|console|aero|assistant).

## Seed (`scripts/seed.ts`)
Tenant `ten_aero`; customers `cus_saksham` (IN) and `cus_saksham_us` (US); accounts, card ending 8812, fee ₹600,
payees Mom/Landlord, loan with EMI on the 5th; Pass `pass_demo` for the assistant (number B) with scopes
`statement.view`, `card.freeze`, `emi.move_date` (max 1). Registered number from `CUSTOMER_PHONE`.
