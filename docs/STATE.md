# STATE — read at the start of every chat, update at the end (`/handoff`). Keep it short (speed mode).

_Last updated: 2026-10-29 04:45 IST, chat #5 (Steps 11 + 12 built, deployed, pushed; CI green `6efbbf8`). Next: voice smoke 1, 2,
3, 5, 6, 4 and the browser call (scenario 10) from 09:00 IST (go-ahead per call), then Step 13._

## Where we are
- **Done on `main`:** Steps 0–3, 5, 6, 7, 9, Day-0, **Steps 8 + 10 live** (voice smoke pending), **Step 11 built**
  (deployed; voice-smoke 4 pending), **Step 12 built** (deployed; the real browser call is pending).
- **Step 11:** Sarvam coaching layer 2 after the 300 ms answer (ADR-024: money allow/step_up wait as `screening`,
  `escalateForCoaching` → hold); Hub handoff records + booked check-in (record only); `GET /web/handoffs`,
  `POST /web/handoffs/:id/resolve` (release executes with a grant); Console shell + `/console/handoffs`.
- **Step 12:** `POST /web/calls/session` mints the Bolna web-call session for the region's agent and registers the
  run id as the customer's browser call (proof app_session; US → `cus_saksham_us`); Aero "Call Aero" card
  (`@bolna/web-call` 3.0.1); `aero-en` agent (English, USD, Deepgram Asteria, web only, no transfer). Stage region
  switch was already wired. Scenario 10 passes in text mode.
  Working mode: **CLAUDE.md §5 speed mode** (one chat per step, no subagents, light tests, local commits, ask before push).
- **Step 8:** prompts in Devanagari Hindi (voice: Sarvam `bulbul:v4-flash` `simran_enhi_banking_expressive` 1.1×,
  Saksham's pick; endpointing 300 ms). API + Aero Core deployed; Aero graph on A, Confirm graph (speech only, hangs up
  on the `recorded` event) on B. Bolna webhooks can't send headers → `/webhooks/*` take `?key=` (ADR-022).
- **Step 10:** `/web/passes` (options → issue with a passkey challenge bound to the draft; list; revoke),
  `/web/assistant/tasks` (Assistant calls A from B, bound to the Pass: `get_pass_code` sends only `call_sid`), Aero
  "Assistant" tab, Assistant app (Pass card, task box, live log: Pass-code line, decisions, transcript at call end).
- `DEMO_ACCESS_CODE` set on the deployed API (2026-10-29). `pnpm verify` ✓ 04:00 IST (all text scenarios with layer 2 on);
  e2e 12 ✓. Pushed `6efbbf8`, CI green (verify + e2e).

