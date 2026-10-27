# Handoff — continuing in a new Claude Code chat

Chat #1 (Oct 25–27) built Steps 0–3, 5 and the Day-0 setup. Chat #2 (Oct 27–28) built Step 6 (Aero Core) + its
review fixes, set the secrets, re-seeded `halyn_dev` with the real number, made the Sarvam voice clones (check 8) and
redeployed the Day-0 probe for check 11. Everything a new chat needs is in the repo: `CLAUDE.md` (auto-loaded) →
`docs/STATE.md` (auto-loaded via CLAUDE.md) → this file → the docs they point to. Nothing lives only in chat history.

## Open the new chat in `E:\Code and Shit\DevLabs\Bolna Buildathon\Build 2\halyn-voice`
That loads `CLAUDE.md` + `docs/STATE.md`, the project MCP servers (`.mcp.json`: **Cloudflare**, **TiDB**; the Bolna
MCP is user-level), the subagents in `.claude/agents/` (`api-builder`, `test-engineer`, `bolna-voice-engineer`,
`code-reviewer`, `compliance-reviewer`, `call-reviewer`, `web-builder`), the commands in `.claude/commands/` (`/verify`,
`/handoff`, `/day0-checks`, `/run-scenario`, `/review`, `/new-adr`, `/pull-call`, `/update-agent`, `/compliance-check`,
`/ship-check`) and the PostToolUse hook `scripts/hooks/check-file.mjs` (blocks secrets, stray phone numbers,
non-protective prompt wording and misspellings of Saksham's name).

## Conventions (keep every one)
1. **pnpm 12.15.0** is the global pnpm on this machine now (`pnpm --version`). Never use pnpm 9.
2. **Time in IST:** `node -e "console.log(new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}))"`. Git Bash
   `date` ignores `TZ`. Calls only 09:00–21:00 IST (chat #2 missed the window twice — check the time first).
3. **Secrets:** never read aloud, print or commit `.env`, `.mcp.json`, `.dev.vars`, `scripts/out/**` (reading `.env`
   directly is denied; check presence with a Node script that prints names only). Scripts load `.env` with
   `node --env-file=.env` / `process.loadEnvFile`. Before every push: CI's secret-pattern scan over the new commits
   **and** a check that no literal `.env` value appears in `git log -p origin/main..HEAD`.
4. **Commits and pushes:** at the end of each step, **ask Saksham before committing and pushing** (show the split).
   He likes **more, smaller commits** (8+ per push is fine), conventional messages ending with
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Before pushing, verify **each** commit on its own:
   `bash scripts/verify-commits.sh <scratch-logdir> $(git rev-list --reverse origin/main..HEAD)` (worktree `E:/hvw`,
   Turbo cache on; re-run a commit that hits a known environmental flake listed in the script). Push with
   `GCM_INTERACTIVE=never GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c 'credential.helper=!gh auth git-credential'
   push origin main` — a plain `git push` hangs on the system Git Credential Manager (it runs before the repo's `gh`
   helper). Then `gh run watch <id> --exit-status` in the background.
5. **Step workflow:** read the `PROMPTS.md` step and only the docs it names → the subagents the step names
   (api-builder builds test-first; test-engineer attacks it: invariant map, mutation checks, failing test before every
   fix) → review their diff yourself → `pnpm verify` with `TURBO_FORCE=true` (zero ESLint/Prettier warnings) →
   code-reviewer → `/handoff` (STATE, WORKLOG, ADRs) → ask → commit/push → CI.
6. **Token budget (Saksham hit his session + weekly limits in chat #2):** subagents start cold, so give **tight briefs
   naming exact files/sections**; `model: "sonnet"` for test-engineer, code-reviewer, compliance-reviewer,
   call-reviewer, web-builder and mechanical work, Opus for api-builder on invariant logic (Gate, grants, Confirm,
   core client) and for anything Bolna-agent-critical if Sonnet stumbles; small fixes inline; keep tool output small
   (grep/tail logs, never dump them); run subagents one at a time unless Saksham asks for parallel (he did: Step 9
   alongside Steps 7–8 — give each exclusive file ownership). If a subagent stops on a limit, resume it with
   `SendMessage` (its work is in the tree), don't start a new one.
7. **Bolna:** CLAUDE.md §3 rules; go-ahead per session for any call/agent/number/wallet/deploy action; `get_agent` →
   `restricted: false` after every save; `list_violations` + COMPLIANCE.md log after any call session. Graph-agent
   tools are missing from the Bolna MCP → `scripts/bolna/*.ts` (writes need `--yes`). ≈ 3 ¢/billed minute (plan 4 ¢).
8. **Saksham's name:** **सक्षम मिश्रा** (short "Sa"). Any text a voice speaks — English too, and every
   `{{customer_name}}` / `user_data.customer_name` — writes it in Devanagari; Sarvam speaks Roman "Saksham" with a long
   "Saa" (STT-checked). Screens show "Saksham". Never write the wrong spellings in files (the hook blocks them).
9. **Design rules settled:** GATE.md "Clarifications" 1–9 (ADR-011); crypto once in `@halyn/shared` (ADR-012); TiDB
   HTTP driver with `halyn_dev`/`halyn_test`, no MySQL container (ADR-013); Hub = per-tenant DO, serial ledger lane,
   SQLite outbox, one alarm, RPCs return results (ADR-014); Aero Core = one D1 batch per grant with the jti first and
   the precondition inside the batch, `CoreOutcomeDetails` on `E_GRANT_REUSED`/post-commit 500 (ADR-015, docs/API.md);
   `docs/ACTIONS.md` + `CORE_ROUTES` are the action/route catalog (contract-tested).
10. **Machine quirks:** this network can't open `*.workers.dev` (read the probe with `node --env-file=.env
    tools/day0-probe/read-log.mjs 20`); ffmpeg isn't installed — `npm i @ffmpeg-installer/ffmpeg
    @ffprobe-installer/ffprobe` in a scratch folder works (`ffmpeg-static`'s GitHub download is reset); in the Bash
    tool use `(cd sub && …)` subshells so the working directory stays at the repo root.

## Parallel plan for chat #3 (Saksham's choice)
- **Step 7** (api-builder → test-engineer) owns `apps/api`, `packages/shared`, `packages/sdk`, `tests/scenarios`,
  `tests/fixtures`. **Step 8** follows Step 7 (it deploys the API) with bolna-voice-engineer.
- **Step 9** (web-builder, parallel) owns `apps/web` and `docs/screens/` only. It reads `@halyn/shared` (`ws.ts`,
  `api.ts`, `core.ts`) but never edits it: shared-type needs go into its report and the Step 7 agent (or you) adds them.
  Endpoints Step 7 hasn't built yet are mocked in web tests from the shapes in `docs/API.md`.
- Two test suites at once cause the known flakes: verify each commit **after** both agents finish.

## Prompt to paste into the new chat
```text
We're continuing Halyn (Bolna Symphony Buildathon) in a fresh chat (chat #3). Nothing is lost: the repo is the memory.
We are building the WHOLE product end to end, perfectly — no freeze cut, no fallbacks we could avoid, every step in
PROMPTS.md and all 12 scenarios. Work token-lean (docs/HANDOFF.md convention 6): tight subagent briefs, Sonnet for
routine agents, small fixes inline, short status updates.

1. Read docs/HANDOFF.md (follow every convention), then check the real state: `git status`, `git log --oneline -20`,
   `gh run list --limit 3`, IST time, Bolna wallet (get_user_info, cents), `list_violations`.
2. Tell me in ≤ 8 lines what's done, what's pending and today's plan.
3. Day-0 calls (docs/DAY0.md run order): [I approve them today from 09:00 IST, ≤ 20 billed minutes — delete this
   bracket if you want to be asked first]. Tell me exactly when to call A and when to pick up; check 11 comes from the
   probe's `timings_on_request` log. Afterwards: restricted on all agents, list_violations, COMPLIANCE.md log, results
   into STATE.md + DAY0.md, /pull-call fixtures into tests/fixtures/bolna, then delete the probe and its KV/D1.
4. Step 7 (PROMPTS.md): api-builder (Opus) then test-engineer (Sonnet). Include the carry-forwards in STATE.md
   (spoken name सक्षम for customer_name; read Aero Core errors by error.details — E_GRANT_REUSED on Halyn's own retry
   means executed; propose_action ≤ 300 ms with TiDB off the hot path). Done when scenarios 1, 2, 3, 3b, 7, 8, 11, 12
   pass in `pnpm test:scenarios`.
5. In parallel with Step 7: Step 9 with web-builder (Sonnet), owning apps/web only (HANDOFF "Parallel plan").
6. Then Step 8 with bolna-voice-engineer — deploys, agent creation, relinking A and every call need my go-ahead.
7. After each step: verify, code-reviewer (Sonnet), /handoff, show me the commit split (more, smaller commits), and
   after my OK verify each commit (scripts/verify-commits.sh), push, watch CI.
Always: never print secrets, never place calls or change Bolna agents/numbers or deploy without my go-ahead in this
chat, and write my name in any spoken text as सक्षम मिश्रा.
```
