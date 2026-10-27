# STATE — read at the start of every session, update at the end (`/handoff`)

_Last updated: 2026-10-28 03:00 IST, end of chat #2 (Step 6 + review fixes pushed; secrets set; voice clones made;
probe redeployed). New chats start from `docs/HANDOFF.md`._

## Where we are
- **On `main`:** Steps 0–3, 5, 6 and the Day-0 prep. Step 6 went out in the chat #2 push (17 commits after
  `c691496`) — check `gh run list --limit 1` for its CI result.
- **Step 6 — done:** `apps/aero-core` D1 schema + migration, deterministic `pnpm seed:core` (local D1), grant-checked
  routes from `CORE_ROUTES` (`packages/shared/src/core.ts`), jti insert first in each effect's single `db.batch`.
  Review fixes: body read byte-capped at 4,096 B as it streams; every write's precondition re-checked inside the batch
  (stale read → nothing written); `E_GRANT_REUSED` carries `details {outcome:"executed", reference, request_id,
  used_at}`; HEAD → 405; currency joins; GET-params contract test; different-grants overdraw race test. ADR-015.
- **Secrets set** (2026-10-27): signing key `halyn-2026-10` (`scripts/out/keys/`), JWKS, `PASS_CODE_PEPPER`,
  `SESSION_SECRET`, `PHONE_HASH_PEPPER` in `.env`; `apps/api/.dev.vars` + `apps/aero-core/.dev.vars` written.
  `halyn_dev` re-seeded with the real `CUSTOMER_PHONE` and key `halyn-2026-10`.
- **Step 5 — pushed:** API skeleton (env
  validation, error envelope, Bolna guard, HMAC sessions, `/web/session`, `/web/me`, `/ws`), Drizzle schema + migrations
  for all 14 TiDB tables (tenant_id on all), `pnpm db:migrate`, `pnpm seed`, HubDO (ordered ledger lane + TiDB outbox,
  idempotency, confirmations + alarm timeout, WebSockets). `pnpm verify` green incl. the gated TiDB suite (local).
  `wrangler dev` serves `/health` → 200. ADR-013 (TiDB databases, no MySQL container), ADR-014 (Hub design).
- **Step 4 (Day-0) — setup done, calls NOT placed yet** (chat #2 was outside 09:00–21:00 both times). The probe now
  times TiDB/D1 on Bolna's real tool request (check 11) and its cron is removed. Run the calls from **09:00 IST** with
  `docs/DAY0.md`. Results so far: check 8 ✅, 9 ✅, 11 ⚠ (cron only), 12 ✅ (table below).
- **Schedule (Saksham, 2026-10-28):** no freeze cut — **build the whole product end to end** (all 12 scenarios, every
  step in `PROMPTS.md`), even past Oct 28. Submission stays Sat Oct 31. Order: Day-0 calls (09:00) · Step 7 → Step 8,
  with **Step 9 in parallel** (web-builder) · then Steps 10–20.

## Waiting on (outside the code)
| Item | Owner | Status |
|---|---|---|
| Bolna reply on attacker personas + fraud-like demo calls | Saksham (Slack) | Unknown — ask him |
| Bolna credits ($40 requested) | Bolna | Pending. Wallet 992.5 ¢ (≈ $9.93) on 2026-10-26 |
| ElevenLabs partner credits ($15) | Bolna | Pending. Sarvam instant cloning (beta) is the plan |
| GitHub secret `TIDB_TEST_DATABASE_URL` (…/halyn_test) | Saksham decides | Not set → the DB suite skips in CI with a warning (passes locally) |

## Approvals (from Saksham) — every one is per session; re-confirm in a new chat
- Attacker persona agents on Bolna: **NOT approved** — text mode only.
- Day-0: go-ahead given 2026-10-26 (setup) and again in chat #2 on 2026-10-28 02:33 IST (probe redeploy — done — and
  the calls in `docs/DAY0.md`, ≤ 20 billed minutes). Calls not placed (outside 09:00–21:00). **A new chat re-confirms
  before the first call** unless Saksham's opening prompt approves them.
