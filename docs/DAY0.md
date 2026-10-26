# Day-0 checks — plan, facts, setup and results

Run with Saksham's go-ahead (given 2026-10-26 in the session): test agents created, number A relinked, probe Worker
deployed, calls within a **20-minute cap**. Calls only 09:00–21:00 IST. Measured cost on this account ≈ 3 ¢ per
billed minute (platform 2 ¢ + telephony 0.5 ¢ per 30 s block + LLM ≈ 0.3 ¢); plan at 4 ¢/min.

**Timing:** setup finished at 21:37 IST on 2026-10-26, after the calling window closed (Git Bash's `date` ignores
`TZ` and printed UTC, so the session's earlier "15:20 IST" was really 20:50 IST — use
`node -e "console.log(new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}))"` for IST). **Calls run from
09:00 IST on 2026-10-27.** `scripts/bolna/call.ts` refuses outside the window by itself.

## What exists now (setup done 2026-10-26, no calls placed yet)
| Thing | Id / value | Notes |
|---|---|---|
| Aero test graph agent | `c03d110b-9d59-453b-a899-5cd3eca4f3a9` | `agents/day0/aero-test.graph.json`; card freeze only; `restricted: false` |
| Confirm test agent (outbound) | `e0f05bf4-efd6-463f-93cf-e10b34ffe23b` | `confirm-test.json`; guardrails 9–21; DTMF on (see check 6); `restricted: false` |
| Assistant (content check) | `a4d3d5cf-387b-44e8-bf60-6ca52e2c320c` | `assistant.json`; guardrails 9–21; no tools yet; `restricted: false` |
| Test caller, polite Hindi | `17ad7f4e-2e7a-4f8c-858e-918b8867ecc4` | `persona-normal.json`; normal customer, not an attacker; guardrails 9–21; `restricted: false` |
| Number A +918065356344 | linked to the Aero test agent | the old listener `1ad15c7b-…` is kept, unlinked |
| Number B +918065356379 | not linked | outbound calls only need it as `from_phone_number` |
| Probe Worker | `https://halyn-day0-probe.halyn-api.workers.dev` | `tools/day0-probe`; KV `halyn-day0-kv`, D1 `halyn-day0-db`; secrets set with `wrangler secret bulk` |

Snapshots as Bolna stored them (secrets stripped, numbers masked): `agents/day0/*.created.json`.
**This machine's network blocks Cloudflare's anycast IPs (`*.workers.dev`, even 1.1.1.1 time out), so the probe can't
be opened from here.** Bolna's servers reach it normally. Read what the probe recorded with
`node --env-file=.env tools/day0-probe/read-log.mjs 20` (Cloudflare API; entries hold only masked facts).

