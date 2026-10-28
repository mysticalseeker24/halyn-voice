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
| `customers` | id, tenant_id, name, spoken_name, region, language, registered_number_hash, registered_number_last4, passkey_credential (JSON: the passkeys), created_at | `spoken_name` is what voices say (seed: `सक्षम`, CLAUDE.md §8); screens use `name`. The number is never stored: `SHA-256(PHONE_HASH_PEPPER ‖ E.164)` + last 4; unique per (tenant, region, hash), so the IN customer and the US twin can share one number |
| `policy_packs` | id, tenant_id, region, version, compiled_json (JSON), source_sha | compiled from YAML |
| `passes` | id, tenant_id, customer_id, assistant_name, assistant_numbers (JSON), scopes (JSON), issued_at, expires_at, status, customer_sig, issuer_sig, failures, revoked_at | status: active / revoked / locked / expired; 5 cumulative failures → locked |
| `pass_codes` | id (`pcode_…`), tenant_id, pass_id, code_hash, bound_number, expires_at, used_at | single use, 5 min; code_hash = SHA-256(pepper ‖ code) |
| `calls` | id, tenant_id, bolna_execution_id, run_id, agent, channel, from_number_last4, started_at, ended_at, transcript_ref, recording_url, purpose | `purpose` = `security_demo` for scenarios 3/4 |
| `action_requests` | id, tenant_id, call_id, run_id, customer_id, action, params (JSON), params_hash, readback_confirmed, caller_quotes (JSON), created_at | unique (tenant_id, run_id, params_hash) — invariant 7: the same pair is one request for the whole call (the Hub answers a retry with it, ADR-016) |
| `decisions` | id, tenant_id, request_id, outcome, final_outcome, tier, base_tier, reasons (JSON), signals (JSON), coaching (JSON), decided_at | |
| `grants` | jti, tenant_id, request_id, params_hash, issued_at, expires_at, used_at | |
| `confirmations` | id, tenant_id, request_id, channel, status, answer, bolna_execution_id, answered_at | first answer wins |
| `handoffs` | id, tenant_id, request_id, call_id, reason, status, note, created_at, resolved_at | |
| `ledger_entries` | seq, tenant_id, type, ref_id, payload (JSON, masked), prev_hash, hash, created_at | PK (tenant_id, seq); written only by the Hub's outbox flush (`INSERT IGNORE`); `created_at` is the exact ISO string that was hashed |
| `test_runs` | id, tenant_id, suite, mode (text/voice), agent_version, started_at, finished_at, summary (JSON) | |
| `test_results` | id, tenant_id, run_id, scenario_id, outcome, expected, passed, metrics (JSON), evidence_ref | |