- Any real call / number / agent create-update-delete / relink / wallet spend / deploy needs a go-ahead in the session.
- **Commit + push: ask Saksham at the end of each step** (show the commit split). He prefers **more, smaller commits**
  (8+ per push is fine); verify each commit on its own before pushing (`docs/HANDOFF.md` → Conventions).

## Bolna resources
| Resource | Id / value | Notes |
|---|---|---|
| Number A | +918065356344 · `9a3b9852-ae7e-4b7c-bab9-f1f0bf4b24d2` | **linked to the Day-0 Aero test agent** `c03d110b…` since 2026-10-26 |
| Number B | +918065356379 · `b6875116-e8b9-4174-9c71-08a87cd1dc62` | unlinked; used as `from_phone_number` for outbound |
| Old Kavach/Halyn listener | `1ad15c7b-3483-4c9e-a336-e371ce112b98` | kept, unlinked (retire later; don't delete without go-ahead) |
| Day-0 Aero test graph agent | `c03d110b-9d59-453b-a899-5cd3eca4f3a9` | card freeze only; tools → probe Worker; `restricted: false` |
| Day-0 Confirm test agent (outbound) | `e0f05bf4-efd6-463f-93cf-e10b34ffe23b` | guardrails 9–21; DTMF on (Vobiz doesn't support it); `restricted: false` |
| Day-0 Assistant | `a4d3d5cf-387b-44e8-bf60-6ca52e2c320c` | content check only; `restricted: false` |
| Day-0 test caller (polite Hindi) | `17ad7f4e-2e7a-4f8c-858e-918b8867ecc4` | normal customer persona; guardrails 9–21; `restricted: false` |
| Real agents (Aero hi graph, Aero en web, Confirm, Assistant) | — | Step 8 (from `prompts/`, agents/ JSON) |
Bolna MCP here lacks the graph-agent tools → use `scripts/bolna/*.ts` (REST; writes need `--yes`; `call.ts` only dials
our numbers and only 09:00–21:00 IST). `list_violations` on 2026-10-27 01:50 IST: none.

## Deployed / cloud
| Thing | Where | Status |
|---|---|---|
| API Worker | — | Not deployed. KV `CONFIG`, R2 `halyn-files` not created (no ids in `wrangler.toml`) |
| Aero Core Worker | — | Not deployed. D1 `aero-core` not created |
| Web (Vercel) | — | Not linked |
| Day-0 probe Worker | `https://halyn-day0-probe.halyn-api.workers.dev` (`tools/day0-probe`) | Live, redeployed 2026-10-28 (version `e3efdc12…`): logs `timings_on_request` (TiDB + D1 from the colo serving each Bolna tool call); **cron trigger removed**. Delete the probe, KV `halyn-day0-kv` (`e975471ab2274a31b698fd6dbf05414c`) and D1 `halyn-day0-db` once Day-0 is closed (commands in `docs/DAY0.md`) |
| TiDB Starter (ap-southeast-1) | databases `halyn_dev`, `halyn_test` | Both migrated (14 tables). `halyn_dev` seeded 2026-10-27 with the real `CUSTOMER_PHONE` (hash) and key `halyn-2026-10`. `halyn` (demo) not created |
| Sarvam voice clones | 3 voices (ids in `docs/DAY0.md` check 8) | Use **voice C** `svc-90c91242…` + ffmpeg `atempo=1.25` for Hindi and English (Step 19) |
This machine's network can't open `*.workers.dev` (Cloudflare anycast times out); read the probe with
`node --env-file=.env tools/day0-probe/read-log.mjs 10` (Cloudflare API).

## Day-0 results so far (full table in `docs/DAY0.md`)
| # | Result |
|---|---|
| 9 | ✅ 4/4 agents `restricted: false` |
| 11 | ⚠ From the probe's cron: TiDB HTTP 2220 / 832 / 654 ms, D1 403 / 170 / 188 ms — over the < 150 ms target. Cron location is Cloudflare's choice (likely not India): **re-measure on a request routed via India** (the inbound call's tool request) before choosing a fallback. Mitigations: Smart Placement, keep TiDB off the 300 ms `propose_action` path (Hub first, TiDB in `waitUntil`), TiDB region |
| 12 | ✅ Sarvam chat from a Worker 687 / 261 ms (< 1.5 s) |
| 6 | Expected ✗: Bolna's DTMF table says Vobiz unsupported → speech-only fallback (still test once) |
| 8 | ✅ Three Sarvam clones (A Hinglish, B English, C calm Hindi), ids in `docs/DAY0.md`; consent = Saksham's consent clip (API has no consent field). Saksham's pick: **voice C at 1.25× (ffmpeg `atempo`) for Hindi and English**; the name is written सक्षम मिश्रा in all TTS text (Roman "Saksham" is spoken with a long "Saa") |
| 10 | Skipped (not approved) |
| 1–5, 7 | Pending the calls |

## Tooling and env (this machine)
| Item | Status |
|---|---|
| pnpm | Repo pins 12.15.0; global pnpm is 9.15.2 and ignores the pin → `npm i -g pnpm@12.15.0` once, or a corepack shim (see HANDOFF) |
| IST time | Git Bash `date` ignores `TZ` (prints UTC). Use `node -e "console.log(new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}))"` |
| MCP | Bolna (connected). Cloudflare + TiDB in `.mcp.json` (git-ignored, pre-approved in `.claude/settings.local.json`) — they load when Claude Code starts **in `Build 2\halyn-voice`**. TiDB MCP needs `--with "mcp<2"` (already in the config) |
| `.env` set | Bolna key, source IPs, `HALYN_TOOL_SECRET`, numbers A/B, `CUSTOMER_PHONE`, `SPECIALIST_NUMBER`, `HALYN_KEY_ID`, Cloudflare (+ R2 S3), TiDB, Sarvam, `PROBE_ACCESS_CODE` |
| `.env` missing/empty | the `BOLNA_*_AGENT_ID`s (Step 8). Signing key, JWKS, peppers and `SESSION_SECRET` set 2026-10-27 |
| Docker | Installed (29.2.1), unused (ADR-013) |
| ffmpeg | Not installed system-wide. `npm i @ffmpeg-installer/ffmpeg @ffprobe-installer/ffprobe` in a scratch folder works (`ffmpeg-static`'s GitHub download is reset on this network) |

## Scenario status (12)
Gate-level decision + reasons for all 13 (incl. 3b) pass in unit tests (`apps/api/src/gate/scenarios.test.ts`).
| # | Text mode (full runner, Step 7) | Voice | Notes |
|---|---|---|---|
| 1 Freeze card (Hindi) | ☐ | ☐ | |
| 2 Fee waiver | ☐ | ☐ | |
| 3 Clone attack | ☐ | ☐ | hero |
| 4 Coached customer | ☐ | ☐ | hero |
| 5 Assistant in Pass | ☐ | ☐ | |
| 6 Assistant beyond Pass | ☐ | ☐ | |
| 7 Unknown AI, no Pass | ☐ | — | text only |
| 8 Bystander cross-talk | ☐ | — | text only |
| 9 Distress → human | ☐ | — | text only |
| 10 Region US (browser) | ☐ | ☐ | |
| 11 Prompt injection | ☐ | — | text only |
| 12 Velocity split | ☐ | — | text only |

## Next steps (in order)
1. Confirm the chat #2 push is green in CI.
2. From 09:00 IST: Day-0 calls (`docs/DAY0.md` run order). Check 11 = `read-log.mjs` entries `timings_on_request`.
   Afterwards `restricted` on all agents, `list_violations`, COMPLIANCE.md log, results here + DAY0.md, `/pull-call`
   fixtures into `tests/fixtures/bolna` (Step 7 contract tests), then delete the probe + its KV/D1.
3. **Step 7** (api-builder on Opus, then test-engineer on Sonnet) → **Step 8** (bolna-voice-engineer; deploy + agents
   + relink A need go-aheads). **Step 9 in parallel** (web-builder, Sonnet; owns `apps/web` only).
4. Steps 10–20 in order. Step 19 renders the clone's lines in voice C then `atempo=1.25`, name in Devanagari;
   `scripts/clone-clips.ts` should refuse Roman "Saksham" in TTS text.

## Carry into later steps
- Step 6 → Step 7 core client (`apps/api/src/core-client`): read Aero Core errors by `error.details`
  (`CoreOutcomeDetailsSchema`): `E_GRANT_REUSED` on a retry of Halyn's own grant = **executed earlier** (use
  `details.reference`), never "not executed"; 500 with `{outcome:"unknown"}` = reconcile, fail closed to the caller; no
  `details` = nothing written. Bank refusals are 400 `E_BAD_REQUEST` (no dedicated code; Step 7 may add
  `E_CORE_REJECTED` for `core_rejected` ledger entries, with GATE.md). A refused write leaves its grant unused; a read
  consumes its grant even on 404. Write responses carry `reference = "AERO-" + last 6 of the jti`. `POST
  /core/transfers` serves three actions; the grant's `claims.action` picks one. D1 `aero-core` exists only locally
  (`pnpm seed:core`); remote create + id in `wrangler.toml` happen at deploy (Step 8, go-ahead).
- Saksham's name in Devanagari is **सक्षम मिश्रा** (CLAUDE.md §8); every Hindi line/TTS text uses exactly that.
  **Spoken name in calls (Steps 7–8, 10):** `{{customer_name}}` is spoken by Bolna's Sarvam TTS, and Roman "Saksham"
  comes out with a long "Saa". Give customers a spoken form (seed: `सक्षम`) and send it as `customer_name` from
  `lookup_customer` and in outbound `user_data` (Confirm, Assistant); keep the Roman name for screens. Listen for it
  in the Day-0 Confirm call (its `user_data` already uses `सक्षम`).
- Step 5: demo login accepts any `cus_` id (no exists check) → Steps 9–10. Hub RPCs return results; use
  `hub/client.ts` (`hubFor(env, tenant)`), which turns failures into `HalynError`.
- Step 3: `verify_pass` handler passes the call's `tenant_id` to `verifyPassCode` and answers only `{valid:false}`.
  `/web/ledger/verify` anchors to the Hub's `ledger_head` and verifies incrementally (ADR-012; whole-chain verify is
  ~200 ms / 10 000 entries — over the free Workers CPU budget). Aero Core calls `verifyGrant` with
  `expectedSub`/`expectedTenant`; jti single use in the same D1 batch as the write.
- Step 2: with proof `app_session`, check `caller.app_session_customer_id === customer_id` before the Gate; the
  `propose_action` handler passes the **raw** `params` to the Gate; call `toDecision(..., resolution)` only for
  `step_up`; `S_VELOCITY` applies to every action (GATE.md).
- Day-0 facts (docs/DAY0.md): router nodes can't carry event edges → `propose` is an LLM node with
  `function_call: propose_action`; static nodes can't use `{{variables}}`; `execution_id` as a tool variable is
  unconfirmed (check 2 tests it; fallbacks wired); events `POST /v1/call/{run_id}/events` → 202, 404 after the call;
  web calls use `POST /web-call/session` (single use, ~120 s).

## Known issues / notes
- Outbound calls only 09:00–21:00 IST (guardrails, and `call.ts` refuses outside it).
- Toolchain choices and risks: ADR-008. Gate clarifications: ADR-011 / GATE.md. Crypto + ledger anchor: ADR-012.
- `test:scenarios` is still a placeholder (parses scenarios.yaml); the runner is Step 7.
- `db:migrate` / `seed` are real (TiDB); D1: `pnpm seed:core` (local). `compile:packs` runs inside `pnpm build`.
- Action params, tiers and Aero Core routes: `docs/ACTIONS.md` (contract-tested). Four agent-tier actions have no
  Aero Core route; an approval of one becomes a handoff (Step 7).
- Pure-module lint rule covers gate/grants/ledger/pass/shared + the two lexicons (`tests/tooling/eslint-boundaries.test.ts`).
  Don't name files `db.ts`/`bolna.ts`/`hub.ts`/`core-client.ts` inside those folders.
