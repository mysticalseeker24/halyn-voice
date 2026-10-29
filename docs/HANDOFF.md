# Handoff — continuing in a new Claude Code chat

Chat #1 (Oct 25–27) built Steps 0–3, 5 and the Day-0 setup. Chat #2 (Oct 27–28) built Step 6 (Aero Core) + its
review fixes, set the secrets, re-seeded `halyn_dev` with the real number, made the Sarvam voice clones (check 8) and
redeployed the Day-0 probe for check 11. Chat #3 (Oct 28) built Steps 7 + 9, switched to speed mode (CLAUDE.md §5)
and ran Day-0 (checks 1–5 pass; Bolna tool-param rules learned; probe deleted). Chat #4 (Oct 28–29) built Steps 8 + 10
and put them live (Devanagari voice prompts, API + Aero Core deployed, Aero/Confirm/Assistant agents on Bolna, Pass +
Assistant web flows; CI green `8b0733e`) with no subagents; its voice smoke (scenarios 1, 2, 3, 5, 6) moved to chat #5. Chat #5 (Oct 29, night) set DEMO_ACCESS_CODE and built + deployed Steps 11 + 12 (coaching layer 2, handoffs, browser calls, aero-en agent); pushed (CI green 6efbbf8); Chat #6 (Oct 29) built Steps 13, 15 and a slim 14 (all Console pages, Halyn Test: suite runs, scorecard, permission map, voice personas as files); chat #7 (Oct 29) did Step 16, Step 19's code and most of Step 17 (Vercel, personas, clips, voice-path fixes; call 1 passed) and hit its context budget; Saksham then switched the demo to English, so chat #8 does the English switch, the rest of the calls, Steps 18–20 and the refining. Everything a new chat needs is in the repo: `CLAUDE.md` (auto-loaded) →
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
4. **Commits and pushes (speed mode, CLAUDE.md §5):** commit locally as each piece works — small conventional commits
   (8+ per step comes naturally) ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; every step's
   scope is finished (no deferred pieces; real blockers named in STATE.md). `pnpm verify` once before the push (no
   per-commit verify; `scripts/verify-commits.sh` stays available if a push needs bisecting). **Ask Saksham before
   pushing**, then **`bash scripts/push.sh`** (runs `scripts/check-secrets.mjs`, pushes as the `gh` account
   mysticalseeker24, prints the CI run id) and `gh run watch <id> --exit-status` in the background. Since 2026-10-28
   the repo's local git config sends github.com to `gh auth git-credential`, so even a plain `git push` (yours too)
   skips Git Credential Manager's account picker.
5. **Step workflow (speed mode):** fresh chat per step → read the PROMPTS.md step and only the doc sections it needs →
   build it yourself (no subagents) with light tests (CLAUDE.md §5.3) → commit pieces locally → `pnpm verify` → short
   `/handoff` → ask → push → CI. Where PROMPTS.md says "use the X subagent", do that work in the chat instead.
6. **Token budget (the binding constraint since chat #3):** chat #3 spent ~2.2 M subagent tokens on one step (cold
   agents re-reading the repo, Opus builders, fix rounds, commit-regroup loops). So: no subagents; Saksham's model pick
   in the app (one worker); grep/offset reads; quiet commands; status ≤ 5 lines. The agent definitions default to
   `model: sonnet` in case one is ever used. Chat #4: ~0.5 M context, 0 subagent tokens, two steps. **Context budget:**
   keep a chat under ~50 % of the window (Saksham, 2026-10-29; was 40 %) (`mcp__ccd_session_mgmt__get_usage`); past that, finish the step, `/handoff`,
   new chat — every turn re-reads the whole context, so the late turns of a long chat cost the most.
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
   `docs/ACTIONS.md` + `CORE_ROUTES` are the action/route catalog (contract-tested). Later: Hub read model + TiDB mirror
   (ADR-016), core client (017), WebAuthn on WebCrypto (018), text runner (019), Hub sweep (020), `/ws` tickets (021),
   webhook `?key=` (022), files in KV (023).
