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