## D1 (Aero Core, SQLite) — the mock bank, physically separate
Schema: `apps/aero-core/src/db/schema.ts` (Drizzle `sqlite-core`); migrations: `apps/aero-core/migrations/` (drizzle-kit
SQL, committed; `wrangler d1 migrations apply aero-core`). Every table has `tenant_id` and every query filters on it and
on `customer_ref` (= the grant's `sub`). Ids that appear in action params (`fee_late_oct`, `loan_personal_1`,
`payee_mom`) are unique per customer, so those tables key on `(tenant_id, customer_ref, id)`. Money is INTEGER minor units
+ `currency` (`INR`/`USD`); times are UTC ISO-8601 strings; booleans are 0/1.
| Table | Columns | Keys and checks |
|---|---|---|
| `accounts` | tenant_id, id, customer_ref, region, type (savings/current/checking), currency, balance_minor, is_primary, status (active/blocked), opened_at | PK (tenant_id, id); unique (tenant, customer, type); one primary per (tenant, customer, currency); **CHECK balance_minor ≥ 0** |
| `cards` | tenant_id, id, customer_ref, account_id, last4, status (active/frozen), frozen_at, updated_by_grant | PK (tenant_id, id); unique (tenant, customer, last4) |
| `fees` | tenant_id, customer_ref, id, account_id, description, amount_minor, currency, status (due/waived), charged_at, waived_at, waived_by_grant | PK (tenant_id, customer_ref, id); amount > 0 |
| `loans` | tenant_id, customer_ref, id, account_id, description, emi_minor, currency, emi_day, status (active/closed), updated_at, updated_by_grant | PK (tenant_id, customer_ref, id); emi_day 1–28 |
| `payees` | tenant_id, customer_ref, id, name, account_last4, ifsc (IN), routing_last4 (US), saved, added_at, added_by_grant | PK (tenant_id, customer_ref, id); new payees from `transfer.new_payee` / `wire.new` are added unsaved |
| `transactions` | tenant_id, id, customer_ref, account_id, kind (credit/debit), category (salary/card/fee/fee_waiver/emi/transfer/wire), amount_minor, currency, description, payee_id, fee_id, reference, grant_jti, created_at | PK (tenant_id, id); index (tenant, account, created_at); **unique (tenant, customer, fee_id) where category = fee_waiver** (a fee is credited once); amount > 0 |
| `used_grants` | jti (PK), tenant_id, customer_ref, action, request_id, used_at | inserted first in the same D1 batch as the effect (invariant 1); for writes `customer_ref` (NOT NULL) comes from the write's precondition subquery, so a precondition that no longer holds aborts the whole batch (ADR-015). `request_id` + `used_at` are returned as `error.details` on `E_GRANT_REUSED` |

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
| `pending_confirmations` | request_id, channels, deadline (the alarm times them out; an answer at or after the deadline while the alarm is late settles the timeout itself) |
| `confirmation_results` | request_id → first answer (approved / declined / timeout) |
| `confirmation_answers` | every answer received, with `accepted` (later answers are recorded and ignored) |
| `customers`, `passes`, `pass_codes`, `credentials` | the call-time directory (ADR-016): loaded from TiDB once (customers refresh every 10 min), then written here first |
| `challenges` | WebAuthn challenges, single use (registration 5 min; approval until 30 s past the confirmation deadline, so a late answer reaches the Hub and is refused there) |
| `calls` | one row per run id: customer, registered?, Pass, number hash (never the number), call sid ↔ run id |
| `requests` | every proposal: Gate decision, status, confirmation, execution, the event the call should be in |
| `packs` | the compiled packs requests were decided with (post-approval rules need the same pack) |
| `executions` | one row per request while it is `executing` (ADR-020): started_at, swept_at, and the signed grant (compact JWS) once noted, so the alarm's sweep can present the same grant again. Never mirrored, logged or returned; deleted when the request is final |
| `approvals` | one row per request while it is `approved` and not yet claimed by a Worker (ADR-020): approved_at. Arms the alarm; the sweep fails the request closed 30 s later if no Worker claimed it. Deleted on claim or when final |
| `ws_tickets` | one-time WebSocket tickets (ADR-021): SHA-256 of the ticket (never the ticket), session kind, customer, role, expires_at (30 s). Deleted when used (whatever the outcome) or expired |
| `mirror` | the outbox of TiDB rows (calls, requests + decisions, grants, confirmations, handoffs, Pass and code updates, passkeys) |

WebSockets use the Hibernation API, tagged with the role (stage | console | aero | assistant) and, for a customer's
socket, `customer:<id>` too.

## Seed (`pnpm seed`, `scripts/seed.ts` + `apps/api/src/db/seed-data.ts`)
TiDB (deterministic: fixed ids and clock, idempotent upserts): tenant `ten_aero`; customers `cus_saksham` (IN) and
`cus_saksham_us` (US) with the number from `CUSTOMER_PHONE` (hashed); both compiled policy packs; Pass `pass_demo` for the
assistant (number B) with scopes `statement.view`, `card.freeze`, `emi.move_date` (max 1), signed with `HALYN_SIGNING_KEY`
(its passkey signature is a placeholder until Step 10).

D1 (`pnpm seed:core`; rows from `apps/aero-core/src/seed/seed-data.ts`, written to `apps/aero-core/seed/seed.sql`).
Re-running resets the demo customers' rows (never `used_grants`). Tests seed fresh customers from the same template.
| | `cus_saksham` (IN) | `cus_saksham_us` (US) |
|---|---|---|
| Account | `savings`, INR, ₹5,20,000 (`52000000`), primary | `checking`, USD, $12,450 (`1245000`), primary |
| Card | ending `8812` (scenario 1) | ending `2207` |
| Fee | `fee_late_oct` ₹600 (`60000`), due (scenario 2) | `fee_us_late_oct` $35 (`3500`), due |
| Loan | `loan_personal_1`, EMI ₹12,500 on the 5th (scenario 5 moves it to the 10th) | — |
| Saved payees | `payee_mom` (Mom, ending 5521, `AERO0000003`), `payee_landlord` (Landlord, ending 7734, `AERO0000004`) | `payee_us_landlord` (ending 6610, routing ending 0042) |
| Statement | 7 lines, Oct 1–22 (salary, card, fee, EMI, rent, transfer to Mom) | 4 lines |
