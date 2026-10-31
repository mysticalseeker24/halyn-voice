# STATE — read at the start of every chat, update at the end (`/handoff`). Keep it short (speed mode).

_Last updated: 2026-10-30 22:45 IST, end of chat #9. **English real calls 1, 2, 4, 10 graded; ~10 call-driven fixes
deployed (API `873d73f0`, Aero IN + US graphs) and pushed.** Chat #10 (prompt in docs/HANDOFF.md), Sat Oct 31 from
09:00: daytime Run all → README numbers; calls 3, 4, 5+6 (+ personas) with the Confirm callback; video takes per
docs/DEMO_SCRIPT.md; freeze tag; submit (docs/SUBMISSION.md)._

## Chat #9, Oct 31 evening — deck-only submission + judge access (live)
- Saksham submits the **pitch deck only** (no video): content in docs/DECK.md (14 slides, real-call screenshots).
- **Judges try it at `/try`** with `JUDGE_ACCESS_CODE` = `HALYN-JUDGE-2026` (Worker secret; on slide 13): name +
  number → own demo customer `cus_judge_<id>` (+ `_us`), hash + last 4 only, mirrored to TiDB; Aero Core creates the
  account from the seed template on the first grant; passkey-only step-ups (Halyn never calls a judge). API
  `f323d9f9`, Aero Core `2b4cd8d3`; live check ✅ (401 wrong code, signup, ₹5,20,000 home, same number → same id).
  A test judge `cus_judge_01M69G82…` (a fake test number) exists in prod data. Rotate the code after judging.
- Nov 1 hardening: each customer's Aero/Assistant socket hears only its own requests (`messageCustomer` in the Hub;
  before, every Aero app saw every approval sheet); `/try` refuses numbers A/B and the demo phone; judge accounts skip
  `S_UNUSUAL_HOUR`; the Pass form pre-fills number B; `/try` links every app/page + "Good to know". Outbound calls
  stay 09:00–21:00 IST and never go to judges' numbers (hard rules).

## Chat #9 (2026-10-30, 19:48–22:45 IST) — what the calls changed (all live)
- Fixed lines for `confirmed` and `protect` (the LLM improvised "under review"); an allow is sent only as `done`
  (`propose` → `confirmed` edge; finding 7); demo reset (and every Stage/Run-all scenario) also clears limit and
  Pass-use counts; browser calls send Halyn's `call_ref` (Bolna gives no call sid); US twin uses the Sarvam voice
  (Deepgram TTS failed); India new payees skip the spoken IFSC (`payee_ifsc=AERO0000001` from records);
  `caller_quotes` = the caller's own words about the request; STT keywords + "Saksham Mishra", minus "Aero Bank";
  clone clips 3 ("forty-four seventy-one") and 4 re-rendered.
- **This Wi-Fi blocks `*.workers.dev`** (laptop + browser): use the phone hotspot. Vobiz inbound dropped once ~20:50.
- Run all is valid only 09:00–21:00 (after 21:00 no callback channel; after 23:00 `S_UNUSUAL_HOUR`). Live
  `propose_action` measured 230–560 ms vs the 300 ms live budget — expect some latency failures; report honestly.
- Specialist transfer goes to `SPECIALIST_NUMBER`: in a take, answer "No, not now" unless that number is another phone.

## Where we are
- **Done on `main`:** Steps 0–16, slim 14, Day-0; Step 19's code. Working mode: **CLAUDE.md §5 speed mode**.
- **Chat #8, after 03:00:** frontend redesign — landing page with a clear map of the four apps, light/dark tokens on
  every page (`globals.css`; Aero has its own `.aero` scope; `theme-toggle.tsx`), Console/Stage/Aero/Assistant
  restyled; brand assets (`apps/web/public`: halyn-mark, halyn-lockup, og.png, pipeline.png; `src/app/icon.png`);
  README link table + pipeline figure; `docs/BRAND.md` (palette, image prompts, 14 pitch-deck prompts → `docs/deck/`).
- **Chat #8 (pushed `5e2be1d`, CI green, 02:20):** English demo (`make-aero-en.mjs in|us` from the Hindi
  `agents/aero-hi.graph.json`; Confirm/Assistant English; seed `en`; 8 English clips in KV), console demo reset
  (`POST /web/stage/demo-reset`, `scripts/ops/demo-reset.mjs`), findings 1/4/5/6/9, README draft, UI accent pass.
