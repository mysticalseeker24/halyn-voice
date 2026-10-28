# STATE — read at the start of every chat, update at the end (`/handoff`). Keep it short (speed mode).

_Last updated: 2026-10-28 15:50 IST, end of chat #3. Next chat: **Step 8** (prompt in `docs/HANDOFF.md`)._

## Where we are
- **Done on `main`:** Steps 0–3, 5, 6, 7, 9 and **Day-0 (Step 4) closed**. Working mode: **CLAUDE.md §5 speed mode**
  (one chat per step, no subagents, light tests, local commits, ask before push).
- **Step 7:** six Bolna tools + `/webhooks/bolna`, Bolna client, core client (ADR-017), Confirm (passkey + callback,
  first answer wins, 60 s), passkeys on WebCrypto (ADR-018), web routes (aero home, approvals incl. decline, passkey
  registration, ledger, stage run/region, `POST /web/ws-ticket`), text-mode runner (ADR-019). Hub = call-time read
  model + Gate in its lane, TiDB mirror (ADR-016); Hub sweep for unclaimed/stuck executions (ADR-020); one-time `/ws`
  tickets (ADR-021). Invariant 7 strict (scenario 12 = one call per transfer).
- **Step 9:** Aero app (home, alerts, approval sheet, passkey registration, Hindi/English, demo-code prompt) and
  Stage v1 (1920×1080) on `@halyn/shared` schemas; `useHub` with tickets. Screens in `docs/screens/`.
- **Day-0 (2026-10-28):** checks 1–5 ✅, 6 ✗ (DTMF kills speech on Vobiz → speech only), 7 skipped, 8–12 ✅. Full table
  and evidence: `docs/DAY0.md` → Results. Probe Worker + KV + D1 **deleted**.
- **All pushed** (2026-10-28 16:00 IST, `0e05ec0`, CI green). Speed-mode overrides also in PROMPTS.md and the slash
  commands (no subagents anywhere).

## Bolna facts learned on Day-0 (binding for Step 8; details in docs/BOLNA.md)
- **Tool params:** never send a run id (`%(execution_id)s` is not a tool variable; a param named `run_id` crashes the
  call). Send `call_sid`; the API maps it to the run id from the webhook → **every agent's `webhook_url` = Halyn
  `/webhooks/bolna`** (Confirm too). Tool **argument names** are passed into Bolna's HTTP call: never `method`,
  `run_id`, `url`, `headers`, `param`. `confirm_result` sends `answer`, `request_id`, `call_sid` only (method = speech).
- **Events work** (`allow`/`done` → 202 in ~230–430 ms, graph moves). Static nodes can't speak variables → the node
  that says the reference must be an LLM node reading the `done` event's `reference`.
- **Confirm:** DTMF off (Vobiz); the greeting itself asks "Do you approve…? Please say yes or no"; end the call right
  after the answer (it repeated its closing line after "okay, thank you").
- **Voice (Saksham: slow, robotic, wrong Hindi):** write **every Hindi word a voice speaks in Devanagari** (Roman
  "Main" is read as English; same rule as सक्षम मिश्रा); short warm greeting; tune Sarvam `bulbul:v3` pace/speaker
  (now "priya") and endpointing (now 500 ms); compare ElevenLabs if credits arrive. Do this first in Step 8.
- TiDB from India is unpredictable (64 ms … 3.4 s) → stays off the call path (ADR-016 holds). D1 ~65–105 ms warm.

## Approvals (per chat — re-confirm in a new chat)
- Any real call / number / agent create-update-delete / relink / wallet spend / deploy: go-ahead in the chat.
- Attacker persona agents on Bolna: **NOT approved** (text mode only).
- Push: ask Saksham. Commits: local, as pieces work.

