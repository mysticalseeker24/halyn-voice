# Worklog

Newest at the top. One entry per session via `/handoff`: what changed, tests run (with counts), what's next, anything risky.

## 2026-10-26 · Step 3 — grants, ledger, Pass core, SDK
- Shared (one implementation, ADR-012): `crypto.ts` (SHA-256, strict base64url, constant-time compare, params hash,
  Ed25519 JWK/JWKS import, EdDSA compact JWS that checks alg/typ/kid and the signature before parsing claims),
  `newUlid`/`newId`, `Rng`, `mask.ts` (phone/card/account numbers incl. spaced, dashed and Devanagari forms → last 4),
  `ledger.ts` (entry schema and types, hash chain from a zero genesis, `verifyLedgerChain` with optional anchor).
- api: `grants/signGrant` (exact params hash, 1–120 s, ULID jti), `ledger/nextLedgerEntry` (masked payload),
  `pass/` (issue rejects critical / unoffered / non-eligible scopes; sign/verify tokens; code mint by rejection
  sampling, pepper hash, 5 min, bound number; verify single use, tenant-bound, cumulative failures, lock at 5;
  revoke), `platform/crypto-rng.ts` (the only `getRandomValues`).
- sdk: `verifyGrant` (missing / invalid / expired / params mismatch, optional sub and tenant binding),
  `verifyLedger`, `proposeAction`, README with a 10-line Aero Core route. `pnpm keys:generate` writes JWK + JWKS to
  `scripts/out/keys` (git-ignored) and never prints the private key.
- test-engineer pass: invariant map, 6 mutations all caught; bugs fixed test-first — JWKS accepted a private `d`,
  masking missed real number formats, Pass-code verify had no tenant binding; gaps closed — ledger anchor (re-chain /
  truncation), `verifyGrant` sub/tenant binding, batched ledger hashing (~210 ms / 10 000 entries).
- Fixed a lint race: tsup/Vite temp config files (`*.bundled_*.mjs`, `*.timestamp-*.mjs`) are now ignored.
- Tests (`pnpm verify`, cache bypassed): lint ✓, typecheck ✓, unit: shared 564 (100/99.7), api 479 (grants, ledger,
  pass, platform 100; gate 99.2), sdk 46 (100), tooling 22, web 2, aero-core 1; int 5; scenarios 1; build ✓.
- Next: commit + push after go-ahead; Step 4 (Day-0 calls) needs the calling window and a wallet check.

## 2026-10-26 · Step 2 — the Gate, lexicons, action catalog
- `docs/ACTIONS.md`: every action's params, kind, money/critical flags, tier per region, Aero Core route, scenarios;
  a contract test checks it against code and both packs (verified by mutating the doc). No input needed from Saksham:
  the invented shapes belong to actions that are human-only or have no Aero Core route.
- GATE.md "Clarifications" 1–9 + ADR-011 settle what the doc left open (notably: reads without proof always deny and
  tier 0 is only for reads/protective, which makes the Gate monotone for every valid pack).
- Shared: `Clock` (+ `fixedClock`), tier-0 rule in source and compiled pack schemas, `__proto__` param regressions.
- `apps/api/src/gate`: `decide()` (pure, Zod-validated inputs, fail closed), `resolveStepUp()` (cap → hold, tier ≥ 4 →
  delayed allow), `toDecision()`; `apps/api/src/signals`: coaching (English/Hinglish/Hindi, strong/weak cues, integer
  scoring) and distress (narrow: bereavement, self-harm, abuse, medical) lexicons, both under the purity lint rule.
- Built by api-builder (one run stopped by Saksham, a second finished it), then a test-engineer pass: invariant map
  (every rule/clarification → a test), 10 code mutations all caught by properties, 2 new properties, and 3 bugs fixed
  test-first — invisible characters / variants defeating the coaching lexicon, over-broad Hinglish distress phrases,
  and a `__proto__` params key silently dropped instead of failing closed.
- Tests (`pnpm verify`, cache bypassed): lint ✓, typecheck ✓, unit: api 391 (gate 99.2/99.2/100/100, lexicons 100),
  shared 390 (100%), tooling 15, web 2, sdk 1, aero-core 1; int 5; scenarios 1; build + both packs ✓.
- Gate per scenario: 1 allow · 2 allow · 3/3b step_up → deny (C_DECLINED / C_TIMEOUT) · 4 hold (coaching 0.95) ·
  5 allow, allow · 6 step_up → deny · 7 deny · 8 deny · 9 hold · 10 hold (IN compare: step_up) · 11 step_up ·
  12 allow ×2 then step_up (S_VELOCITY).
- Next: commit + push, then Step 3. Risks: lexicon recall on real STT output is untested until voice smoke; distress
  narrowing choices (person-named only) await Saksham's review.

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
