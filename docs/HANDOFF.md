# Handoff — continuing in a new Claude Code chat

Chat #1 (Oct 25–27) built Steps 0–3, 5 and the Day-0 setup. Chat #2 (Oct 27–28) built Step 6 (Aero Core) + its
review fixes, set the secrets, re-seeded `halyn_dev` with the real number, made the Sarvam voice clones (check 8) and
redeployed the Day-0 probe for check 11. Chat #3 (Oct 28) built Steps 7 + 9, switched to speed mode (CLAUDE.md §5)
and ran Day-0 (checks 1–5 pass; Bolna tool-param rules learned; probe deleted). Chat #4 (Oct 28–29) built Steps 8 + 10
and put them live (Devanagari voice prompts, API + Aero Core deployed, Aero/Confirm/Assistant agents on Bolna, Pass +
Assistant web flows; CI green `8b0733e`) with no subagents; its voice smoke (scenarios 1, 2, 3, 5, 6) moved to chat #5. Chat #5 (Oct 29, night) set DEMO_ACCESS_CODE and built + deployed Steps 11 + 12 (coaching layer 2, handoffs, browser calls, aero-en agent); pushed (CI green 6efbbf8); Chat #6 (Oct 29) built Steps 13, 15 and a slim 14 (all Console pages, Halyn Test: suite runs, scorecard, permission map, voice personas as files); chat #7 does Steps 16–19 (review + hardening, Vercel + the real calls, freeze, recording support); chat #8 does Step 20 and all refining. Everything a new chat needs is in the repo: `CLAUDE.md` (auto-loaded) →
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


## Prompt to paste into the new chat (chat #7 → Steps 16, 17, 18, 19 + the real calls)

