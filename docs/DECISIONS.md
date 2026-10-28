# Decisions (ADR log)

Format: one entry per decision, newest at the bottom. Use `/new-adr`. Never rewrite an accepted ADR — supersede it.

## ADR-001 · Halyn is a permission layer, not a deepfake detector — Accepted (2026-10-25)
**Context.** Detectors miss new cloning tools and phone audio is narrowband; a judge with a fresh clone could beat one live.
**Decision.** Decide actions from policy + proof + signals; never from voice authenticity. Liveness is an optional, advisory signal that can only raise the tier.
**Consequences.** Demo shows a perfect clone failing. Detection work is roadmap, not core.

## ADR-002 · The agent proposes, Halyn executes — Accepted
**Decision.** The Aero agent has no executing tool. Halyn calls Aero Core with a one-time Ed25519 grant bound to the parameter hash.
**Consequences.** A jailbroken agent still cannot act. Aero Core must verify grants (via `@halyn/sdk`).

## ADR-003 · Coaching → hold, not step-up — Accepted
**Decision.** Coaching score ≥ 0.6 forces `hold` + human handoff, because victims approve step-ups.

## ADR-004 · Markets: India (real calls) and US (browser calls only) — Accepted
**Context.** Bolna sells numbers in India and the US. US robocall rules treat AI voices as artificial voices needing prior consent.
**Decision.** No automated calls to US numbers; US region via Web Call SDK only. UK dropped.

## ADR-005 · Hosting: Vercel + Cloudflare (Workers, Durable Objects, D1, R2, KV) + TiDB Starter — Accepted
**Decision.** API on Workers (Hono). One Hub Durable Object per tenant for WebSockets, confirmation alarms and ordered ledger appends. TiDB (MySQL) is the system of record. Aero Core is a separate Worker on D1 so the bank is physically separate. Web on Vercel.
**Consequences.** 10 ms CPU per request on free Workers → WebCrypto only, precompiled policy packs. Fallback: Workers Paid ($5/mo).

## ADR-006 · Attacker personas on Bolna only with Bolna's explicit approval — Accepted
**Decision.** Until approved, attack scenarios run in text mode; Saksham plays the clone and the coached customer on real calls. No workarounds around Bolna's content check.

## ADR-007 · Halyn Pass v0.1 uses spoken 6-digit one-time codes — Accepted
**Decision.** Works on any phone line and platform today; SIP header transport later.

## ADR-008 · Toolchain pinned for the build (checked against npm 2026-10-25) — Accepted (2026-10-26)
**Context.** Several tools moved majors since the plan was written, and some current versions don't fit together.
**Decision.** pnpm 12.15 (catalog in `pnpm-workspace.yaml`, `allowBuilds`, default 1-day release-age gate) and Node 24 in CI (Vitest 5 and Wrangler need ≥ 22). TypeScript 6.0.x, because typescript-eslint 8 supports `<6.1`. ESLint 10 flat config. Vitest 5 everywhere. Workers tests use `@cloudflare/vitest-plugin` 1.x, which is `@cloudflare/vitest-pool-workers` renamed (the old package is deprecated on npm and caps Vitest at 4), with Istanbul coverage. Each Worker's `build` is `wrangler deploy --dry-run`.
**Consequences.** tsup's README says it is no longer maintained: if it breaks, move the two libraries to tsdown. eslint-config-next 16's react / jsx-a11y / import plugins declare ESLint ≤ 9 peers; they load and pass on ESLint 10 today, and if one crashes we pin ESLint 9 in `apps/web` only. The TiDB MCP server needs `--with "mcp<2"` until pytidb supports the mcp 2.x SDK.
**Alternatives.** TypeScript 7 (blocked by typescript-eslint); vitest-pool-workers 0.23 (deprecated).

## ADR-009 · Ids are `<prefix>_<ULID>`; seed ids stay readable — Accepted (2026-10-26)
**Context.** DATA_MODEL said bare ULIDs, but the seed, scenarios and PASS.md use readable ids (`ten_aero`, `cus_saksham`, `pass_demo`).
**Decision.** Every Halyn id is `<prefix>_<body>` (max 64): a ULID body for generated rows, a readable body for seed rows. Prefix-pinned schemas (`ten_`, `cus_`, `pass_`, `req_`). A grant's `jti` stays a bare ULID.
**Consequences.** Ids are self-describing in logs and the ledger, and a schema rejects an id of the wrong kind (a Pass id sent as a request id).