## Facts from Bolna's docs that shape the checks
1. **Graph agents** ([intro](https://www.bolna.ai/docs/graph-agent/introduction), [edges](https://www.bolna.ai/docs/graph-agent/edges-and-routing), [full example](https://www.bolna.ai/docs/graph-agent/full-example)):
   config under `tasks[].tools_config.llm_agent` with `agent_type: "graph_agent"` and `llm_config.{agent_information,
   current_node_id, nodes[]}`. Edge types `llm` / `expression` / `unconditional` / `event`. A **router** node "never
   speaks", must not set `prompt`, and "Event edges are not allowed" on it ([router nodes](https://www.bolna.ai/docs/graph-agent/router-nodes)),
   so `propose` is an **LLM node with `function_call: "propose_action"`**. A **static** node's audio "is pre-generated
   … when the agent is saved" ([static nodes](https://www.bolna.ai/docs/graph-agent/static-nodes)), so it cannot carry
   `{{reference}}`: `confirmed` is an LLM node. The graph-agent MCP tools the docs list (`create_graph_agent`,
   `update_graph_agent`, `validate_graph_agent`, `send_graph_agent_event`) are **not** in this session's Bolna MCP;
   `scripts/bolna/*.ts` cover them over REST (`POST /v2/agent` → 201 `{agent_id, state}`; `PUT /v2/agent/{id}`).
2. **Custom tools** ([custom functions](https://www.bolna.ai/docs/tool-calling/custom-function-calls), [variables](https://www.bolna.ai/docs/tool-calling/custom-function-variables)):
   `key: "custom_task"`, `tools_params.<name>` = `{url, method, headers, param}` with `%(name)s` substitution. The
   tool-variable page lists auto-injected `agent_id`, `call_sid`, `from_number`, `to_number`; `execution_id` (our
   `run_id`) is a system variable on the [context page](https://www.bolna.ai/docs/prompting/using-context) but not in
   the tool table. **Check 2 tests `%(execution_id)s` directly**; fallbacks wired into the test agent: the tool's
   pre-call webhook (it posts the execution record, whose `id` is the run id) and the agent's `webhook_url`.
   Requests come only from 13.203.39.153, 13.126.9.249, 13.202.133.53, with no HMAC ([security](https://www.bolna.ai/docs/concepts/security)).
3. **Event injection** ([docs](https://www.bolna.ai/docs/graph-agent/event-injection)): `POST https://api.bolna.ai/v1/call/{run_id}/events`,
   `Authorization: Bearer`, body `{event, properties}` → `202 {"status":"accepted",…}`; after the call
   `404 {"detail":"No active call found for this run_id"}`. Properties merge into `context_data`; events are buffered
   while the agent speaks; a static target speaks in ~50 ms.
4. **Transfer** ([docs](https://www.bolna.ai/docs/tool-calling/transfer-calls)): `transfer_call` tool with
   `call_transfer_number`; SIP-URI transfer is Plivo/SIP-trunk only, a phone-number transfer has no Vobiz restriction listed.
5. **Keypad (DTMF)** ([docs](https://www.bolna.ai/docs/inbound/dtmf)): `task_config.dtmf_enabled`, digits arrive as
   `dtmf_number: <digits>` after `#`. The provider table says **"Vobiz — Currently not supported"**. Both our numbers
   are Vobiz, so check 6 is expected to fail → fallback: speech only (or a Plivo/Twilio number later).
6. **Outbound** ([`POST /call`](https://www.bolna.ai/docs/api-reference/calls/make)): `{agent_id, recipient_phone_number,
   from_phone_number, user_data}` → `{execution_id, status:"queued"}`; `from_phone_number` must be a number bought in
   the account (no inbound link needed). Guardrails come from the agent's `calling_guardrails`, in the recipient's
   timezone ([guardrails](https://www.bolna.ai/docs/outbound/calling-guardrails)). Wait for `completed`, not `call-disconnected`.
7. **Inbound linking**: `POST /inbound/setup {agent_id, phone_number_id}`, `POST /inbound/unlink {phone_number_id}`
   (MCP `setup_inbound_agent` / `unlink_inbound_agent`).
8. **Web Call SDK** ([docs](https://www.bolna.ai/docs/developer-resources/sdks/web-call)): `@bolna/web-call` v3.0.1;
   our backend mints `POST https://api.bolna.ai/web-call/session {agent_id, user_data}` → a single-use session that
   expires in ~120 s; the browser never sees the `bn-` key.
9. **Content check** ([FAQ](https://www.bolna.ai/docs/frequently-asked-questions)): every save is checked; disallowed
   includes scam/fraud behaviour and misleading info; re-save to re-validate. All four Day-0 agents passed.

## Run order (Saksham's phone = `CUSTOMER_PHONE`, second phone = `SPECIALIST_NUMBER`)
Run from Git Bash in the repo root. Every write helper needs `--yes`; numbers come from `.env`.

| # | Check | Who does what | Billed min | Pass if | Fallback |
|---|---|---|---|---|---|
| 1–3 | Graph agent on A; tool sees run id + caller; event moves the graph | Saksham calls **+91 80653 56344** from his phone and says: *"Mera card kho gaya hai, please freeze kar dijiye."* Card digits: *"aath aath ek do"* (8812); on the read-back: *"Haan."* | ~2 | He hears "Thank you, one moment…" ~1 s after "One moment, please", then "Done. Your reference is D0-…"; the probe log shows `run_id_source` | `check_decision` polling; map run id via the pre-call or execution webhook |
| 1, 6 | Confirm on B; keypad | `pnpm exec tsx scripts/bolna/call.ts e0f05bf4-efd6-463f-93cf-e10b34ffe23b customer --from=b '--user-data={"customer_name":"Saksham","action_summary":"Freeze the card ending eight eight one two","request_id":"req_day0_confirm","language":"Hinglish"}' --yes` → his phone rings from B; he presses **1 then #**, and if nothing happens says **"haan"** | ~1.5 | Probe log shows `confirm_result` with `method: keypad` (expected: speech only on Vobiz) | Speech only |
| 4 | Agent to agent B → A | `pnpm exec tsx scripts/bolna/call.ts 17ad7f4e-2e7a-4f8c-858e-918b8867ecc4 a --from=b --yes` (no human; both legs billed) | ~3 | Clean turns for ~60 s and a freeze reference read out | Tune interruption/endpointing; browser fallback |
| 5 | Transfer to a mobile | Saksham calls A and says: *"Mujhe kisi specialist se baat karni hai."* | ~2–3 | The second phone rings and connects | "A specialist will call you" + outbound |
| 7 | Web Call SDK | On a network where `*.workers.dev` opens (e.g. phone on mobile data), open `https://halyn-day0-probe.halyn-api.workers.dev/webcall?code=<PROBE_ACCESS_CODE from .env>`, tap "Call Aero (test)", repeat the card-freeze lines | ~1.5 | Connects and runs the same flow | Workers Paid / callback-only. Passkey-in-Worker CPU is measured in Step 9 |
| 8 | Voice clone | Waiting for Saksham's takes (`docs/VOICE_SAMPLE_SCRIPT.md`) | 0 | Clip sounds like him through a phone | ElevenLabs later |
| 9 | Content check | Done: 4/4 `restricted: false` | 0 | ✅ | — |
| 10 | Attacker persona | **Skipped**: not approved (docs/STATE.md) | — | — | Text mode |
| 11 | TiDB HTTP + D1 from a Worker | Probe cron run (results below) | 0 | Round trip < 150 ms | TiDB Postgres preview / D1 only |
| 12 | Sarvam chat from a Worker | Probe cron run (results below) | 0 | < 1.5 s | Keywords only |

Total ≈ 11–12 billed minutes (≈ 35–50 ¢); stop at 20 minutes. Between calls:
`node --env-file=.env tools/day0-probe/read-log.mjs 10` and `pnpm exec tsx scripts/bolna/executions.ts get <execution_id>`
(ids from the Bolna MCP `list_agent_executions`).

## Results
| # | Result | Evidence |
|---|---|---|
| 9 | ✅ Aero test, Confirm, Assistant, test caller all `restricted: false` | `agents/day0/*.created.json` |
| 11 | ⚠ TiDB HTTP 2220 / 832 / 654 ms, D1 403 / 170 / 188 ms (target < 150 ms). Measured by the cron at 2026-10-26 16:15 UTC; a cron runs where Cloudflare chooses, so re-measure on a request routed via India (the inbound call) before picking a fallback | probe log `timings` (`read-log.mjs`) |
| 12 | ✅ Sarvam chat 687 / 261 ms (< 1.5 s) | probe log `timings` |

## After the session
1. `get_agent` on all five agents: `restricted: false`; `list_violations` clean.
2. Log the calls in `docs/COMPLIANCE.md` → Session log; record outcomes and fallbacks in `docs/STATE.md`.
3. Remove the probe's cron trigger (it already ran once) and, when Day-0 is closed, delete the probe:
   `cd apps/api && node --env-file=../../.env node_modules/wrangler/bin/wrangler.js delete -c ../../tools/day0-probe/wrangler.toml`
   plus `kv namespace delete --namespace-id e975471ab2274a31b698fd6dbf05414c` and `d1 delete halyn-day0-db`.
4. Number A goes to the real Aero agent in Step 8 (go-ahead again); the test agents stay until then.
