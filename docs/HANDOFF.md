# Handoff — continuing in a new Claude Code chat

Chat #1 (2026-10-25 → 27) built Steps 0–3 (pushed, CI green), Step 5 and the Day-0 setup. Everything a new chat needs
is in the repo: `CLAUDE.md` (auto-loaded) → `docs/STATE.md` (auto-loaded via CLAUDE.md) → this file → the docs they
point to. Nothing important lives only in chat history.

## Open the new chat in `E:\Code and Shit\DevLabs\Bolna Buildathon\Build 2\halyn-voice`
Starting there loads: `CLAUDE.md` + `docs/STATE.md`; the project MCP servers in `.mcp.json` (**Cloudflare** and
**TiDB**, pre-approved in `.claude/settings.local.json`; the Bolna MCP is user-level and loads anywhere); the project
subagents in `.claude/agents/` (`api-builder`, `test-engineer`, `bolna-voice-engineer`, `code-reviewer`,
`compliance-reviewer`, `call-reviewer`, `web-builder`); the commands in `.claude/commands/` (`/verify`, `/handoff`,
`/day0-checks`, `/run-scenario`, `/review`, `/new-adr`, `/pull-call`, `/update-agent`, `/compliance-check`,
`/ship-check`); and the PostToolUse hook `scripts/hooks/check-file.mjs` (blocks secrets, stray phone numbers and
non-protective prompt wording). Chat #1 started one folder up, so none of these were registered there; it used
"fork" subagents briefed with the agent's `.md` instead.

## Conventions from chat #1 (keep them)
1. **pnpm 12.15.0 only.** The global pnpm on this machine is 9.15.2 and ignores the `packageManager` pin. Either
   Saksham runs `npm i -g pnpm@12.15.0` once, or the session makes a shim: `corepack enable pnpm --install-directory
   <scratchpad>\corepack-bin` and prepends that folder to `PATH` in every PowerShell/Bash call. Never run pnpm 9 here.
2. **Time in IST:** `node -e "console.log(new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}))"`. Git Bash
   `date` ignores `TZ` and prints UTC (that mistake cost the Day-0 calls on Oct 26).
3. **Secrets:** never read aloud, print or commit `.env`, `.mcp.json`, `.dev.vars`, `scripts/out/**`. Scripts load
   `.env` with `node --env-file=.env` / `process.loadEnvFile`. Before every push: CI's secret-pattern scan over the new
   commits **and** a check that no literal `.env` value appears in `git log -p origin/main..HEAD`.
4. **Commits and pushes:** at the end of each step, **ask Saksham before committing and pushing** (show the split).
   Every push carries **5–8 commits**, conventional messages ending with
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Before pushing, verify **each** commit on its own: check
   it out in place (`git checkout --detach <sha>`), run typecheck + `eslint --max-warnings 0` + tests with coverage for
   the packages it touches (build `packages/shared` and `packages/sdk` with `tsup` first when later packages need
   them), then `git checkout main`. (A worktree under the long scratchpad path breaks workerd on Windows.) Push uses
   the repo-local credential helper `!gh auth git-credential`; then `gh run watch <id> --exit-status` in the background.
5. **Step workflow:** read the `PROMPTS.md` step and only the docs it names → use the subagents the step names
   (api-builder builds test-first; test-engineer attacks it: invariant map, mutation checks, failing test before every
   fix) → review their diff yourself → `pnpm verify` with `TURBO_FORCE=true` (zero ESLint/Prettier warnings) →
   `/handoff` (STATE, WORKLOG, ADRs for trade-offs) → ask → commit/push → CI.
6. **Bolna:** CLAUDE.md §3 rules; go-ahead per session for any call/agent/number/wallet action; `get_agent` →
   `restricted: false` after every save; `list_violations` + COMPLIANCE.md log after any call session. Graph-agent
   tools are missing from the Bolna MCP → `scripts/bolna/*.ts` (writes need `--yes`). Measured cost ≈ 3 ¢/billed
   minute (plan at 4 ¢). Calls only 09:00–21:00 IST.
7. **Design rules settled in chat #1:** GATE.md "Clarifications" 1–9 (ADR-011); crypto lives once in
   `@halyn/shared` (ADR-012); TiDB via the HTTP driver with `halyn_dev`/`halyn_test` databases, no MySQL container
   (ADR-013); Hub = per-tenant DO with a serial ledger lane, SQLite outbox to TiDB, one alarm for flush + confirmation
   deadlines, RPCs return results (ADR-014); `docs/ACTIONS.md` is the action catalog (contract-tested).