## ADR-010 · Bolna boundary: lenient envelope, strict params, deny instead of 400 — Accepted (2026-10-26)
**Context.** Bolna can add fields to tool calls, an LLM can produce bad params, and the caller must always hear an outcome (invariant 2).
**Decision.** Tool requests strip unknown keys; everything Halyn returns is strict. `propose_action` validates the envelope only; an unknown action or params failing the strict per-action schema become a recorded `deny` with `E_FAIL_CLOSED`. Caller quotes are trimmed to the last 5 × 300 chars. Compiled policy packs are re-checked at load against the code's critical / money-moving sets, so a stale or edited pack in KV cannot relax invariant 5.
**Consequences.** A Bolna payload change can't break a live call, and `params_hash` still binds exact, strictly validated params.

## ADR-011 · Gate clarifications where GATE.md left a choice — Accepted (2026-10-26)
**Context.** Read literally, the tier table broke GATE.md's own monotonicity property (a tier-0 read with no proof denies, one signal later it steps up), and several codes and post-approval outcomes were unspecified.
**Decision.** The nine rules in GATE.md → "Clarifications": fail closed on unoffered actions / bad params / wrong currency; reads without proof always deny and tier 0 is only for reads and protective actions; every hold carries `H_SPECIALIST`; fixed base-tier codes and order; signals use pack weights; distress before protective with a narrow lexicon; Pass scope also needs `pass_eligible`; exact limit arithmetic; post-approval cap → hold, tier 4 → delayed allow.
**Consequences.** The Gate is monotone for every valid pack, so the fast-check property can range over arbitrary packs, not only the two real ones. Saksham can override any rule; the tests name each one.

