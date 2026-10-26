# STATE — read at the start of every session, update at the end (`/handoff`)

_Last updated: 2026-10-27 01:55 IST, end of chat #1 (Steps 0–3 pushed, Step 5 built, Day-0 set up). New chats start
from `docs/HANDOFF.md`._

## Where we are
- **On `main`, CI green:** Steps 0, 1, 2, 3 (last push `5ea97a5`, CI run 40323732459).
- **Step 5 — done locally, not committed unless the commit list in `docs/HANDOFF.md` is ticked:** API skeleton (env
  validation, error envelope, Bolna guard, HMAC sessions, `/web/session`, `/web/me`, `/ws`), Drizzle schema + migrations
  for all 14 TiDB tables (tenant_id on all), `pnpm db:migrate`, `pnpm seed`, HubDO (ordered ledger lane + TiDB outbox,
  idempotency, confirmations + alarm timeout, WebSockets). `pnpm verify` green incl. the gated TiDB suite (local).
  `wrangler dev` serves `/health` → 200. ADR-013 (TiDB databases, no MySQL container), ADR-014 (Hub design).
- **Step 4 (Day-0) — setup done, calls NOT placed** (the calling window had closed). Run the calls from **09:00 IST
  Tue Oct 27** with `docs/DAY0.md`. Results so far: check 9 ✅, 11 ⚠, 12 ✅ (table below).
- **Schedule:** behind plan (Tier 1 was due Mon night). Freeze **Wed Oct 28, 23:59 IST**. Video Oct 29. Post Oct 30.
  Submit Oct 31. Remaining build order: Day-0 calls → Step 6 (Aero Core) → Step 7 (tools, events, Confirm, scenario
  runner) → Step 8 (real Bolna agents + first real calls) → Steps 9–18 per `PROMPTS.md`.

## Waiting on (outside the code)
| Item | Owner | Status |
|---|---|---|
| Bolna reply on attacker personas + fraud-like demo calls | Saksham (Slack) | Unknown — ask him |
| Bolna credits ($40 requested) | Bolna | Pending. Wallet 992.5 ¢ (≈ $9.93) on 2026-10-26 |
| ElevenLabs partner credits ($15) | Bolna | Pending. Sarvam instant cloning (beta) is the plan |
| GitHub secret `TIDB_TEST_DATABASE_URL` (…/halyn_test) | Saksham decides | Not set → the DB suite skips in CI with a warning (passes locally) |
| Sarvam consent checkbox for the voice clone | Saksham | At clone creation (dashboard; API has no consent field) |

## Approvals (from Saksham) — every one is per session; re-confirm in a new chat
- Attacker persona agents on Bolna: **NOT approved** — text mode only.
- Day-0 go-ahead was given 2026-10-26 (test agents, relink A, probe Worker, calls ≤ 20 billed minutes). Setup done;
  calls not placed. **Ask again before the first call** in the new session, quoting the plan in `docs/DAY0.md`.
- Any real call / number / agent create-update-delete / relink / wallet spend / deploy needs a go-ahead in the session.
- **Commit + push: always ask Saksham at the end of each step** (show the commit split); every push carries 5–8
  commits; verify each commit on its own before pushing (see `docs/HANDOFF.md` → Conventions).

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
| Day-0 probe Worker | `https://halyn-day0-probe.halyn-api.workers.dev` (`tools/day0-probe`) | Live. Cron `* * * * *` — its handler ran once (KV-guarded); **remove the trigger** and delete the probe, KV `halyn-day0-kv` (`e975471ab2274a31b698fd6dbf05414c`) and D1 `halyn-day0-db` after Day-0 (commands in `docs/DAY0.md`) |
| TiDB Starter (ap-southeast-1) | databases `halyn_dev`, `halyn_test` | Both migrated (14 tables). `halyn_dev` seeded with a **test** number `+919000000003` and a throwaway key → re-seed with real values. `halyn` (demo) not created |
This machine's network can't open `*.workers.dev` (Cloudflare anycast times out); read the probe with
`node --env-file=.env tools/day0-probe/read-log.mjs 10` (Cloudflare API).