## Bolna resources
| Resource | Id | Notes |
|---|---|---|
| Number A +918065356344 | `9a3b9852-ae7e-4b7c-bab9-f1f0bf4b24d2` | linked to the Day-0 Aero test agent, whose tools pointed at the **deleted** probe → calls to A fail until Step 8 relinks A to the real Aero agent |
| Number B +918065356379 | `b6875116-e8b9-4174-9c71-08a87cd1dc62` | `from_phone_number` for outbound |
| Old Kavach listener | `1ad15c7b-3483-4c9e-a336-e371ce112b98` | unlinked, keep (no delete without go-ahead) |
| Day-0 agents | Aero test `c03d110b…`, Confirm test `e0f05bf4…`, Assistant `a4d3d5cf…`, test caller `17ad7f4e…` | all `restricted: false`; retire after Step 8 (go-ahead) |
| Real agents | — | Step 8 |
Wallet 958.7 ¢ (2026-10-28 15:45); Day-0 spent 33.9 ¢. `list_violations`: none. Bolna MCP lacks graph tools →
`scripts/bolna/*.ts` (writes need `--yes`; agent pushes need `--probe-url`/env placeholders; `call.ts` only dials our
numbers, 09:00–21:00 IST).

## Deployed / cloud
| Thing | Status |
|---|---|
| API Worker, Aero Core Worker, KV `CONFIG`, R2 `halyn-files`, D1 `aero-core` (remote) | Not created/deployed (Step 8, go-ahead) |
| Web (Vercel) | Not linked |
| TiDB `halyn_dev`, `halyn_test` | Migrated to 0000; **`halyn_test` also has 0001** (DB suite). Run `pnpm db:migrate` + `pnpm seed` on `halyn_dev` (0001 + spoken names) before deploy |
| Sarvam voice clones | voice C `svc-90c91242…` + ffmpeg `atempo=1.25` for the clone clips (Step 19) |
This machine can't open `*.workers.dev` (Cloudflare anycast times out): test deployed Workers via the Cloudflare API,
logs, or the phone on mobile data.

## Scenario status
Text mode (`pnpm test:scenarios`): 1–9, 3b, 11, 12 ✅; 10 pending Step 12. Voice: none yet (Step 8 smoke: 1, 2, 3).

## Next steps (in order) — only after Saksham's go-ahead
1. (Done: pushed, CI green.) Check `gh run list --limit 1` once.
2. **Step 8** (PROMPTS.md): voice fixes first (above); `pnpm db:migrate` + `pnpm seed` on `halyn_dev`; deploy API +
   Aero Core (KV packs `pack:<tenant>:<region>`, secrets incl. `BOLNA_CONFIRM_AGENT_ID`, `NUMBER_B`,
   `CUSTOMER_PHONE`, `WEB_ORIGIN`, `AERO_CORE` binding; the Hub needs Aero Core + `HALYN_SIGNING_KEY`); create the Aero
   graph (+ event edges `working` deny→`refused`, `awaiting_confirmation` hold→`protect`) and the Confirm agent with the
   Day-0 rules above; relink A; voice-smoke 1, 2, 3 (3 tagged `security_demo`).
3. Steps 10–20 in order.

## Carry into later steps
- Steps 11/13: approved tier-4 changes become a handoff until the Console release flow exists.
- Steps 15/17: live Stage runs touch the demo customer's real Aero Core rows (needs a demo reset); 3b (60 s) and 12 don't
  fit a Worker's 30 s `waitUntil` → run long scenarios inside the Hub (alarm-stepped).
- Step 12: scenario 10 (browser calls carry the app session); check 7 (web call) is tested there on the real API.
- Step 19: clone lines in voice C then `atempo=1.25`; `scripts/clone-clips.ts` refuses Roman "Saksham".
- Names: spoken text uses सक्षम / सक्षम मिश्रा (`customer_name`, `user_data`); screens show "Saksham".

## Known issues / notes
- pnpm 12.15.0 global. IST time: `node -e "console.log(new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}))"`.
- Pure-module lint rule covers gate/grants/ledger/pass/shared + the two lexicons; don't name files `db.ts`/`bolna.ts`/
  `hub.ts`/`core-client.ts` there. Action/route catalog: `docs/ACTIONS.md`. Gate clarifications: ADR-011 / GATE.md.
- `GITHUB secret TIDB_TEST_DATABASE_URL` not set → the DB suite skips in CI (passes locally).
- Waiting on Bolna: attacker-persona approval, $40 credits, ElevenLabs $15 credits.