## ADR-012 · One crypto implementation in shared; anchored ledger verify — Accepted (2026-10-26)
**Context.** Grants, Passes and the ledger are signed or hashed by the API and checked by the SDK (Aero Core, tests, auditors). Two implementations would drift; a hash chain alone can't detect a full re-chain or a cut-off tail.
**Decision.** SHA-256, base64url, constant-time compare, params hash, EdDSA compact JWS, JWKS import (refuses private `d`), masking and the ledger chain live once in `@halyn/shared`; the API and SDK call them. Pure modules take `Clock` and `Rng`; only `apps/api/src/platform/crypto-rng.ts` calls `crypto.getRandomValues`. `verifyLedgerChain` accepts an optional `{seq, hash}` anchor (the Hub's `ledger_head`). `verifyGrant` can bind `expectedSub`/`expectedTenant`. Pass-code verification requires the tenant and counts failures cumulatively over the Pass's life (docs/PASS.md).
**Consequences.** Whole-chain verify costs ~200 ms per 10 000 entries in Node, over the free Workers CPU budget: `/web/ledger/verify` (Step 13) must verify incrementally from the anchor, run in the browser via the SDK, or use Workers Paid.

## ADR-013 · TiDB over HTTP; separate databases instead of a branch or a local MySQL — Accepted (2026-10-26)
**Context.** Step 5 needed a database for development and DB-backed tests: a TiDB dev branch or a local MySQL container. The Workers runtime can't speak the MySQL wire protocol without `nodejs_compat`, and TiDB branches need TiDB Cloud API keys we don't have.
**Decision.** Drizzle (`mysql-core`) over `@tidbcloud/serverless` (HTTP) everywhere, no `nodejs_compat`. A local MySQL container is rejected: the HTTP driver only talks to TiDB Cloud, so tests against MySQL would exercise a different driver than production. Use separate databases on the Starter cluster: `halyn_dev` (wrangler dev), `halyn_test` (the gated DB suite; each run uses fresh `ten_test_…` tenants and purges them), `halyn` (demo, Step 8). `pnpm db:migrate --db …` applies `apps/api/drizzle` (drizzle-kit SQL, committed). The DB suite runs when TiDB credentials exist (local `.env`, or the CI secret `TIDB_TEST_DATABASE_URL`) and otherwise skips with a warning; every other integration test is offline.
**Consequences.** CI proves the TiDB path only once the secret is set. Tests share one cluster with dev data, isolated by tenant id (helpers refuse to purge anything but `ten_test_…`).

## ADR-014 · The Hub: serialised lane, SQLite outbox to TiDB, errors as values over RPC — Accepted (2026-10-26)
**Context.** The tenant's Hub (one Durable Object) must keep ledger appends strictly ordered, deduplicate LLM retries, time out confirmations and fan out to WebSockets. Any `await` inside a DO lets a second request interleave, and TiDB may be slow or down.
**Decision.** Ordered work (appends, confirmations, the alarm) runs through one in-memory promise lane. Each append computes the next hash link, then writes the entry and `ledger_head` to DO SQLite in one transaction (the outbox). The alarm flushes unpersisted rows to TiDB in seq order through a `LedgerSink` port, using `INSERT IGNORE`, with exponential backoff. One alarm multiplexes the flush and the earliest confirmation deadline. `idempotent(key, ttl, compute)` shares one in-flight compute between concurrent duplicates and stores only successful results. Confirmations: the first answer wins; later ones are recorded in `confirmation_answers` and ignored. WebSockets use the Hibernation API, tagged by role. Hub RPC methods never throw: they return `{ok, value} | {ok:false, code, message}` (the runtime reports every rejected RPC as an uncaught exception, and the error class doesn't survive serialisation), and `hub/client.ts` turns failures back into `HalynError` on the Worker's side.
**Consequences.** The DO's SQLite is the ordering authority; TiDB's `ledger_entries` may lag by one flush interval and catches up after an outage. Callers use `hubFor(env, tenant)`, never the raw stub.

## ADR-015 · Aero Core: one batch per grant; the signed action picks the route's action — Accepted (2026-10-27)
**Context.** Step 6 needed single-use grants that survive concurrency, one `POST /core/transfers` for three actions
(`transfer.saved`, `transfer.new_payee`, `wire.new`, per docs/ACTIONS.md), and a contract the API's core client
(Step 7) can share. D1 batches are transactions but cannot branch between statements.
**Decision.** `@halyn/sdk.verifyGrant` accepts `expectedAction` as a list; the grant's verified `claims.action` picks
which action a multi-action route runs (no unverified peeking at the payload, no extra header). Every effect is ONE
`db.batch` that starts with inserting the jti into `used_grants`; a replay fails the primary key and rolls everything
back. Write handlers read the jti together with their own lookups first, so a replay is `E_GRANT_REUSED` before any
business check; after a failed batch, "is the jti recorded now?" decides REUSED vs `E_FAIL_CLOSED` (no matching on
error strings). A write the bank refuses (400/404) leaves the grant unused; a read uses its grant even on a 404.
Races the pre-checks cannot see are stopped by the schema: `CHECK (balance_minor >= 0)` and a unique index on
fee_waiver transactions. Routes and 200 bodies live in `packages/shared/src/core.ts` (`CORE_ROUTES`, contract-tested
against docs/ACTIONS.md; strict `CORE_RESPONSES`). Ids that appear in params are per customer: those tables key on
`(tenant_id, customer_ref, id)`. `pnpm seed:core` resets the demo rows and never clears `used_grants`.
**Consequences.** A refused write can be retried with the same grant within its ≤ 120 s life (it executes only the
exact signed params, for the same customer). Changing an Aero Core route or response means changing `core.ts`, which
the API and Aero Core both compile against.
**Amended (2026-10-27, Step 6 review).** (1) *Atomic preconditions.* Because a batch cannot branch, a precondition the
handler read (account active, fee due, loan open, card present, enough balance, payee saved) could stop holding
before the batch and the batch would still commit the jti and part of the effect. Each write now passes its
precondition to `recordGrant`: `used_grants.customer_ref` (NOT NULL) comes from a subquery that returns a row only
while the precondition holds, so a stale read aborts the whole batch (`E_FAIL_CLOSED`, nothing written). The schema
backstops stay. Chosen over a trigger or a second round trip: same single batch, no schema change. (2) *REUSED is
ambiguous for Halyn's own retries.* A batch that committed but whose answer was lost, retried, is `E_GRANT_REUSED`.
Kept as 401 (the double-spend contract is unchanged), but the error now carries the first use as `error.details`
(`CoreOutcomeDetailsSchema`: `{outcome: "executed", reference, request_id, used_at}`; the shared envelope gained an
optional `details`). A 500 after a commit says `executed`; a failed batch Aero Core could not check says `unknown`.
**The API's core client must treat REUSED on a retry of its own grant as "already executed — reconcile by
reference", never as "not executed"** (only Halyn holds the grant), and resolve `unknown` or a lost answer by retrying
the same grant once. (3) The body is capped at 4,096 bytes as it streams in (it is read before the signature can be
checked); invalid UTF-8 never matches. (4) `HEAD` on a core path is 405 (Hono would run the GET handler and spend a
read grant).

## ADR-016 · The Hub holds the call-time read model and decides proposals in its lane; TiDB is the mirror — Accepted (2026-10-28)
**Context.** Every Bolna tool must answer within 300 ms, and the Day-0 probe measured TiDB HTTP round trips of
650–2,200 ms from a Worker. ARCHITECTURE "Main flow" step 3 read customer, Pass state and counters from TiDB on the
`propose_action` path, and the velocity counters must be read and updated atomically (ten split transfers racing each
other must not all be allowed). Bolna's `%(execution_id)s` substitution is unconfirmed until Day-0 check 2, and an LLM
may legitimately repeat an identical proposal later in the same call (scenario 12).
**Decision.** The tenant's Hub (Durable Object SQLite) holds customers (with a `spoken_name`), Passes, Pass codes,
passkeys, calls and requests. It loads them from TiDB once (customers refresh in the background every 10 min; Passes,
codes and passkeys are written by the Hub first, so its copy wins) and writes every change to TiDB through a mirror
outbox flushed by the same alarm as the ledger (`hub/ports.ts`, `db/mirror.ts`, idempotent statements). `propose_action`
is one Hub RPC that, inside the serial lane, de-duplicates, identifies the call, builds the Gate context from the Hub's
own rows (proof, Pass uses, per-period limits in the customer's local time, transfers in the last 10 min, calls in the
last hour, unusual hour), runs the real Gate, records request + decision + ledger entries, opens the confirmation timer
and the handoff — then the Worker answers and does events, the Confirm call, grant and Aero Core in `waitUntil`.
Idempotency (invariant 7, strict): the same `(run_id, params_hash)` is the same request for the whole call, whatever its
age or state; a retry returns the existing request id/status and never creates a second request, decision, grant or Aero
Core write (the TiDB unique index stays `(tenant_id, run_id, params_hash)`; migration `0001_hub_mirror` only adds
`customers.spoken_name`). A repeated transfer is therefore a new call (scenario 12 runs each transfer in its own call;
velocity counts across calls). Without a usable
run id, a call is keyed by `sid:<call_sid>` (or the run id an earlier webhook mapped to that call sid); events need a
real run id, so such a call relies on `check_decision`. A web login warms the Hub (directory load) in the background.
**Consequences.** No TiDB call on any tool path (a test asserts it); measured `propose_action` median 10 ms in
Miniflare. The first tool call of a never-warmed Hub waits for the TiDB load once. TiDB lags the Hub by one flush and
catches up after an outage; the Hub is the authority for anything a call depends on. Run `pnpm db:migrate` (0001) and
`pnpm seed` again (spoken names) on each database.

## ADR-017 · The core client reads Aero Core by outcome; refusals are E_CORE_REJECTED — Accepted (2026-10-28)
**Context.** ADR-015 made Aero Core's answers unambiguous (`error.details` outcome hint) and left the API's side to
Step 7, including what the ledger and the call get when the bank refuses an allowed action.
**Decision.** `core-client/client.ts`: 200 → executed; 401 `E_GRANT_REUSED` or 500 with `details.outcome = executed`
→ executed earlier (reference from details, the call hears `done`); 500 `unknown`, any other 5xx, a timeout or an
unreadable answer → one retry with the SAME grant while it is valid, then `unknown` → fail closed (`deny E_FAIL_CLOSED`);
anything else without details → not executed. A new reason code `E_CORE_REJECTED` (GATE.md, `reason-codes.ts`) marks a
bank refusal (400/404): ledger `core_rejected`, event `deny`, and the action does not count towards limits. A refused
grant keeps its own code. An approved action with no Aero Core route, or a tier-4 approval that may only run after its
hold, becomes a handoff (event `hold`, reason `H_SPECIALIST` / `P_TIER4_HOLD_24H`). After every Aero Core write the Hub
broadcasts `core_update` (the balance from the response, or from a statement read with its own grant).
**Consequences.** Never two grants for one effect; a lost answer cannot turn into a second execution or a false "not
done". `E_CORE_REJECTED` joins the reason-code list (contract-tested against GATE.md).

## ADR-018 · Passkeys: a small WebAuthn verifier on WebCrypto, attestation "none" — Accepted (2026-10-28)
**Context.** The Confirm passkey leg and passkey registration need WebAuthn verification in a Worker with a 10 ms CPU
budget and no `nodejs_compat`. Libraries pull in ASN.1/CBOR stacks and Node shims.
**Decision.** `apps/api/src/webauthn`: a strict definite-length CBOR decoder (no tags or floats, bounded depth and
size), COSE → JWK for ES256, EdDSA and RS256, and checks of type, challenge (single use, kept in the Hub), origin
(`WEB_ORIGIN` allow-list), RP id hash, user presence AND verification, credential id, the signature over
authenticatorData ‖ SHA-256(clientDataJSON) (ES256 DER → raw for WebCrypto) and a growing sign count. Registration asks
for attestation "none" and does not check attestation statements: the passkey is bound to the customer by their session.
An approval's challenge is SHA-256 of the canonical `{request_id, action, params_hash, nonce}`. Declining needs no
passkey (it only makes things stricter); either answer goes through the Hub's first-answer-wins lane.
**Consequences.** Measured 0.23 ms per assertion check (ES256, workerd) — far inside the budget. Hardware attestation
is out of scope for the demo.

## ADR-019 · The scenario runner: one runner, two harnesses; the spec ships as a JSON twin — Accepted (2026-10-28)
**Context.** Step 7 needed `pnpm test:scenarios` over the real Gate, Pass, ledger, Hub and Aero Core with only Bolna and
the customer's answers simulated, and the Stage needs the same runs live. The Worker may not parse YAML at runtime.
**Decision.** `apps/api/src/test-runner/runner.ts` plays a scenario through a `Harness`. Tests use Miniflare
(`test/scenarios/harness.ts`): the real app with a Bolna recorder, the real Aero Core app imported in-process on a
Miniflare D1 with this run's throwaway keys, the tenant's real Hub with a shared movable clock (its alarm fired on
demand), real passkey and `confirm_result` routes. The Stage (`POST /web/stage/run/:n`) uses the live harness: the
same app in-process against the live Hub and Aero Core, Bolna replaced by a recorder (no call, no event leaves the
Worker), only declines simulated, waits capped to fit `waitUntil`. `tests/scenarios/scenarios.json` is the committed
twin of `scenarios.yaml`; a test fails if they differ. Scenario 6 assumes the assistant presented its Pass at the start
of the call (as scenario 5 does explicitly).
**Consequences.** 12 of 13 scenarios pass in text mode now; 10 stays pending until Step 12 (browser calls carry the app
session). A live Stage run acts on the demo customer's real Aero Core rows (re-seed with `pnpm seed:core`), and long
scenarios (3b's 60 s, 12's ten transfers) do not fit a live run's 30 s.

## ADR-020 · The Hub sweeps executions whose Worker died, with the same grant — Accepted (2026-10-28)
**Context.** The Worker claims an approved request (`executing`), signs its grant, calls Aero Core and records the
answer, all in `waitUntil`. If it dies anywhere in between (isolate evicted, `waitUntil` cut off at 30 s, a Hub RPC
lost), nothing resolves the request: the call only ever hears "pending" and the ledger never closes it (invariant 2).
A second grant would risk a second execution (invariants 1, 7); a guess either way would be a false outcome.
**Decision.** `noteGrant` takes the compact JWS and the Hub keeps it in its own SQLite (`executions`; never mirrored,
logged or returned; deleted when the request is final), refusing a second grant per request or one for another
request. `beginExecution` arms the Hub's single alarm; it sweeps requests `executing` for 30 s (by then the Worker's
`waitUntil` is over; the default grant lives 60 s), at most 10 per alarm (`hub/reconcile.ts`). No grant → nothing
reached Aero Core → `failed`, `deny E_FAIL_CLOSED`. A grant with ≥ 10 s left is presented again — the same token,
outside the lane, by the shared core client — and its answer recorded like the Worker's (executed or REUSED with
details → `done` + `core_update`; bank refusal → `deny E_CORE_REJECTED`). Expired or still unknown → `failed`,
`deny E_FAIL_CLOSED`, `core_rejected` with `reconcile: needed` and the jti, plus a specialist handoff; the Worker's own
unknown outcome now does the same. `finishExecution` is first-finish-wins: a later finish returns null and its caller
sends no event; an execution reported after a final `failed` is still appended (`reconcile: needed`) with a handoff,
so the ledger never misses a real effect. `callCore` treats `E_GRANT_EXPIRED` on a grant that may have run (a retry,
or the sweep) as unknown, since Aero Core checks expiry before the jti.
**Consequences.** Every claimed request reaches a final outcome and the call hears exactly one event; Aero Core's
single-use jti makes a Worker and the sweep presenting together write once (tested). A signed grant rests in DO
storage for at most its ≤ 120 s life plus one sweep; it only works for that request's exact params. The Hub now needs
Aero Core (binding or URL) and `HALYN_SIGNING_KEY` (for `core_update`'s statement read). An unknown outcome (failed
with the reconcile handoff open) counts towards limits and Pass uses (`countsAsUsed`): it may have executed, so the
limits only get stricter; a definite failure (bank refusal, no grant sent) does not.
**Amended (2026-10-28, Step 7 review).** (1) *Approved but never claimed.* A Worker can also die after the decision
and before `beginExecution`; the request then sat `approved` forever (the sweep only watched `executing`). Every
approval — an allow at proposal time, or a step-up settled `approved` — now records `approvals(request_id,
approved_at)` in the Hub and arms the alarm; `beginExecution` clears it. The sweep takes requests still `approved`
30 s later: nothing was signed or sent, so `finishExecution` closes them `failed`, `deny E_FAIL_CLOSED`, ledger
`core_rejected` with `by: sweep, detail: not_claimed`, one event; a late Worker's claim returns null and sends nothing.
Only the sweep may close an `approved` request, and only as "not sent". Approvals and executions share the per-alarm
bound of 10. Chosen over claiming at decision time (the claim is what lets exactly one Worker execute) and over a scan
of request statuses (requests grow without bound). (2) *Late answers.*
The confirmation deadline is the Hub's and is checked in its lane on every answer, not only by the alarm: an answer at
or after it while the alarm is late settles the timeout first — the alarm's own path (deny `C_TIMEOUT`, ledger, apps,
`timeout` event, the Confirm call stopped) — and is recorded as ignored. A passkey approval challenge lives 30 s past
the deadline so a late assertion reaches the Hub (one clock decides). (3) *Callback binding.* `confirm_result` counts
only from the Confirm call Halyn placed for that request (`execution_id` set and equal to the run id); before it is
attached, when it was never placed, from the Aero call or a `sid:` call it is 404 with nothing recorded. The callback
leg therefore needs Bolna's real run id on the Confirm call's tool request (Day-0 check 2, or the webhook's call sid →
run id map); without it the passkey and the timeout remain.