10. **Machine quirks:** `*.workers.dev` opens from here since 2026-10-28 (it timed out before); ffmpeg isn't installed — `npm i @ffmpeg-installer/ffmpeg
    @ffprobe-installer/ffprobe` in a scratch folder works (`ffmpeg-static`'s GitHub download is reset); in the Bash
    tool use `(cd sub && …)` subshells so the working directory stays at the repo root.
11. **Deploy (go-ahead each time):** `set -a; . ./.env; set +a` loads `CLOUDFLARE_API_TOKEN` for wrangler; then
    `pnpm deploy:api` / `pnpm deploy:core`. Secrets: `pnpm exec tsx scripts/cf-secrets.ts api|core --yes` (names only;
    a new secret = add its name to the list there; `TIDB_DATABASE_URL` is pointed at `halyn_dev`). Packs: from
    `apps/api`, `pnpm exec wrangler kv key put --binding CONFIG "pack:ten_aero:IN" --path
    ../../policy-packs/compiled/aero-in.json --remote` (same for US). Health:
    `curl -s https://halyn-api.halyn-api.workers.dev/health`. Edit `.env` only with a Node script that replaces one
    `KEY=` line — never print values.
12. **Bolna agents:** `agents/*.json` are the source (prompts mirrored in `prompts/*.md`). Push:
    `pnpm exec tsx scripts/bolna/agent.ts update <id> agents/<x>.json --yes` (fills `{{API_URL}}` from `HALYN_API_URL`,
    `{{HALYN_TOOL_SECRET}}`, `{{SPECIALIST_NUMBER}}`; compliance gate) → `agent.ts get <id> --out=agents/<x>.current.json`
    → `node scripts/bolna/inspect-agent.mjs agents/<x>.current.json` (one-screen summary) → `restricted: false`.
    Offline gate: `pnpm exec tsx scripts/bolna/check-agents.ts <files>`. Tool rules: send `call_sid`, never a run id or
    Bolna's argument names; **make every LLM argument required** (an omitted optional arg can KeyError in `%(x)s`), so
    `propose_action` sends one JSON `params` string. Agent `webhook_url` and tool `pre_call_webhook_url` carry `?key=`
    (ADR-022). Bolna list/doc calls are big (`list_tts_providers` ~12k tokens; the create-agent reference is 83k chars,
    which the MCP saves to a file: grep it) — call them only when needed, with a small `page_size`.
