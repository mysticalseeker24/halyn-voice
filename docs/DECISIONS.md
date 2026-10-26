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