## ADR-021 · WebSocket tickets: the session token never goes in a URL — Accepted (2026-10-28)
**Context.** Browsers cannot set headers on a WebSocket, so `GET /ws` took the session token (a 12 h bearer
credential) as `?token=`. The API never logs query strings, but Cloudflare's edge, proxies and browser history may keep
full URLs, which would leak a replayable session.
**Decision.** `POST /web/ws-ticket` `{role}` (Bearer session, CORS like every `/web/*` route) → `{ticket, expires_at}`.
The role must be one the session may take (customer: aero/assistant; console: stage/console), else 401. The tenant's
Hub issues the ticket body `<tenant>.<32 random bytes>` from its own rng and clock and keeps only its SHA-256 with the
session kind, customer, role and a 30 s expiry (`ws_tickets`). The Worker seals the body with HMAC-SHA256
(`SESSION_SECRET`, domain-separated from session signatures). `GET /ws?ticket=…&role=…` checks the seal (so a forged or
re-labelled ticket never wakes, or creates, a Durable Object), then forwards the upgrade to that tenant's Hub, which
reads and deletes the ticket in one synchronous step (single use even under concurrent upgrades; burned whatever the
outcome) and accepts only an unexpired ticket for the same role. The socket is tagged with the role and, for a
customer, `customer:<id>`. Any `?token=` is refused (401), never silently accepted or ignored. Chosen over a cookie
(cross-site between the Vercel app and the Worker) and over the `Sec-WebSocket-Protocol` header (would put the session
in a header proxies also log, and still a long-lived credential).
**Consequences.** One extra round trip per (re)connect; the web app (`apps/web` `use-hub.ts`) must ask for a fresh ticket
each time. A leaked ticket is worth at most one socket for 30 s, for one role, and only if nobody used it first.

## ADR-022 · Webhook secret as `?key=` — Accepted (2026-10-28)
**Context.** Bolna's agent `webhook_url` and a tool's `pre_call_webhook_url` cannot send headers, so `/webhooks/*` could
never pass the `x-halyn-secret` check, and the call-sid → run-id map (ADR-016) would never fill. **Decision.**
`/webhooks/*` also takes the secret as `?key=`; the Bolna IP allowlist still applies; `/tools/*` stays header-only.
**Consequences.** The secret sits in the agents' webhook URLs on Bolna (it is in their tool headers already); our
request log records the path only. Rotating the secret means re-pushing every agent.