```
Halyn chat #7 (Bolna Symphony Buildathon). Do Steps 16, 17, 18 and 19 of PROMPTS.md, plus the real calls that are
still waiting (voice smoke, the browser call, the three test persona agents). Chat #8 = Step 20 + all refining.

ALREADY DONE — do not redo: Steps 0–15 + slim 14 on main (CI green 5e88fb1); API deployed e2eec772 (Steps 13–15
live), Aero Core deployed, KV packs, TiDB halyn_dev migrated + seeded, Aero graph on number A, Confirm + Assistant +
aero-en agents on Bolna (restricted false). Text scenarios 13/13. The demo environment IS this deployment
(*.workers.dev + halyn_dev) plus Vercel for the web — no second environment. Two local docs commits (STATE + this
prompt) go out with the first push.

READ: CLAUDE.md + docs/STATE.md are loaded; docs/HANDOFF.md lines 19–86 (conventions); PROMPTS.md Steps 16–19 (grep
"### Step 1"); docs/DEMO_SCRIPT.md scenario 3 only for Step 19. Nothing else whole.
HOW (speed-mode rules): build and test yourself, no subagents (.claude/agents/*.md = checklists; "the test-engineer"
= you write the test); narrow reads; quiet commands; multi-line scripts in files (Write tool, not heredocs or inline
backticks); small local commits; status ≤ 5 lines; context budget ~50 % (get_usage after each step). If it runs out:
stop after a finished step, verify, push, write the chat #8 prompt.
APPROVALS: every call, agent create/update, deploy, DB/KV write, secret change, push and tag = my go-ahead in this chat.
Calls only 09:00–21:00 IST (check IST first). If we are outside the window, do the code work first.

STEP 16 — review + hardening (code only, no calls)
- /review over the WHOLE codebase (not the diff). For each finding: failing test first, then the fix. Fix blockers and
  high-severity findings now; put everything else in a "Chat #8 findings" list in docs/STATE.md (chat #8 refines).
- Performance: propose_action p95 < 300 ms on the warm path (a timing test, 50 calls) and Worker CPU < 10 ms (wrangler
  tail --format json on the deployed API during one Stage text run; read cpuTime).
- Fail-closed drill (in tests): the API/Hub/Aero Core dies mid-call after propose → deny E_FAIL_CLOSED, a polite
  event, nothing executed; check_decision while the Hub is down.
- Log-masking audit (every log site; no full phone/account number anywhere), secrets scan over all history
  (scripts/check-secrets.mjs + the CI patterns), `pnpm audit --prod` (fix high/critical or record why not).
- Docs: one line where behaviour changed. Then ONE verify (+ e2e if web changed) → ask → push.sh → CI both jobs.

STEP 17 — demo environment
17a. Vercel. First check the exact build locally from the root: `pnpm turbo run build --filter=@halyn/web` (fix
     anything before I click). Then walk me through, in this order, and wait for me at each step:
     1. vercel.com → Add New → Project → Import Git Repository → mysticalseeker24/halyn-voice (install the Vercel
        GitHub app for this one repository only).
     2. Import the WHOLE repository (it is a pnpm monorepo: the web needs packages/shared and the root pnpm-lock.yaml).
        Root Directory = apps/web; keep "Include files outside the Root Directory" ON.
     3. Framework preset Next.js. Build Command (override) `cd ../.. && pnpm turbo run build --filter=@halyn/web`
        (builds @halyn/shared first). Install Command: default (pnpm install). Output Directory: default.
     4. Settings → Node.js version 22.x (root engines: >=22.12).
     5. Environment variables (Production and Preview): NEXT_PUBLIC_API_URL = https://halyn-api.halyn-api.workers.dev
        and ENABLE_EXPERIMENTAL_COREPACK = 1 (Vercel then uses pnpm@12.15.0 from packageManager). Nothing secret goes
        to Vercel: the Bolna key, tool secret and DEMO_ACCESS_CODE stay on the API.
     6. Deploy; I tell you the production domain (e.g. halyn-voice.vercel.app). Production branch = main: every push
        to main redeploys the web from now on (preview URLs are not in WEB_ORIGIN, so they cannot call the API).
     7. You: apps/api/wrangler.toml [vars] WEB_ORIGIN = "https://<domain>,http://localhost:3000", RP_ID = "<domain>"
        (one RP id: localhost passkeys stop working — expected), commit, deploy the API (go-ahead), check a CORS
        preflight from the domain, then /stage, /console, /aero, /assistant on the domain (demo code, Hub "live").
     Do NOT use `pnpm deploy:web` (CLI); the Git integration deploys.
17b. Passkey: I open https://<domain>/aero on my phone and register the passkey (needs HTTPS + RP_ID = domain).
17c. Demo reset (go-ahead): `pnpm seed:core --remote --yes` (Aero Core cards, fees, balances) and `pnpm seed` against
     halyn_dev if needed (pass_demo valid). Wallet check before calls (≈ 3–4 ¢/min).
17d. Persona agents (go-ahead): `pnpm exec tsx scripts/bolna/agent.ts create agents/test-<persona>.json --dry-run`
     first (does Bolna take `api_tools: null`?), then `--yes` for test-polite-hindi, test-hinglish-noisy,
     test-impatient-en → `agent.ts get <id> --out=agents/<x>.current.json` → restricted false (else list_violations,
     reword protectively, re-save) → TEST_AGENT_*_ID into .env (Node script that replaces one KEY= line, never print)
     → `pnpm exec tsx scripts/cf-secrets.ts api --yes` → STATE.md Bolna resources.
17e. Calls (go-ahead per round; the Stage open on the laptop to watch live; 3 and 4 are security_demo in our notes —
     inbound calls carry no user_data). Round 1 = the voice smoke; round 2 = the same again (Step 17's "twice"):
     1 freeze card (Hindi) — I call A from my registered phone → allow, done.
     2 fee waiver ₹600 — same phone → allow after the read-back.
     3 clone — I call A from a SECOND phone (unregistered), new payee ₹45,000 → step_up → Halyn Confirm calls my
       phone from B (+ the passkey sheet on my phone) → I decline → deny, alert.
     4 coached — registered phone, the coached lines → hold, specialist transfer, check-in booked (Console Handoffs).
     5 + 6 — Assistant app on the domain, pass_demo task → B calls A: statement + EMI move → allow, allow; then
       transfer ₹45,000 → step_up → I decline on the phone → deny.
     10 browser call — Stage region US, Aero app on the laptop → Call Aero → wire $8,000 → hold.
     Personas — /console/test Voice mode, one call each, then "Score the call" (check the B-last-4 + time match).
     After each call: /pull-call (timeline, masked fixture), latency proposal → event → speech; fix blockers only.
     After the session: /compliance-check, COMPLIANCE.md session log, STATE scenario table (voice column).
     Also once: /console/test → Run all scenarios on the deployed API; record the scorecard.

STEP 18 — /ship-check; fix only what blocks the Definition of done. Freeze: `agent.ts get --out` snapshots for every
agent (aero, aero-en, confirm, assistant, the three personas), commit; tag `demo-freeze` (push the tag = go-ahead);
STATE.md says frozen: no prompt/agent edits, no API or Aero Core deploys unless something breaks. Known exception:
Step 19's web-only changes deploy through Vercel on push — record that in STATE.

STEP 19 — scripts/clone-clips.ts with what we have: the clone's lines from docs/DEMO_SCRIPT.md scenario 3 (voices say
the name in Devanagari; the script refuses Roman "Saksham"), Sarvam instant voice cloning from my consented sample
(Day-0 check 8, voice C, then atempo=1.25 with @ffmpeg-installer/ffmpeg in a scratch folder); ElevenLabs only if its
credits arrived. Storage = KV `file:<tenant>:clip:<id>` (ADR-023 — R2 was refused), not R2. /stage/soundboard: plays
the clips, "AI clone of Saksham's own voice" on every clip. Stage "recording mode": hides scenario/region/dev controls,
larger type, still the fixed 1920×1080 canvas. Tests: component test (the label on every clip; recording mode hides the
controls) + one e2e. Rendering the clips (Sarvam spend) and the KV writes = go-ahead.

END: /handoff (STATE short, WORKLOG ≤ 8 lines per step), Prettier, ONE final verify + e2e → ask → push.sh → CI both
jobs. Write the chat #8 prompt into HANDOFF.md: Step 20 (README + submission) + the "Chat #8 findings" list + the UI
refinement pass (professional, not AI-looking).
```
