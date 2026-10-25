# Worklog

Newest at the top. One entry per session via `/handoff`: what changed, tests run (with counts), what's next, anything risky.

## 2026-10-26 · Step 1 — packages/shared, test-first
- Built by the api-builder subagent (tests red first), reviewed in the parent session.
- Modules: `errors` (HalynError), `reason-codes` (31 codes = docs/GATE.md), `ids` (ULID, `<prefix>_<id>`, E.164,
  hex64, scenario ids), `region`, `money` (integer minor units, ₹ lakh / $ grouping, parse/format via digit strings),
  `canonical-json` (RFC 8785-style, fails closed on non-JSON data), `actions` (17 ActionIds, strict params, money-moving
  and critical sets, `parseActionParams`, `actionAmount`), `policy-pack` (YAML schema with cross-field rules +
  normalised compiled schema + `compilePolicyPack`), `pass`, `grant` (exp − iat ≤ 120 s), `jws`, `decision`
  (strictness order), `events` (outcome events into calls), `api` (tool + selected web bodies), `ws` (Hub messages).
- `scripts/compile-packs.ts` real: YAML → validated, normalised JSON with `source_sha`; reproducible; part of `build`.
- Review fixes: compiled packs are now re-checked against the code's critical / money-moving sets (a tampered KV pack
  can't make `transfer.new_payee` Pass-eligible); `ScenarioIdSchema` accepts only 1–12 and 3b.
- Contract tests read docs/GATE.md, both packs and scenarios.yaml (every propose validates; every reasons_include code
  exists); `turbo.json` inputs in shared and api make Turbo re-run them when those specs change.
- Tests (`pnpm verify`, cache bypassed): lint ✓, typecheck ✓, unit 379 ✓ (shared 360 at 100% lines/branches/
  functions/statements, tooling 13, api 2, web 2, sdk 1, aero-core 1), int 5 ✓, scenarios 1 ✓, build + compile ✓.
- Decisions: ADR-009 (prefixed ids), ADR-010 (Bolna boundary: lenient envelope, strict params, deny not 400).
- Next: Step 2 (Gate). Risks: invented param shapes for unused actions; quote trimming hides over-long input silently.

## 2026-10-26 · Step 0 — monorepo scaffold
- Repo: git initialised; starter docs pushed as the first commit (`b417851`) to `mysticalseeker24/halyn-voice`.
- Workspace: pnpm 12 workspace with a version catalog, Turborepo tasks (incl. root `//#` tasks), `tsconfig.base.json`
  (strict, `noUncheckedIndexedAccess`), ESLint 10 flat config + Prettier, root scripts incl. `verify` and stubs.
- Pure-module boundary: `no-restricted-imports/-globals/-properties/-syntax` for `apps/api/src/{gate,grants,ledger,pass}`
  and `packages/shared` (no db/bolna/hub/core-client, no platform or network modules, no clock or randomness).
- `apps/api`: Hono Worker, `/health`, `HubDO` (SQLite DO, migration v1), KV `CONFIG`, R2 `FILES`, no `nodejs_compat`.
  `apps/aero-core`: Hono Worker + D1 `DB`. Both: `wrangler types`, Vitest projects unit/int(/scenarios) in workerd.
- `apps/web`: Next 16 App Router, Tailwind 4, shadcn (base-nova, Base UI), Inter + JetBrains Mono, route groups
  (stage)/(console)/(aero)/(assistant) with placeholder pages, Vitest + Testing Library, Playwright smoke.
- `packages/shared`, `packages/sdk`: tsup ESM + d.ts; Vitest + fast-check.
- CI: Node from `.node-version` (24), checkout/setup-node v7, pnpm/action-setup v6, secret scan widened to `bn-`,
  `sk_`, `cfat_` keys, Playwright report artifact on failure.
- MCP: Bolna verified. Cloudflare (`mcp.cloudflare.com`, bearer token) and TiDB (pytidb, `mcp<2` pin) in a git-ignored
  `.mcp.json` (template `.mcp.example.json`), both checked live. Secrets in git-ignored `.env`.
- Tests (`pnpm verify`, Turbo cache bypassed): lint ✓ (0 warnings), typecheck ✓ (6 projects), unit 21 ✓ (tooling 13,
  shared 2, sdk 1, api 2, aero-core 1, web 2; coverage 100% where measured), int 5 ✓, scenarios 1 ✓, build ✓.
  `pnpm test:e2e` 5 ✓ (CI mode).
- Decisions: ADR-008 (toolchain versions, vitest-plugin rename, TS 6.0 cap, tsup risk).
- Next: commit + push (5–8 commits), check CI, then Step 1. Risks: CI not yet run; tsup maintenance; ESLint 10 peers.

## 2026-10-25 · Planning (pre-build)
- Product, architecture, scenarios, compliance and build plan finalised (see the planning doc on claude.ai and `docs/`).
- Numbers: A +918065356344 (owned earlier), B +918065356379 (bought Oct 25).
- Starter repo generated: CLAUDE.md, docs, scenario spec, policy packs, prompts, Claude Code agents/commands/hooks, CI.
- Next: Step 0 in PROMPTS.md.
