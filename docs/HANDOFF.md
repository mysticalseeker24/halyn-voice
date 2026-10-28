# Handoff — continuing in a new Claude Code chat

Chat #1 (Oct 25–27) built Steps 0–3, 5 and the Day-0 setup. Chat #2 (Oct 27–28) built Step 6 (Aero Core) + its
review fixes, set the secrets, re-seeded `halyn_dev` with the real number, made the Sarvam voice clones (check 8) and
redeployed the Day-0 probe for check 11. Chat #3 (Oct 28) built Steps 7 + 9, switched to speed mode (CLAUDE.md §5)
and ran Day-0 (checks 1–5 pass; Bolna tool-param rules learned; probe deleted). Chat #4 (Oct 28–29) built Steps 8 + 10
and put them live (Devanagari voice prompts, API + Aero Core deployed, Aero/Confirm/Assistant agents on Bolna, Pass +
Assistant web flows; CI green `8b0733e`) with no subagents; its voice smoke (scenarios 1, 2, 3, 5, 6) moved to chat #5. Everything a new chat needs is in the repo: `CLAUDE.md` (auto-loaded) →
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
   keep a chat under ~40 % of the window (`mcp__ccd_session_mgmt__get_usage`); past that, finish the step, `/handoff`,
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


## Prompt to paste into the new chat (chat #5 → chat #4's voice smoke, then Steps 11, 12, 13)
```text
We're continuing Halyn (Bolna Symphony Buildathon) — chat #5. The repo is the memory: CLAUDE.md and docs/STATE.md are
auto-loaded; read docs/HANDOFF.md (conventions 1–15) once. Do not re-read history or whole docs.

WHERE WE ARE: Steps 0–10 are built, pushed and CI-green (8b0733e). Live: API https://halyn-api.halyn-api.workers.dev,
Aero Core (D1 seeded), KV packs (IN + US), TiDB halyn_dev (seeded; pass_demo → number B, valid to ~Nov 27). Bolna: Aero
graph on number A, Halyn Confirm graph (B, speech only, hangs up on Halyn's `recorded` event), Saksham's Assistant (B → A,
bound to a Pass) — all restricted:false, ids in STATE.md. Text scenarios 1–9, 3b, 11, 12 pass (10 waits for Step 12).
NOT done yet: chat #4's voice smoke (1, 2, 3, 5, 6). Web app is not on Vercel (Step 17): run it locally against the
deployed API (HANDOFF convention 14). Files go to KV, not R2 (ADR-023; S3 only if we reach the final round).

HOW WE WORK — SPEED MODE (CLAUDE.md §5, binding, overrides PROMPTS.md and the slash commands):
- You build everything yourself in this chat. NO subagents, ever — even where PROMPTS.md or a command names one
  (api-builder, web-builder, bolna-voice-engineer, call-reviewer, compliance-reviewer: read their .claude/agents/*.md
  only as a checklist).
- Every function working end to end. Test to the feature's weight: light features one happy-path test; heavy/risky
  ones (money, grants, confirmations, Pass, holds/handoffs, multi-module flows) proper tests incl. failure paths and the
  invariant. Full testing + hardening of the whole product happens at the very end (Step 16 + a final pass), not now.
- Read narrowly (grep the section, offset/limit). Quiet commands (| tail, grep). Multi-line scripts in files.
- Commit locally as each piece works (small conventional commits). Before a push: Prettier on changed files, `pnpm verify`
  once, and `pnpm test:e2e` if the web app changed (convention 15); then ask me, `bash scripts/push.sh`, and watch CI
  with convention 13 (exit status kept; report both jobs).
- CONTEXT BUDGET: after each step call mcp__ccd_session_mgmt__get_usage. If context is over ~40 %, finish that step
  (handoff, verify, push) and give me the prompt for the next chat instead of starting the next step.
- Status updates ≤ 5 lines. Never print secrets. My name in any spoken text: सक्षम मिश्रा (screens: Saksham).
- Bolna hard rules unchanged (CLAUDE.md §3): ask me before EVERY real call, agent create/update/delete, number relink,
  deploy, secret change and DB write. Calls only 09:00–21:00 IST. After every agent save: restricted=false. After calls:
  list_violations + docs/COMPLIANCE.md session log. Attacker personas still NOT approved (text mode only).

ORDER:

0. State check in one batch: `git status`, `git log --oneline -3`, `gh run list --limit 1`, IST time, Bolna wallet
   (get_user_info, cents). ≤ 5 lines. Then, with my go-ahead, close a gap found at the end of chat #4: DEMO_ACCESS_CODE is
   unset on the deployed API, so anyone with the URL can open a demo session (and start Assistant calls). Generate a
   random code into .env with a Node script (never print it), add the name to scripts/cf-secrets.ts, put it on the API
   (`cf-secrets.ts api --yes`). I read it from .env myself when the app asks.

1. VOICE SMOKE CARRIED FROM CHAT #4 (09:00–21:00 IST; my go-ahead before each call; ≈ 3–4 ¢/min):
   - Scenario 1: I call A from my phone: card lost, freeze card ending 8812 → allow → Aero says the AERO-… reference.
   - Scenario 2: I call A: waive the ₹600 October late fee (fee_late_oct) → allow.
   - Scenario 3: I call A from a SECOND phone, say I am सक्षम मिश्रा, ask ₹45,000 to a new payee, account ending 4471,
     IFSC AERO0000001 → step_up → the Confirm call rings my registered phone → I say no → deny (C_DECLINED). Inbound calls
     can't carry user_data, so log it as security_demo in COMPLIANCE.md (Bolna was told in advance).
   - Scenarios 5 + 6: write a tiny scripts/bolna/assistant-task.ts (go-ahead per run): POST /web/session (customer,
     x-demo-code from .env) → POST /web/assistant/tasks {task, pass_id: "pass_demo"}; print only the execution id.
     Task: "Get my card statement, move my personal loan EMI to the 10th, then send 45,000 rupees to a new payee,
     account ending 4471, IFSC AERO0000001." Expect statement allow + EMI allow (X_PASS_IN_SCOPE), transfer step_up
     (X_PASS_OUT_OF_SCOPE) → Confirm call → I decline → deny. (Or drive it from the local Assistant app.)
   After each call: save get_execution_raw_logs to scripts/out/ and read it with a small filter script (never paste raw
   logs): tool calls + their bodies' keys, events (allow/done/step_up/approved/denied/recorded), latency, transcript.
   Check the Hindi sounds right (Devanagari) and the Confirm call ends right after my answer. Fix what breaks in
   agents/*.json → agent.ts update (convention 12). Then list_violations, COMPLIANCE.md log, STATE.md scenario table.

2. STEP 11 (PROMPTS.md "Step 11") — coaching, hold, transfer, handoffs. What already exists: keyword coaching + distress
   lexicons (apps/api/src/signals, pure), Gate hold, the handoff row + `handoff` WS message (openHandoff in
   hub/flows.ts), Aero graph `protect` → `transfer_call_specialist` (SPECIALIST_NUMBER). Text scenarios 4 and 9 already
   pass. Build:
   a. Sarvam LLM coaching layer 2 (GATE.md "Signals"): Sarvam chat over caller_quotes → {probability, cues[]} within
      1.5 s; final score = max(layer 1, layer 2); down/slow → layer 1 alone; it may only RAISE (invariant 3/4: coaching
      ≥ threshold → hold, never step-up); the lexicon lives in code, never in a prompt. DESIGN POINT (ADR): the tool must
      still answer within 300 ms (ARCHITECTURE.md "Main flow"), so layer 2 can't sit on that path — e.g. run it in
      waitUntil and let it turn a pending allow/step-up into hold before any grant is signed or Confirm call placed. Mock
      Sarvam only in tests (TESTING.md). SARVAM_API_KEY is already a Worker secret.
   b. The hold path end to end: hold event → protect (speaks by {{reason}}) → transfer; handoff row with transcript ref;
      distress path (scenario 9: P_HUMAN_ONLY + T_DISTRESS → hold, deterministic transfer).
   c. Scheduled check-in call: a record only (who, when, why) — NO call placed unless I approve.
   d. Console Handoffs page (release/block): GET /web/handoffs, POST /web/handoffs/:id/resolve (docs/API.md "Web"),
      console session; approved tier-4 changes become a handoff (STATE.md "Carry").
   Done when: scenarios 4 and 9 pass in text mode (keep them passing with layer 2 on), then voice-smoke 4 with me (I call
   A from my REGISTERED phone as a coached customer: ₹4.8 lakh to a "verification account", "the officer said not to tell
   anyone" → hold → gentle explanation → transfer). Before that call confirm SPECIALIST_NUMBER is a number I own (the
   transfer rings it). Log it as security_demo.

3. STEP 12 (PROMPTS.md "Step 12") — US region. Already done: US pack compiled and in KV (pack:ten_aero:US); prompts/
   aero-agent-en.md (English lines); POST /web/stage/region (Hub stores it). Build:
   a. agents/aero-en.graph.json: same graph as agents/aero.graph.json, English only, USD examples, a US English voice
      (list_voices for en with a small page_size), web only (no number). Create with my go-ahead → restricted=false →
      BOLNA_AERO_EN_AGENT_ID in .env + STATE.md.
   b. Bolna Web Call SDK (`@bolna/web-call` v3.0.1, docs/BOLNA.md "Web calls"; Day-0 check 7 never ran — verify the
      session API with search_docs/get_doc first): API route that mints a single-use session server-side (POST
      https://api.bolna.ai/web-call/session {agent_id, user_data}) for a customer session; the bn- key never reaches the
      browser. "Call Aero" button in the Aero app (region decides the agent). The browser call must carry the app session
      as proof (scenario 10, GATE.md): design how the API ties that web call's run id to the signed-in customer.
   c. Stage region switch wired in the Stage UI.
   No calls to US numbers, ever. Done when: scenario 10 passes in text mode (wire.new $8,000 → hold
   P_HUMAN_ONLY_ABOVE_LIMIT; same request under IN → step_up) and works as a browser call from the local web app (I talk).

4. STEP 13 (PROMPTS.md "Step 13") — Console pages per docs/UI.md: Live, Calls (recording + transcript links),
   Policies (read-only compiled packs + "test this pack" → runs the text scenarios through the existing runner),
   Passes, Signals, Ledger (verify + export — to KV `file:<tenant>:ledger:<id>`, NOT R2, ADR-023), Integrations (agent
   status + restricted flag via Bolna GET agent from the Worker, guard status). Add the API routes each page needs
   (GET /web/calls, /web/calls/:id, /web/policies, ledger export; Step 11 adds handoffs). Component tests + e2e for Ledger
   verify and Pass revoke.

5. End of each step: short /handoff (STATE.md short, WORKLOG ≤ 8 lines, the one doc whose behaviour changed), Prettier,
   `pnpm verify` + `pnpm test:e2e`, ask me to push, `bash scripts/push.sh`, confirm CI (both jobs). When done (or when the
   context budget stops you), write the next chat's prompt into docs/HANDOFF.md and give it to me (Step 14 next).
```
