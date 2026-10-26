# Data model

IDs are `<prefix>_<ULID>` (e.g. `req_01J…`, `pass_01J…`; max 64 chars); seed rows use readable bodies
(`ten_aero`, `cus_saksham`, `pass_demo`). A grant's `jti` is a bare ULID. Times are UTC `DATETIME(3)`. Money is
`BIGINT amount_minor` + `CHAR(3) currency`.
Every Halyn table has `tenant_id`, leads its primary key with it, and every query filters on it (invariant 8;
`apps/api/src/db/queries.ts` takes the tenant first). Schema: `apps/api/src/db/schema.ts`; migrations: `apps/api/drizzle/`.

## TiDB (Halyn system of record, MySQL dialect, Drizzle `mysql-core` over the HTTP driver — ADR-013)
Databases: `halyn_dev` (wrangler dev), `halyn_test` (DB test suite), `halyn` (demo).
| Table | Columns (key ones) | Notes |
|---|---|---|
| `tenants` | id, name, default_region, signing_key_id, created_at | `ten_aero` |
| `customers` | id, tenant_id, name, region, language, registered_number_hash, registered_number_last4, passkey_credential (JSON), created_at | the number is never stored: `SHA-256(PHONE_HASH_PEPPER ‖ E.164)` + last 4; unique per (tenant, region, hash), so the IN customer and the US twin can share one number |
| `policy_packs` | id, tenant_id, region, version, compiled_json (JSON), source_sha | compiled from YAML |
| `passes` | id, tenant_id, customer_id, assistant_name, assistant_numbers (JSON), scopes (JSON), issued_at, expires_at, status, customer_sig, issuer_sig, failures, revoked_at | status: active / revoked / locked / expired; 5 cumulative failures → locked |
| `pass_codes` | id (`pcode_…`), tenant_id, pass_id, code_hash, bound_number, expires_at, used_at | single use, 5 min; code_hash = SHA-256(pepper ‖ code) |
| `calls` | id, tenant_id, bolna_execution_id, run_id, agent, channel, from_number_last4, started_at, ended_at, transcript_ref, recording_url, purpose | `purpose` = `security_demo` for scenarios 3/4 |
| `action_requests` | id, tenant_id, call_id, run_id, customer_id, action, params (JSON), params_hash, readback_confirmed, caller_quotes (JSON), created_at | unique (tenant_id, run_id, params_hash) — invariant 7 |
| `decisions` | id, tenant_id, request_id, outcome, final_outcome, tier, base_tier, reasons (JSON), signals (JSON), coaching (JSON), decided_at | |
| `grants` | jti, tenant_id, request_id, params_hash, issued_at, expires_at, used_at | |
| `confirmations` | id, tenant_id, request_id, channel, status, answer, bolna_execution_id, answered_at | first answer wins |
| `handoffs` | id, tenant_id, request_id, call_id, reason, status, note, created_at, resolved_at | |
| `ledger_entries` | seq, tenant_id, type, ref_id, payload (JSON, masked), prev_hash, hash, created_at | PK (tenant_id, seq); written only by the Hub's outbox flush (`INSERT IGNORE`); `created_at` is the exact ISO string that was hashed |
| `test_runs` | id, tenant_id, suite, mode (text/voice), agent_version, started_at, finished_at, summary (JSON) | |
| `test_results` | id, tenant_id, run_id, scenario_id, outcome, expected, passed, metrics (JSON), evidence_ref | |

## D1 (Aero Core, SQLite) — the mock bank, physically separate
| Table | Columns |
|---|---|
| `accounts` | id, customer_ref, region, type, balance_minor, currency, status |
| `payees` | id, customer_ref, name, account_last4, ifsc_or_routing_last4, added_at, saved |
| `transactions` | id, account_id, kind, amount_minor, currency, payee_id, reference, grant_jti, created_at |
| `used_grants` | jti (PK), used_at |
| `loans`, `cards`, `fees` | minimal columns for scenarios 1, 2, 5 |

## Ledger chain (invariant 6)
- `hash = SHA-256(prev_hash ‖ canonical_json({seq, tenant_id, type, ref_id, payload, created_at}))`, lower-case hex;
  seq 1 has `prev_hash` = 64 zeros. One implementation: `packages/shared/src/ledger.ts` (API and `@halyn/sdk`).
- `type` ∈ proposed, decided, confirm_requested, confirmed, executed, handoff, pass_issued, pass_revoked, pass_locked,
  grant_issued, core_rejected.
- `payload` is masked before hashing: phone, card and account numbers become `••••` + last 4 — E.164 (+ and 7–15
  digits) or 10–18 digits, written plain or split by spaces, dashes or parentheses (`+91 80653 56344`, `080-6535-6344`,
  `4111 1111 1111 1111`), in ASCII or Devanagari digits. Ids, ULIDs, hashes, ISO times, times of day and numeric
  amounts are untouched. A 10-digit number written as a *string* (e.g. a Unix time) is masked too, so store times as
  numbers or ISO strings.
- Verification walks from seq 1 and reports the first position that is malformed, out of sequence, from another
  tenant, not linked to the previous hash, or whose hash does not recompute (`GET /web/ledger/verify`).
- A chain alone cannot reveal a rewrite by someone who also re-hashes every later row, or a cut-off tail. Pass an
  **anchor** `{seq, hash}` kept outside the rows (the Hub's `ledger_head`, an export receipt): the chain must contain
  that seq with that hash, else it is bad at that seq (or at the first missing seq when it is shorter).

## Durable Object storage (Hub, SQLite — ADR-014)
| Table | Purpose |
|---|---|
| `meta` | the bound tenant, outbox retry state |
| `ledger` | the ordered outbox: seq, entry JSON, persisted_at (null until flushed to TiDB) |
| `ledger_head` | the chain head `(seq, hash)` — the anchor for verification |
| `idempotency` | key → stored response, expires_at |
| `pending_confirmations` | request_id, channels, deadline (the alarm times them out) |
| `confirmation_results` | request_id → first answer (approved / declined / timeout) |
| `confirmation_answers` | every answer received, with `accepted` (later answers are recorded and ignored) |

WebSockets use the Hibernation API with one tag per socket: role = stage | console | aero | assistant.

## Seed (`pnpm seed`, `scripts/seed.ts` + `apps/api/src/db/seed-data.ts`)
TiDB (deterministic: fixed ids and clock, idempotent upserts): tenant `ten_aero`; customers `cus_saksham` (IN) and
`cus_saksham_us` (US) with the number from `CUSTOMER_PHONE` (hashed); both compiled policy packs; Pass `pass_demo` for the
assistant (number B) with scopes `statement.view`, `card.freeze`, `emi.move_date` (max 1), signed with `HALYN_SIGNING_KEY`
(its passkey signature is a placeholder until Step 10). D1 (Step 6): accounts, card ending 8812, fee ₹600, payees
Mom/Landlord, loan with EMI on the 5th.