## Bolna facts (binding; details in docs/BOLNA.md)
- Tool params: never a run id (`%(execution_id)s` isn't a tool variable; a param `run_id` crashes the call); send
  `call_sid`, the API maps it from the webhooks. Never argument names `method`, `run_id`, `url`, `headers`, `param`.
  Optional LLM args risk a KeyError in `%(x)s` → `propose_action` sends one JSON `params` string; all args required.
- Every agent's `webhook_url` and each tool's `pre_call_webhook_url` = `<API>/webhooks/bolna?key=<HALYN_TOOL_SECRET>`.
- Events work on graph agents (~230–430 ms). Static nodes can't speak variables (`confirmed` is an LLM node).
- DTMF off everywhere (Vobiz). Hindi a voice speaks → Devanagari; names → सक्षम / सक्षम मिश्रा.

## Approvals (per chat — re-confirm in a new chat)
- Any real call / number / agent create-update-delete / relink / wallet spend / deploy / DB write: go-ahead in the chat.
- Attacker persona agents on Bolna: **NOT approved** (text mode only). Push: ask Saksham.

## Bolna resources
| Resource | Id | Notes |
|---|---|---|
| Number A +918065356344 | `9a3b9852-ae7e-4b7c-bab9-f1f0bf4b24d2` | → **Aero graph** (relinked 2026-10-29) |
| Number B +918065356379 | `b6875116-e8b9-4174-9c71-08a87cd1dc62` | `from_phone_number` for Confirm + Assistant |
| Aero graph (`aero-hi`) | `f02fa07d-54e8-4140-a318-72b816c10a57` | `agents/aero.graph.json`, snapshot `aero.current.json` |
| Halyn Confirm graph | `96a6c2a2-9695-4876-8a34-41112d812077` | `agents/confirm.graph.json`; guardrails 9–21 |
| Saksham's Assistant | `29d45c35-c6c4-44df-9548-76f9b9084a5c` | `agents/assistant.json`; guardrails 9–21 |
| Aero English, US web (`aero-en`) | `f281278d-90cb-4550-a285-60f2abcb7638` | `agents/aero-en.graph.json` (generated: `scripts/bolna/make-aero-en.mjs`); web only |
| Old Kavach listener, Day-0 agents (Aero test `c03d110b…`, Confirm test `e0f05bf4…`, Assistant `a4d3d5cf…`, caller `17ad7f4e…`) | — | unlinked, kept; retire only with go-ahead |
All real agents `restricted: false` (aero-en checked 2026-10-29 04:40); `list_violations` empty (00:35). Wallet 958.7 ¢.
Use `agent.ts get --out` for snapshots: the MCP `get_agent` returns the tool secret in plain text. Helpers:
`scripts/bolna/*.ts` (writes need `--yes`; agent pushes fill `{{API_URL}}` from `HALYN_API_URL`); `check-agents.ts` (offline
gate) and `inspect-agent.mjs` (snapshot summary). Workflow: HANDOFF.md conventions 11–15.

## Deployed / cloud
| Thing | Status |
|---|---|
| API Worker | `https://halyn-api.halyn-api.workers.dev` (18 secrets via `scripts/cf-secrets.ts api --yes`; Steps 11 + 12 deployed `dee65a7f`) |
| Aero Core Worker | `https://halyn-aero-core.halyn-api.workers.dev`; D1 `aero-core` `bfc0e8a5…` seeded |
| KV `CONFIG` | `0944d7d7…`; `pack:ten_aero:IN` / `:US` uploaded. **Files go here too** (ADR-023; R2 refused, no card; S3 if final round) |
| TiDB `halyn_dev` | migrated (0001) + seeded (real number, `pass_demo` → number B, 30 days) — the Worker's DB |
| Web (Vercel) | Not linked yet → passkeys (need HTTPS + RP_ID) and the Assistant/Aero screens are local-only until then |
`*.workers.dev` opened from this machine on 2026-10-28 (curl /health 200).

## Scenario status
Text mode (`pnpm test:scenarios`): all 13 ✅ (1–12, 3b), coaching layer 2 on (mock Sarvam).
Voice: none yet. Smoke plan: 1, 2, 3 (Saksham calls A; 3 from a second phone, step-up → Confirm call → decline) and
5, 6 (`POST /web/assistant/tasks` with `pass_demo` from a customer session; 6 = step-up → decline).

## Next steps (in order) — only after Saksham's go-ahead (full detail: the chat #5 prompt in docs/HANDOFF.md)
1. 09:00–21:00 IST: voice-smoke 1, 2, 3, 5, 6 (go-ahead per call); raw logs to file + a filter script;
   `list_violations` + COMPLIANCE.md log; scenario table here. Inbound calls can't carry `user_data`, so scenario
   3/4's `security_demo` tag lives in our notes (Bolna was told in advance).
2. Voice-smoke 4 (coached customer from the registered phone → hold → protect → transfer; confirm SPECIALIST_NUMBER is
   Saksham's first). 3. Browser call (scenario 10): local web app → Aero "Call Aero" with the Stage region US → ask a
   $8,000 wire → hold. 4. Step 13 (Console pages).
   Context budget: a new chat when one passes ~40 %. Steps 14–20 after; **at the end: full testing + hardening**.

## Carry into later steps
- Steps 11/13: approved tier-4 changes become a handoff until the Console release flow exists.
- Steps 15/17: live Stage runs touch the demo customer's real Aero Core rows (demo reset); 3b (60 s) and 12 don't fit a
  Worker's 30 s `waitUntil` → run long scenarios inside the Hub (alarm-stepped).
- Step 12 browser call: if tools 400 on a non-phone `from_number` or the call sid never maps, read the raw logs first.
- Step 13/19: files in KV `file:<tenant>:<kind>:<id>` (ADR-023). Step 17: deploy web to Vercel, set `WEB_ORIGIN` +
  `RP_ID` on the API, register the passkey on the phone.
- Step 19: clone lines in voice C then `atempo=1.25`; `scripts/clone-clips.ts` refuses Roman "Saksham".
- Names: spoken text uses सक्षम / सक्षम मिश्रा (`customer_name`, `user_data`); screens show "Saksham".

## Known issues / notes
- pnpm 12.15.0 global. IST time: `node -e "console.log(new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}))"`.
- Wrangler auth: `set -a; . ./.env; set +a` (CLOUDFLARE_API_TOKEN), then `pnpm deploy:api|deploy:core`.
- Pure-module lint rule covers gate/grants/ledger/pass/shared + the two lexicons; don't name files `db.ts`/`bolna.ts`/
  `hub.ts`/`core-client.ts` there. Action/route catalog: `docs/ACTIONS.md`. Gate clarifications: ADR-011 / GATE.md.
- `GITHUB secret TIDB_TEST_DATABASE_URL` not set → the DB suite skips in CI (passes locally).
- AWS MCP failed to connect in chat #4 ("Invalid request parameters"). Never use the AWS root account.
- Waiting on Bolna: attacker-persona approval, $40 credits, ElevenLabs $15 credits.