## Day-0 results so far (full table in `docs/DAY0.md`)
| # | Result |
|---|---|
| 9 | ✅ 4/4 agents `restricted: false` |
| 11 | ⚠ From the probe's cron: TiDB HTTP 2220 / 832 / 654 ms, D1 403 / 170 / 188 ms — over the < 150 ms target. Cron location is Cloudflare's choice (likely not India): **re-measure on a request routed via India** (the inbound call's tool request) before choosing a fallback. Mitigations: Smart Placement, keep TiDB off the 300 ms `propose_action` path (Hub first, TiDB in `waitUntil`), TiDB region |
| 12 | ✅ Sarvam chat from a Worker 687 / 261 ms (< 1.5 s) |
| 6 | Expected ✗: Bolna's DTMF table says Vobiz unsupported → speech-only fallback (still test once) |
| 8 | Clips recorded: `scripts/out/voice/{Take 1,Take 2,Take 3,Consent Clip}.m4a` (AAC, likely 25–35 s each) → trim to 10–15 s, WAV mono 24 kHz, then clone (Sarvam consent tick by Saksham) |
| 10 | Skipped (not approved) |
| 1–5, 7 | Pending the calls |

## Tooling and env (this machine)
| Item | Status |
|---|---|
| pnpm | Repo pins 12.15.0; global pnpm is 9.15.2 and ignores the pin → `npm i -g pnpm@12.15.0` once, or a corepack shim (see HANDOFF) |
| IST time | Git Bash `date` ignores `TZ` (prints UTC). Use `node -e "console.log(new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}))"` |
| MCP | Bolna (connected). Cloudflare + TiDB in `.mcp.json` (git-ignored, pre-approved in `.claude/settings.local.json`) — they load when Claude Code starts **in `Build 2\halyn-voice`**. TiDB MCP needs `--with "mcp<2"` (already in the config) |
| `.env` set | Bolna key, source IPs, `HALYN_TOOL_SECRET`, numbers A/B, `CUSTOMER_PHONE`, `SPECIALIST_NUMBER`, `HALYN_KEY_ID`, Cloudflare (+ R2 S3), TiDB, Sarvam, `PROBE_ACCESS_CODE` |
| `.env` missing/empty | `HALYN_SIGNING_KEY`, `HALYN_PUBLIC_JWKS` (run `pnpm keys:generate halyn-2026-10`), `PASS_CODE_PEPPER`, `SESSION_SECRET`, `PHONE_HASH_PEPPER` (line absent — add it), the `BOLNA_*_AGENT_ID`s |
| Docker | Installed (29.2.1), unused (ADR-013). `ffprobe`/ffmpeg not installed |

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
1. If Step 5 isn't on `main` yet: show Saksham the commit split in `docs/HANDOFF.md`, ask, then commit + push + CI.
2. From 09:00 IST: Day-0 calls (`docs/DAY0.md` run order), re-confirming the go-ahead first; afterwards `restricted` on
   all agents, `list_violations`, log in `docs/COMPLIANCE.md`; record results/fallbacks here. Re-measure check 11.
3. Check 8 (voice clone) with the recorded takes.
4. Secrets: `pnpm keys:generate halyn-2026-10`; add `PASS_CODE_PEPPER`, `SESSION_SECRET`, `PHONE_HASH_PEPPER` (32+
   random chars each, never printed); `apps/api/.dev.vars`; re-seed `halyn_dev` with the real `CUSTOMER_PHONE`.
5. **Step 6** (Aero Core: D1 schema + seed, grant-checked routes, double-spend test), then **Step 7**.

## Carry into later steps
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
- `db:migrate` / `seed` are real (TiDB); D1 migrations arrive in Step 6. `compile:packs` runs inside `pnpm build`.
- Action params, tiers and Aero Core routes: `docs/ACTIONS.md` (contract-tested). Four agent-tier actions have no
  Aero Core route; an approval of one becomes a handoff (Step 7).
- Pure-module lint rule covers gate/grants/ledger/pass/shared + the two lexicons (`tests/tooling/eslint-boundaries.test.ts`).
  Don't name files `db.ts`/`bolna.ts`/`hub.ts`/`core-client.ts` inside those folders.