8. **Machine quirks:** this network can't open `*.workers.dev` (Cloudflare anycast times out) — read the Day-0 probe
   via `tools/day0-probe/read-log.mjs`; `ffprobe`/ffmpeg aren't installed (needed to trim the voice takes — install
   or use another tool); Docker is installed but unused.

## Step 5 commit split (use if Step 5 is not on `main` yet — ask first)
1. `feat(shared): API reason codes` — `packages/shared/src/reason-codes.ts` (+test changes), `docs/GATE.md`
2. `feat(db): TiDB schema, migrations, tenant-first queries, seed, db:migrate` — `apps/api/src/db/**`,
   `apps/api/drizzle/**`, `apps/api/drizzle.config.ts`, `apps/api/package.json`, `apps/api/vitest.config.ts`,
   `apps/api/test/fixtures/db.ts`, `scripts/{lib/tidb.ts,db-migrate.ts,test-db-setup.ts,seed.ts,types/webcrypto.d.ts}`,
   root `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.prettierignore`
3. `feat(api): env validation, error envelope, Bolna guard, sessions, routes` — `apps/api/src/{env,index}.ts`,
   `src/http/**`, `src/auth/**`, `src/web/**` (+tests), `apps/api/wrangler.toml`, `worker-configuration.d.ts`,
   `test/fixtures/api.ts`, `test/int/guard.test.ts`
4. `feat(hub): ordered ledger lane, TiDB outbox, idempotency, confirmations, WebSockets` — `apps/api/src/hub/**`,
   `test/fixtures/hub.ts`, `test/int/{hub,ws,worker}.test.ts`
5. `test(db): gated TiDB suite and CI secret wiring` — `apps/api/test/db/**`, `apps/api/turbo.json`, `.github/workflows/ci.yml`
6. `feat(bolna): REST helpers, Day-0 agents and probe Worker` — `scripts/bolna/**`, `tests/tooling/bolna-helpers.test.ts`,
   `agents/**`, `tools/day0-probe/**`
7. `docs: ADR-013/014, data model, API, runbook, testing, env example` — `docs/{DECISIONS,DATA_MODEL,API,RUNBOOK,TESTING}.md`,
   `apps/api/CLAUDE.md`, `.env.example`
8. `docs: Day-0 plan and results, voice script, compliance log, state, worklog, handoff` — `docs/{DAY0,VOICE_SAMPLE_SCRIPT,COMPLIANCE,STATE,WORKLOG,HANDOFF}.md`
Check `git status` against this list first; anything unlisted goes to the closest group or is asked about.

## Prompt to paste into the new chat
```text
We're continuing Halyn (Bolna Symphony Buildathon) from a previous Claude Code chat that ran out of room. Nothing is
lost: the repo is the memory.

1. Read, in order: CLAUDE.md and docs/STATE.md (already loaded), docs/HANDOFF.md (conventions — follow every one),
   docs/DAY0.md, and the PROMPTS.md steps after Step 5. Then check the real state yourself: `git status`,
   `git log --oneline -12`, the latest CI run (`gh run list --limit 3`), the IST time (node command in HANDOFF.md),
   and the Bolna wallet (get_user_info, cents). Set up pnpm 12 as HANDOFF.md says.
2. Tell me in ≤ 10 lines what's done, what's pending and the plan for today, given the freeze on Wed Oct 28 23:59 IST.
3. If Step 5 is still uncommitted: show me the commit split from HANDOFF.md, ask, then commit, push and watch CI.
4. Day-0 calls (Step 4) — only between 09:00 and 21:00 IST, and only after you've shown me the planned minutes and
   cost from docs/DAY0.md and I've said go ahead in this chat. Tell me exactly when to call A and when to pick up.
   Re-measure check 11 (TiDB latency) on a real request. Afterwards: restricted on all agents, list_violations,
   COMPLIANCE.md log, results into STATE.md and DAY0.md. Then remove the probe's cron and, once Day-0 is closed, the probe.
5. Check 8: my voice takes are in scripts/out/voice/ (Take 1–3 + Consent Clip, m4a). Check their length, trim to
   10–15 s WAV mono 24 kHz, and walk me through the Sarvam consent tick before creating the clone.
6. Then secrets (keys:generate, peppers, SESSION_SECRET, .dev.vars, re-seed halyn_dev with my real number) and
   Step 6, Step 7… following PROMPTS.md, with the subagents each step names.
Always: ask before any commit+push (5–8 commits per push), never print secrets, never place calls or change Bolna
agents/numbers without my go-ahead in this chat.
```
