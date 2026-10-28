# Handoff — continuing in a new Claude Code chat

Chat #1 (Oct 25–27) built Steps 0–3, 5 and the Day-0 setup. Chat #2 (Oct 27–28) built Step 6 (Aero Core) + its
review fixes, set the secrets, re-seeded `halyn_dev` with the real number, made the Sarvam voice clones (check 8) and
redeployed the Day-0 probe for check 11. Chat #3 (Oct 28) built Steps 7 + 9, switched to speed mode (CLAUDE.md §5)
and ran Day-0 (checks 1–5 pass; Bolna tool-param rules learned; probe deleted). Chat #4 (Oct 28–29) built Steps 8 + 10
and put them live (Devanagari voice prompts, API + Aero Core deployed, Aero/Confirm/Assistant agents on Bolna, Pass +
Assistant web flows; CI green `8b0733e`) with no subagents; its voice smoke (scenarios 1, 2, 3, 5, 6) moved to chat #5. Chat #5 (Oct 29, night) set DEMO_ACCESS_CODE and built + deployed Steps 11 + 12 (coaching layer 2, handoffs, browser calls, aero-en agent); pushed (CI green 6efbbf8); chat #6 does Steps 13–15 and the voice smoke waits until Saksham asks. Everything a new chat needs is in the repo: `CLAUDE.md` (auto-loaded) →
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