- **Step 16 (chat #7):** whole-codebase review → fixed: unmasked error logs (all via `logLine`, source-scan test), the
  registered-number proof now comes from Bolna's telephony record (webhook), not the LLM-visible tool body; Hub-down
  drill + propose p95 test; undici override (audit); history secrets scan clean. Rest → "Chat #8 findings" below.
- **Step 17 so far:** Vercel `https://halyn-voice.vercel.app` (Git integration, Root Directory `apps/web`,
  `apps/web/vercel.json`); `WEB_ORIGIN`/`RP_ID` = the domain (+ localhost origin); CORS checked; persona agents created;
  8 Hindi clone clips rendered + in KV; demo reset done (card 8812 is **frozen** again after call 1 — reset before reuse).
- **Voice fixes from the smoke (all live on Bolna except the last API one):** `propose_action` params as quote-free
  `key=value; …` (Bolna pastes `%(params)s` into a quoted JSON string — JSON objects broke every proposal); quotes
  `' | '`-separated; card on record in the Aero records (no digit capture); Hindi pre-call/"still there?" lines (Bolna's
  defaults are English); `confirmed`/`protect` don't rely on `{{reference}}`/`{{reason}}` (Bolna left them unfilled);
  one short filler after a proposal; transcriber `noise_reduction: true`, `vad_threshold 0.65`.
  **Not deployed yet:** `cd31bc8` (no Confirm callback to the phone the caller is already on — call waiting).

## Bolna facts (binding; details in docs/BOLNA.md)
- Tool params: never a run id; send `call_sid`. Never argument names `method`, `run_id`, `url`, `headers`, `param`.
  Every LLM argument required. **Values are pasted raw into a quoted JSON template: no `"` in any value** →
  `params` = `k=v; k=v`, quotes `a | b` (`packages/shared` `bolnaParams`/`bolnaQuotes` read both shapes).
- **Event properties are NOT substituted into node prompts** (`{{reference}}` reached the LLM as `{reference}`), even on
  LLM nodes; events wait until the agent stops speaking (fillers delay outcomes).
- Every agent's `webhook_url` and each tool's `pre_call_webhook_url` = `<API>/webhooks/bolna?key=<HALYN_TOOL_SECRET>`
  (raw logs show the key in plain text — never paste them).
- Empty `pre_call_message` / default `check_user_online_message` → Bolna speaks English defaults: set them.
- DTMF off (Vobiz). Names a voice speaks → सक्षम / सक्षम मिश्रा (English sentences too).

## Approvals (per chat — re-confirm in a new chat)
- Any real call / number / agent create-update-delete / relink / wallet spend / deploy / DB or KV write / Sarvam spend:
  go-ahead in the chat. Attacker persona agents on Bolna: **NOT approved** (text mode only). Push: ask Saksham.

## Bolna resources
| Resource | Id | Notes |
|---|---|---|
| Number A +918065356344 | `9a3b9852-ae7e-4b7c-bab9-f1f0bf4b24d2` | → Aero graph |
| Number B +918065356379 | `b6875116-e8b9-4174-9c71-08a87cd1dc62` | `from_phone_number` for Confirm + Assistant |
| Aero graph (English IN, was `aero-hi`) | `f02fa07d-54e8-4140-a318-72b816c10a57` | `agents/aero.graph.json` → snapshot `aero.current.json` |
| Halyn Confirm graph | `96a6c2a2-9695-4876-8a34-41112d812077` | `agents/confirm.graph.json`; Hindi; tool pre-call line still English |
| Saksham's Assistant | `29d45c35-c6c4-44df-9548-76f9b9084a5c` | `agents/assistant.json` |
| Aero English, US web (`aero-en`) | `f281278d-90cb-4550-a285-60f2abcb7638` | generated by `scripts/bolna/make-aero-en.mjs`; web only |
| Persona polite-hindi / hinglish-noisy / impatient-en | `b06bbbba-062e-4bc1-9e8a-8da55051c519` / `1d8328c7-aa89-4399-9ea9-a87c911272e9` / `f023effc-8b3e-45fc-afe5-f7aa99d0fdd8` | `agents/test-*.json`; ids in `.env` + Worker secrets (21) |
| Old Kavach listener, Day-0 agents | — | unlinked, kept; retire only with go-ahead |
All real agents `restricted: false` (checked after every update, 2026-10-29 ≤ 15:56). Wallet 926.7 ¢ (16:10, after ~14 calls).
Snapshots: `agent.ts get --out` (MCP `get_agent` shows the tool secret). Offline gate `check-agents.ts`.

## Deployed / cloud
| Thing | Status |
|---|---|
| API Worker | `https://halyn-api.halyn-api.workers.dev`, version `22c6c07a` (2026-10-30 03:15; = main `b9f75ff`: English, demo reset, findings, live Run-all Pass skip). Aero Core state dirty from the 02:30 live run: `seed:core` before calls |
| Aero Core Worker | `https://halyn-aero-core.halyn-api.workers.dev`; D1 `aero-core` (`pnpm seed:core --remote --yes` = demo reset) |
| KV `CONFIG` | packs `pack:ten_aero:IN|US`; clips `file:ten_aero:clip:<id>` (8, English en-IN, 2026-10-30) |
| TiDB `halyn_dev` | migrated + seeded (`pass_demo` → number B, 30 days from 2026-10-28) |
| Web (Vercel) | `https://halyn-voice.vercel.app` — every push to main redeploys; preview URLs can't call the API |
This machine's network intermittently resets `wrangler tail` and once blocked the API host for ~2 min (Bolna unaffected).

## Scenario status
Text mode (`pnpm test:scenarios`): all 13 ✅. Live Stage text run of 1 and 2 on the deployed API ✅ (CPU: normal
requests ≤ 8 ms; the in-process Stage run 105 ms; one Hub event 15 ms; no CPU-limit hit).
Voice (Hindi, round 1): **1 ✅** (call `3e4a4e81`: registered via telephony, allow tier 1, executed, Hindi outcome;
proposal → outcome audio 6.6 s, fillers since cut). **2 ⚠️** (`ded42251`): step_up because `S_CALL_BURST` (≥ 3 calls/hour
from the number during testing); Confirm call approved → executed; Aero never spoke it (carrier call-waiting audio) →
fixed by `cd31bc8`.
Voice (English, chat #9, table in README "Real calls"): **1 ✅** (`cee48b55`) · **2 ✅** (`6347ac0b`, P_WITHIN_LIMIT) ·
**4 ✅ hold** (`5d781aa6`, S_COACHING 0.95; retake `1c490c71` missed the cue → caller_quotes fix) · **10 ✅ hold**
(`f24739b9`, browser) · **3 ⚠️** (`5640f749`: clone digits heard as 471 → fail-closed deny; clip 3 re-rendered) ·
5+6, personas, round 2: not yet (need 09:00–21:00 outbound).

## Next steps (chat #10, Sat Oct 31 from 09:00 IST — prompt in docs/HANDOFF.md)
1. seed:core + demo reset → `node scripts/ops/run-all.mjs IN` (+ US) → README "Latest Run all"; seed:core after.
2. Calls: 3 (clone, decline on the Confirm call), 4 (coached), 5+6 (Assistant + Pass), personas; grade, README table.
3. Video takes per docs/DEMO_SCRIPT.md shot list (Saksham records); X cut per docs/LAUNCH.md.
4. Freeze: snapshots, `demo-freeze` tag (push = go-ahead); docs/SUBMISSION.md final pass; submit.

## Ship-check (chat #8, 02:55 IST)
Code items all ✅ (text mode 15/15, CI green, Aero Core 401 on no/forged grant by curl, grant tests, ledger verify ok
104 entries, 7/7 agents restricted false, violations 0, guardrails 9–21, disclosure, no secrets). Open: real calls ×2,
step-up → live call < 2 s, passkey on the phone in a call, video, freeze. Keypad callback impossible (Vobiz, no DTMF).
A live Run all at 02:30 IST failed on S_UNUSUAL_HOUR (night, by design) and cold latency — rerun in daytime.

## Chat #8 findings status
- Done: 1 (verify_pass vs telephony record), 4 + 5 (documented in COMPLIANCE.md "Demo-only shortcuts"), 6 (propose
  budget 300 ms live, 1 s in-process), 8 (fee wording), 9 (demo reset).
- 3 skipped for the freeze (a failed `%(from_number)s` substitution would 400 every tool; the telephony record
  already wins). 7 (outcome latency) waits for the first English call's numbers.
- Voice names: Sarvam en-IN speaks the Devanagari name right (clone STT-checked). If an agent voice says "Saa…",
  flip that agent's synthesizer `language` back to `hi` (Saksham's call, 2026-10-30).

## Known issues / notes
- pnpm 12.15.0 global. IST: `node -e "console.log(new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}))"`.
- Call-review helpers: `scripts/ops/*.mjs` (call-detail, call-timeline, stage-run, json-diff, set-env, tail-cpu).
- Wrangler auth: `set -a; . ./.env; set +a`, then `pnpm deploy:api|deploy:core`. The secret scan treats agent ids,
  Bolna IPs and the WS URL as public. Callers on number A: hold the phone to the ear (speaker noise kept VAD open).
- Pure-module lint rule covers gate/grants/ledger/pass/shared + the lexicons. `TIDB_TEST_DATABASE_URL` not in CI.
- AWS MCP fails to connect. Waiting on Bolna: attacker-persona approval, credits; ElevenLabs credits.
