# Handoff — continuing in a new Claude Code chat

Chat #1 (Oct 25–27) built Steps 0–3, 5 and the Day-0 setup. Chat #2 (Oct 27–28) built Step 6 (Aero Core) + its
review fixes, set the secrets, re-seeded `halyn_dev` with the real number, made the Sarvam voice clones (check 8) and
redeployed the Day-0 probe for check 11. Chat #3 (Oct 28) built Steps 7 + 9, switched to speed mode (CLAUDE.md §5)
and ran Day-0 (checks 1–5 pass; Bolna tool-param rules learned; probe deleted). Everything a new chat needs is in the repo: `CLAUDE.md` (auto-loaded) →
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
   agents re-reading the repo, Opus builders, fix rounds, commit-regroup loops). So: no subagents; Sonnet as the chat
   model (Opus only for a hard bug); grep/offset reads; quiet commands; status ≤ 5 lines. The agent definitions default
   to `model: sonnet` in case one is ever used.
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


## Prompt to paste into the new chat (chat #4 → Step 8, then Step 10)
```text
We're continuing Halyn (Bolna Symphony Buildathon) — chat #4. The repo is the memory: CLAUDE.md and docs/STATE.md are
auto-loaded; read docs/HANDOFF.md (conventions) once. Do not re-read history or whole docs.

WHERE WE ARE: Steps 0–3, 5, 6, 7 and 9 are built and pushed (CI green); Day-0 (Step 4) is closed. Step 7 = the Bolna
tools, Confirm (passkey + callback), passkeys, web routes, text-mode runner (scenarios 1–9, 3b, 11, 12 pass; 10 waits
for Step 12). Step 9 = Aero app + Stage v1. Nothing is deployed yet. Number A still points to the Day-0 Aero test
agent whose tools are dead (probe deleted) — Step 8 relinks it.

HOW WE WORK — SPEED MODE (CLAUDE.md §5, binding, overrides PROMPTS.md and the slash commands):
- You build everything yourself in this chat. NO subagents, ever — even where PROMPTS.md or a command names one
  (bolna-voice-engineer, api-builder, web-builder, call-reviewer, compliance-reviewer: read their .claude/agents/*.md
  only as a checklist).
- Every function working end to end. Test to the feature's weight: light features one happy-path test; heavy/risky
  ones (money, grants, confirmations, Pass, multi-module flows) proper tests incl. failure paths and the invariant.
  Full testing + hardening of the whole product happens at the very end (Step 16 + a final pass), not now.
- Read narrowly (grep the section, offset/limit). Quiet commands (| tail, grep). Multi-line scripts in files.
- Commit locally as each piece works (small conventional commits). `pnpm verify` once before a push, then ask me,
  then `bash scripts/push.sh` and `gh run watch <id> --exit-status` in the background. No commit regrouping.
- Status updates ≤ 5 lines. Never print secrets. My name in any spoken text: सक्षम मिश्रा (screens: Saksham).
- Bolna hard rules unchanged (CLAUDE.md §3): ask me before EVERY real call, agent create/update/delete, number relink,
  deploy and DB write. Calls only 09:00–21:00 IST. After every agent save: restricted=false. After calls:
  list_violations + docs/COMPLIANCE.md session log.

ORDER (it may be night when you start — do all non-call work first, calls in the morning window):

1. State check in one command batch: `git status`, `git log --oneline -3`, `gh run list --limit 1`, IST time, Bolna
   wallet (get_user_info, cents). Tell me in ≤ 5 lines.

2. STEP 8 (PROMPTS.md "Step 8"), with these Day-0 overrides (STATE.md "Bolna facts learned on Day-0", docs/BOLNA.md):
   a. VOICE FIRST — Saksham found the agents slow, robotic, with wrong Hindi. Rewrite prompts/aero-agent.md,
      prompts/aero-agent-en.md and prompts/confirm-agent.md so every Hindi word a voice speaks is in Devanagari
      (English words in Latin), greetings short and warm (still disclose AI + recording). Then render 2–3 short sample
      lines through Sarvam bulbul:v3 directly (Sarvam API from .env — no Bolna cost) with 2–3 speaker/pace options and
      send them to me (SendUserFile) to pick from. Also set endpointing lower than 500 ms.
   b. With my go-ahead: `pnpm db:migrate` + `pnpm seed` on halyn_dev; create KV CONFIG + R2 halyn-files + remote D1
      aero-core; deploy Aero Core (`pnpm deploy:core`, `pnpm seed:core` remote) and the API (`pnpm deploy:api`) with
      the secrets/bindings listed in STATE.md next steps; upload compiled packs to KV (`pack:<tenant>:<region>`).
      This machine can't open *.workers.dev — check health via the Cloudflare API / `wrangler tail`, or I check on my
      phone (mobile data).
   c. With my go-ahead: create the Aero graph agent (Hindi, number A) and the Halyn Confirm agent (outbound, number B,
      guardrails 9–21) from the new prompts + docs/BOLNA.md: tools send call_sid (never a run id; never argument names
      run_id/method/url/headers/param), confirm_result sends only answer + request_id + call_sid, webhook_url =
      <API>/webhooks/bolna on BOTH agents, x-halyn-secret header, the node that speaks the reference is an LLM node
      reading the `done` event, event edges incl. `working` deny→refused and `awaiting_confirmation` hold→protect,
      DTMF OFF (Vobiz can't do keypad — PROMPTS.md's "keypad input" is superseded), Confirm ends the call right after
      the answer. get_agent → restricted=false. Save agent JSON (no secrets) to agents/, ids to STATE.md and .env
      (BOLNA_*_AGENT_ID). Relink number A to the Aero agent (old Kavach listener stays unlinked, not deleted).
   d. MORNING, with my go-ahead: voice-smoke scenarios 1, 2, 3 with me (I call A; scenario 3 carries
      user_data.purpose = "security_demo"). Read calls with the Bolna MCP raw logs saved to file + a small filter
      script (never paste raw logs). Then list_violations + COMPLIANCE.md log, update STATE.md scenario table.

3. STEP 10 (PROMPTS.md "Step 10") — can be built while waiting for the morning:
   Pass issue/revoke/list (/web/passes) with passkey consent (docs/PASS.md, docs/API.md), the Aero app "Authorise an
   assistant" screen, the Assistant app (task box, boarding-pass card, live transcript) and /web/assistant/tasks which
   starts the Assistant agent's outbound call (number B → A). With my go-ahead, create the Assistant agent from
   prompts/assistant-agent.md (same Day-0 tool rules: get_pass_code sends pass_token + call_sid, no run id; Devanagari
   for Hindi; webhook_url = /webhooks/bolna). Done when scenarios 5 and 6 pass in `pnpm test:scenarios`, then
   voice-smoke 5 and 6 with me in the calling window.

4. At the end of each step: short /handoff (STATE.md short, WORKLOG ≤ 8 lines), `pnpm verify`, ask me to push,
   `bash scripts/push.sh`, confirm CI. When both steps are done, give me the prompt for chat #5 (Step 11).
```