## Prompt to paste into the new chat (chat #6 → Steps 13, 14, 15)
```text
We're continuing Halyn (Bolna Symphony Buildathon) — chat #6. The repo is the memory: CLAUDE.md and docs/STATE.md are
auto-loaded; read docs/HANDOFF.md (conventions 1–15) once. Do not re-read history or whole docs.

WHERE WE ARE: Steps 0–12 are built, deployed (API dee65a7f) and pushed, CI green (6efbbf8; one local doc commit may be
waiting — push it with the next push). Live: API https://halyn-api.halyn-api.workers.dev (DEMO_ACCESS_CODE set; read it
from .env), Aero Core (D1 seeded), KV packs IN + US, TiDB halyn_dev. Bolna: Aero graph (Hindi) on number A, Halyn
Confirm graph (B), Saksham's Assistant (B → A), aero-en (f281278d…, English, web only) — all restricted:false.
Step 11: Sarvam coaching layer 2 after the 300 ms answer (ADR-024 `screening` + pure `escalateForCoaching`), Hub
handoff records + booked check-in (record only), GET /web/handoffs + POST /web/handoffs/:id/resolve, Console shell +
/console/handoffs. Step 12: POST /web/calls/session (mint + register the run → proof app_session), Aero "Call Aero"
(@bolna/web-call 3.0.1). All 13 text scenarios pass (1–12 + 3b) with layer 2 on; no voice scenario has run yet.

HOW WE WORK — SPEED MODE (CLAUDE.md §5, binding; overrides PROMPTS.md and the slash commands):
- You build everything yourself in this chat. NO subagents, ever — where PROMPTS.md says "use the test-engineer /
  api-builder / web-builder subagent", do that work here and read .claude/agents/<name>.md only as a checklist.
- Every function working end to end. Test to the feature's weight: light features one happy-path test; heavy/risky
  ones (anything touching grants, money, confirmations, Pass, holds, the runner's verdicts) proper tests incl. failure
  paths and the invariant. Full hardening still happens at the very end (Step 16 + a final pass).
- Read narrowly (grep the heading, offset/limit). Quiet commands (| tail, grep). Multi-line scripts go in files
  (scratchpad or scripts/out); heredocs with backticks break — write files with the Write tool.
- Commit locally as each piece works (small conventional commits). Before a push: Prettier on changed files,
  `pnpm verify` once, `pnpm test:e2e` when the web app changed (convention 15), then ask me, `bash scripts/push.sh`,
  watch CI with convention 13 (keep the exit status; report both jobs). A transient Windows "UNKNOWN: unknown error,
  open …node_modules…" in verify is not a test failure: re-run once.
- CONTEXT BUDGET: after each step call mcp__ccd_session_mgmt__get_usage. Up to ~50 % is fine (raised from 40 % on
  2026-10-29). Past ~50 %: finish the current step (handoff, verify, push), then give me the next chat's prompt
  instead of starting another step.
- Status updates ≤ 5 lines. Never print secrets (the Bolna MCP get_agent prints the tool secret — snapshot agents with
  `pnpm exec tsx scripts/bolna/agent.ts get <id> --out=agents/<x>.current.json` instead). My name in spoken text:
  सक्षम मिश्रा (screens: Saksham).
- Bolna hard rules unchanged (CLAUDE.md §3): ask me before EVERY real call, agent create/update/delete, number relink,
  deploy, secret change and DB write. Calls only 09:00–21:00 IST. After every agent save: restricted=false. After any
  calls: list_violations + docs/COMPLIANCE.md session log. Attacker personas still NOT approved (text mode only).

ORDER:

0. State check in one batch: `git status --short`, `git log --oneline -3`, `git log --oneline origin/main..HEAD`,
   `gh run list --limit 1`, IST time, Bolna wallet (get_user_info, cents). ≤ 5 lines.

1. STEP 13 — Console pages (PROMPTS.md "Step 13", docs/UI.md "Halyn Console": Live, Calls, Policies, Passes, Signals,
   Ledger, Handoffs, Integrations). What exists: apps/web/src/components/console/console-shell.tsx (nav CONSOLE_PAGES,
   console demo session via useDemoSession({kind:'console'}), loading / demo-code / error states) and the Handoffs page
   (/console/handoffs, handoffs-view.tsx + test + e2e/console.spec.ts). Live data comes from the Hub WebSocket
   (lib/hub/use-hub.ts, ticket role 'console'); REST for the rest. Console API routes check `session.kind === 'console'`
   (see apps/api/src/web/handoffs.ts) and read the Hub's read model, never TiDB on a hot path. Halyn style: ink on
   off-white, one indigo accent, outcome badges always with the word (OutcomeBadge: ALLOWED / STEP-UP / HELD / DENIED);
   every page has loading, empty and error states. Build, one page at a time, each with its API route + a component test:
   a. Live (/console): the Hub stream for role 'console' — decisions (request, tier, signals, badge), handoffs,
      call_update transcripts — newest first, capped list. Check which WS message types reach 'console' (docs/API.md
      "WebSocket") and add the role where a message the page needs only goes to 'stage'.
   b. Calls (/console/calls, /console/calls/[id]): GET /web/calls (Hub calls table: run id, channel phone/web, region,
      customer, started/ended, purpose, count of requests) and GET /web/calls/:id (the call, its requests with
      decision + final outcome + reasons + coaching cues, the handoff if any, the transcript from Bolna
      getExecution — numbers masked — and the recording link). The recording URL currently reaches only the TiDB
      mirror (recordExecution): keep it on the Hub's call state too.
   c. Policies (/console/policies): GET /web/policies → the compiled packs from KV (pack:<tenant>:IN / :US), read-only
      (actions with tier, perimeter, limits, Pass eligibility; signals and weights; coaching threshold; confirm
      channels/timeout; source sha). "Test this pack" runs that region's text scenarios through the existing runner
      (for now: POST /web/stage/run/:scenario per scenario of that region; Step 15 switches it to POST /web/tests/runs).
   d. Passes (/console/passes): every Pass in the tenant (status, assistant, scopes with uses, expiry) with Revoke.
      GET /web/passes and DELETE /web/passes/:id are customer-scoped today: add console variants (tenant-wide list;
      revoke any) — the ledger records who revoked. e2e: Pass revoke.
   e. Signals (/console/signals): GET /web/signals → counts per signal / reason code over recent requests, and the
      latest requests that fired signals or coaching cues (layer-1 ids and `llm_` ids; never the caller's words).
   f. Ledger (/console/ledger): list (GET /web/ledger), verify (GET /web/ledger/verify, "chain verified" or the first
      bad seq), export: GET /web/ledger/export writes the full chain to KV `file:<tenant>:ledger:<id>` (ADR-023, NOT
      R2) and returns {file_id, entries, head_hash}; a second route streams that file for download. e2e: Ledger verify.
   g. Integrations (/console/integrations): GET /web/integrations → each Bolna agent id in env (BOLNA_AERO_AGENT_ID,
      BOLNA_AERO_EN_AGENT_ID, BOLNA_CONFIRM_AGENT_ID, BOLNA_ASSISTANT_AGENT_ID) via the Worker's Bolna client GET agent:
      name, status, restricted flag, webhook host only (strip `?key=` and every header — never return a secret); guard
      status (Bolna IP allowlist on, HALYN_TOOL_SECRET present: booleans), Sarvam key present, Aero Core /health, Hub
      mirror backlog. Mock Bolna in tests.
   Update docs/API.md "Web" for every new route, docs/UI.md only if the page list changes. Done when: every page loads
   against the mocked API in component tests, e2e Ledger verify + Pass revoke pass, and the pages work locally against
   the deployed API (convention 14) after a deploy (ask me first).

2. STEP 14 — Scenario suite 12/12 (+3b), rules, coverage, security tests (PROMPTS.md "Step 14"; do it yourself,
   .claude/agents/test-engineer.md as the checklist). What exists: apps/api/src/test-runner/runner.ts (`rules(run)`),
   apps/api/test/scenarios/runner.test.ts (all 13 pass, none pending), runner unit tests ("reports every way Halyn can
   be wrong"), adversarial/fuzz suites (gate, pass, lexicon, webauthn, sdk verify-grant, shared crypto/ledger/mask),
   tenant-isolation and guard tests, coverage thresholds in each vitest.config.ts.
   a. docs/SCENARIOS.md "Rules every scenario also checks" — for each of the five rules (chain verifies + causal order;
      no Aero Core write without a grant whose params_hash matches; the agent-facing event matches the decision, then
      done/approved/denied/timeout; propose_action < 300 ms; no unmasked phone/account number in any log line) confirm
      `rules()` checks it in every scenario, and add a runner unit test that makes each rule FAIL on purpose (a fake
      harness that breaks exactly that rule). Fix any rule that is missing or weaker than the doc.
   b. Coverage: run each package's unit + int with coverage and report the numbers. Thresholds (docs/TESTING.md):
      ≥ 95 % lines and branches for packages/shared, packages/sdk, apps/api/src/{gate,pass,ledger,grants}, Aero Core's
      grant check + commit; ≥ 60 % elsewhere. Close the gaps, starting with Steps 11–13 code (signals/coaching-llm,
      hub finishScreening / resolveHandoff / registerWebCall, web routes, console views, call-aero).
   c. Security tests (docs/TESTING.md "Security" row): tampered grant, wrong params hash, replayed jti, expired grant,
      wrong IP, missing secret, replayed Pass code, code from the wrong number, cross-tenant read. Map each to the test
      that proves it today; add `*.security.test.ts` for any that is missing, plus the newer surfaces: demo code
      required for /web/session, console-only routes refuse customer sessions (and vice versa for /web/calls/session),
      a screening request refuses passkey and callback answers, a second handoff resolution is refused.
   d. Update the invariant map in docs/TESTING.md if a test moved or was added. Report counts: tests per package,
      scenarios, coverage per threshold group, security cases.

3. STEP 15 — Halyn Test page + permission map (PROMPTS.md "Step 15"; api-builder / web-builder only as checklists).
   What exists: the text runner (runner.ts), the live harness (test-runner/live.ts, used by POST /web/stage/run/:scenario,
   Bolna replaced by a recorder, `test_progress` WS messages), TiDB tables test_runs + test_results (docs/DATA_MODEL.md),
   docs/API.md rows POST /web/tests/runs · GET /web/tests/runs/:id · GET /web/tests/permission-map (not built yet).
   a. API: POST /web/tests/runs {suite:'text', region?} (console) → {test_run_id}; runs the 13 scenarios (or the
      region's) and records each result. DESIGN POINT: a Worker's waitUntil has ~30 s and 3b needs a 60 s timeout —
      either drive scenario by scenario (one request each, as the Stage does; live mode reports 3b's wait as skipped)
      or step the suite from the Hub alarm. Pick one, record a ≤ 5-line ADR. Progress over `test_progress` to 'console'
      too. Live runs touch the demo customer's real Aero Core rows (demo reset, STATE "Carry") — say how the run avoids
      or resets that.
   b. Scorecard per run: actions without a grant (must be 0: Aero Core writes without a valid grant), attacks stopped
      (attack scenarios: 3, 3b, 4, 6, 7, 8, 11 and the attack steps of others — denied / held / refused without
      execution), tasks completed (benign scenarios that reached done / executed), median propose_action reply (ms), plus
      pass/fail per scenario with failures and skips. GET /web/tests/runs/:id returns it; store run + results
      (Hub or KV for reads; mirror to TiDB test_runs/test_results; DB write = my go-ahead if it needs a migration).
   c. Run-to-run comparison: this run vs the previous one — per scenario pass → fail / fail → pass, metric deltas.
   d. Permission map: GET /web/tests/permission-map → built from the Aero agent's graph JSON (agents/aero.graph.json and
      aero-en, bundled at build like the packs — never parsed from YAML at runtime): every path from the start node
      that reaches the node calling propose_action, and for every outcome node (working, awaiting_confirmation,
      protect, confirmed, refused) the edges that lead into it. GREEN when every edge into an outcome node is an
      `event` edge (allow / step_up / hold / deny / done / approved / denied / timeout); RED with the offending path if
      any outcome node is reachable through an LLM-condition edge. Pure function + unit tests (the real graphs are
      green; a graph with an LLM edge into `working` is red; a cycle terminates).
   e. Web: /console/test — Run button (text suite, region), live progress, scorecard tiles (word + number), per-scenario
      table, comparison with the previous run, permission map (paths with GREEN / RED labels, never colour alone).
      Component tests; e2e: run the suite against the mocked API and see the scorecard.
   f. Voice mode: benign personas from prompts/personas/README.md only (test-polite-hindi, test-hinglish-noisy,
      test-impatient-en: B → A, call_terminate 120, guardrails 9–21), each agent create and each call with my go-ahead,
      09:00–21:00 IST. Attacker personas ONLY if docs/STATE.md says Bolna approved (it does not).
   Done when: a Console text run shows 13/13 with the scorecard and the comparison, and the permission map is GREEN for
   both Aero graphs.

4. End of each step: short /handoff (STATE.md short, WORKLOG ≤ 8 lines, the one doc whose behaviour changed),
   Prettier, `pnpm verify` + `pnpm test:e2e`, ask me to push, `bash scripts/push.sh`, confirm CI (both jobs). A deploy
   of the API or Aero Core = ask me first. When done (or when the 50 % budget stops you), write the next chat's prompt
   into docs/HANDOFF.md and give it to me (Step 16 next).

CARRIED (only when I ask; 09:00–21:00 IST; go-ahead per call; ≈ 3–4 ¢/min): voice smoke 1 (freeze card 8812),
2 (waive the ₹600 fee), 3 (second phone, ₹45,000 new payee 4471 / AERO0000001 → step_up → Confirm → I decline),
5 + 6 (scripts/bolna/assistant-task.ts → statement, EMI to the 10th, ₹45,000 transfer → step_up → decline),
4 (coached customer from my registered phone → hold → transfer; confirm SPECIALIST_NUMBER is mine first), and the
browser call for scenario 10 (Stage region US → /aero "Call Aero" → $8,000 wire → hold). After each call: raw logs to
scripts/out/ + a filter script; list_violations + COMPLIANCE.md log; 3 and 4 are security_demo.
```