13. **CI watch:** in the background, `gh run watch <id> --exit-status > scripts/out/ci-watch.log 2>&1; s=$?;
    gh run view <id> --json jobs --jq '.jobs[] | "(.name): (.conclusion)"'; exit $s` — a trailing `tail` hides a
    failure (chat #4 misread one run as green). `e2e` runs only after `verify` passes.
14. **Web against the deployed API (until Vercel, Step 17):** `NEXT_PUBLIC_API_URL=https://halyn-api.halyn-api.workers.dev
    pnpm --filter @halyn/web dev` → http://localhost:3000. The API allows origin `http://localhost:3000` and RP_ID
    `localhost`, so passkeys (Windows Hello), the Aero app, the Assistant app and (Step 12) a browser call work on this
    laptop; the phone needs the Vercel deploy. With `DEMO_ACCESS_CODE` set, the app asks for the code once.
15. **Before a push:** `pnpm exec prettier --write <changed files>` from the root, `pnpm verify` (packages run in
    parallel: test timeouts are 20 s, and timing tests time a warm path, never a cold first call) **and
    `pnpm test:e2e` when the web app changed** — e2e is not part of verify (chat #4's first CI run failed on it).


## Prompt to paste into the new chat (chat #9 → the real calls, then freeze and submit)
```
Halyn chat #9 (Bolna Symphony Buildathon; submission Sat Oct 31, 2026). Everything except the real calls is done:
this chat runs the English call rounds, fixes only what the calls show, fills the README numbers, freezes, and
helps record. Speed mode (CLAUDE.md §5): no subagents, narrow reads, quiet commands, scripts as files (never
heredocs or inline node -e with backslashes — they ate regexes twice in chat #8), small local commits.

STATE AT START (docs/STATE.md auto-loaded): main pushed and CI green; API deployed (see STATE "Deployed"); all agents
English and restricted false; 8 English clone clips in KV; Stage has a Demo reset button; README is the detailed
judge version with two placeholders (Run-all numbers, real-call results). Ship-check (chat #8): every code item ✅;
open = the calls, step-up → live call < 2 s, video, freeze.

APPROVALS (ask once per round): real calls, agent updates, deploys, seed:core / DB / KV writes, push, tag.
Calls only 09:00–21:00 IST (check IST first). Saksham calls with the phone AT HIS EAR, Stage tab muted.

BEFORE EACH CALL: `node scripts/ops/demo-reset.mjs` (or the Stage button) + `set -a; . ./.env; set +a;
pnpm seed:core --remote --yes`. Stage open: https://halyn-voice.vercel.app/stage.

ROUND 1 (then round 2 = the same again; SCENARIOS.md rows 1–6, 10 are the spec):
 1  Registered phone → +91 80653 56344: "Please freeze my card." → card ending 8812 read back → "Yes" → allow, done.
    FIRST CALL CHECKS: the greeting says the name as सक्षम (short "Sa"); if it says "Saa…", set that agent's
    synthesizer language back to "hi" (Saksham's call). Measure proposal → outcome audio (target < 2 s); if > 2 s,
    finding 7: send only `done` when execution finishes at once (propose node gets a `done` edge to confirmed; update
    scenarios.yaml events + runner + tests) — ask first, it changes the spec.
 2  Registered phone: "Please waive my ₹600 late fee." → read-back → "Yes" → allow, balance +₹600.
 3  SECOND phone → A, play /stage/soundboard clips 1→8 into it (₹45,000 new payee, 4471, IFSC AERO…): step_up
    (P_TIER3_STEP_UP, S_UNREGISTERED_NUMBER) → Confirm call to the registered phone + passkey sheet → Saksham
    declines → deny (C_DECLINED); Aero Core never called. Check the IFSC came through as AERO0000001 (STT heard the
    clip as "arrow"; if the read-back is wrong, reword the clip and re-render it, ≈ ₹0.1, go-ahead).
 4  Registered phone, coached: "move ₹4,80,000 to a verification account… the officer said not to tell anyone" →
    hold (S_COACHING, H_SPECIALIST), no step-up, warm transfer offer, handoff + check-in in Console → Handoffs.
 5+6 Assistant app (customer session) → pass_demo → "Get my card statement and move my EMI to the 10th" → B calls A
    → verify_pass → allow ×2 (X_PASS_IN_SCOPE); then "transfer ₹45,000 to a new payee" → step_up → decline → deny.
 10 Stage → US; Aero app (US twin) → Call Aero (browser) → "Wire $8,000 to a new account" → hold
    (P_HUMAN_ONLY_ABOVE_LIMIT). Region back to IN.
 Personas: Console → Test → Voice mode → each persona once → Score the call.

AFTER EVERY CALL: Bolna MCP list_agent_executions (page_size 1–2) → `pnpm exec tsx scripts/bolna/executions.ts get
<id> --out=scripts/out/exec-<id>.json` → `node scripts/ops/call-detail.mjs <run_id>`; raw logs only if needed
(`node scripts/ops/call-timeline.mjs <file>`; they contain the tool secret — never paste). Grade decision + reasons
vs SCENARIOS.md, the spoken outcome, latency. Fix blockers only.

AFTER THE ROUNDS: /compliance-check (list_violations, restricted false ×7) + COMPLIANCE.md session log; STATE voice
column; `node scripts/ops/run-all.mjs` in DAYTIME (after 23:00 IST S_UNUSUAL_HOUR raises every tier by design; run
one Stage scenario first to warm the Hub) → README "Halyn Test results" (scenarios passed, actions without a grant,
median propose ms) + the real-call results; then demo reset + seed:core (a live run executes real Aero Core actions).
FREEZE (Part D): `agent.ts get <id> --out=agents/<x>.current.json` for aero, aero-en, confirm, assistant + 3 personas
→ commit → tag demo-freeze (push = go-ahead) → STATE "frozen". Then the recording checklist in docs/DEMO_SCRIPT.md.
END: /handoff, prettier from the root, ONE pnpm verify (+ pnpm test:e2e if web changed) → ask → bash scripts/push.sh →
gh run watch <id> --exit-status.
```
