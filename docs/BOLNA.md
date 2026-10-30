# Bolna design

Verify every field against Bolna docs before use (`search_docs` / `get_doc` in the Bolna MCP). Where this file
and the docs disagree, the docs win — then update this file.

## Agents
| Agent | Kind | Number | STT · TTS · LLM | Key settings | Tools |
|---|---|---|---|---|---|
| `aero-hi` Aero voice agent | Graph agent, inbound + web | A | Sarvam `saaras:v4` (hi, Hinglish) · Sarvam `bulbul:v4-flash` `simran_enhi_banking_expressive` 1.1× (Saksham's pick, 2026-10-28) · `gpt-5.4-mini` temp 1 | `call_terminate` 600, interruption words 3, endpointing 300 ms, recording on | `lookup_customer`, `verify_pass`, `propose_action`, `check_decision` (fallback), transfer |
| `aero-en` Aero voice agent (US) `f281278d…` | Same graph minus `transfer` | Web only | Sarvam `saaras:v4` en · Deepgram `aura-2` Asteria · `gpt-5.4-mini` temp 1 | Same | `lookup_customer`, `verify_pass`, `propose_action` (channel web, USD) |
| `halyn-confirm` | **Graph**, outbound | B | Sarvam hi/en | speech only (DTMF off), `call_terminate` 120, guardrails 9–21; `ask` → `record` → `bye` (static, `end_call`) on the `recorded` event | `confirm_result` |
| `assistant` Saksham's Assistant | Simple, outbound | B | English | `call_terminate` 180, guardrails 9–21 | `get_pass_code` |
| `test-*` normal personas | Simple, outbound | B | Varies | `call_terminate` 120, guardrails 9–21 | none |

Attacker personas: **not until Bolna approves** (see `docs/COMPLIANCE.md`).

## Aero graph (`agents/aero.graph.json` English IN + `aero-en.graph.json` US, both generated from the Hindi `aero-hi.graph.json` by `make-aero-en.mjs`; prompts in `prompts/aero-*.md`)
`agent_information` = persona + rules (protective, disclose AI, never read secrets, read back every action in digits).

| Node | Type | Job | Edges |
|---|---|---|---|
| (welcome) | `agent_welcome_message` | Devanagari: AI + recording disclosed | starts at `understand` |
| `understand` | llm (start) | `lookup_customer` (+ `claimed_name`); assistant → Pass code → `verify_pass`; collect + read back in digits (one node: fewer routing hops) | LLM edges → `propose`, `transfer` (asks for a human), `goodbye` |
| `propose` | **llm** with `function_call: propose_action` (a router node can't call tools or hold event edges) | Send action, params, `readback_confirmed`, last caller sentences; then "One moment, please." | event edges: `allow`→`working`, `step_up`→`awaiting_confirmation`, `hold`→`protect`, `deny`→`refused` |
| `working` | static | "Done in a moment." | events `done` → `confirmed`, `deny` → `refused` (Aero Core refused, or its outcome is unknown) |
| `awaiting_confirmation` | static, `repeat_after_silence_seconds: 8` | "I've sent a confirmation to your registered phone." | events `approved`→`working`, `denied`/`timeout`→`refused`, `hold`→`protect` (an approval a specialist must complete) |
| `protect` | llm | By `{{reason}}`: coaching → Aero never asks to move money to a safe account; distress → empathy; offer a specialist | LLM → `transfer`, `goodbye` |
| `confirmed` | **llm** (static audio is pre-generated at save, so it can't hold `{{reference}}`) | "Done. Reference {{reference}}." | → `understand` |
| `refused` | static | "I can't do that on this call. A confirmation went to the registered number." | → `understand` |
| `transfer` | `function_call: transfer` | Warm transfer to `SPECIALIST_NUMBER` | end |

Outcome nodes have **only event edges**, so the agent cannot reach them without Halyn.

## Custom functions (verified against Bolna's docs on 2026-10-26; see docs/DAY0.md)
Each tool: `key: "custom_task"` in `api_tools.tools`, and `api_tools.tools_params.<name>` =
`{url: "{API_URL}/tools/<name>", method: "POST", headers: {"x-halyn-secret": …}, param: {...}}` with `%(name)s`
substitution; `scope: "node"` + `nodes` limits a tool to its node. Auto-injected call variables: `agent_id`,
`call_sid`, `from_number`, `to_number` (reference them in the prompt); whether `%(execution_id)s` (our `run_id`)
substitutes is Day-0 check 2. Fallbacks: the tool's `pre_call_webhook_url` / `pre_call_webhook_param` posts the
execution record (its `id` is the run id) before the tool runs, and the agent's `webhook_url` receives status updates.
Keep descriptions short and protective. Requests come only from Bolna's three IPs, with no HMAC.

What the API accepts (Step 7, docs/API.md "How the tools behave"): **send no run id in tool params** (Day-0, 2026-10-28):
a param named `run_id` is refused by Bolna's tool runner ("got multiple values for keyword argument 'run_id'" →
`agent_llm_error`, hang-up), and `%(execution_id)s` is not a tool variable (KeyError → "ERROR CALLING API:
'execution_id'"). The API maps the call by `call_sid` from the execution/pre-call webhooks (ADR-016 fallback), so
**every agent's `webhook_url` must be Halyn's `/webhooks/bolna`** (the Confirm call too). Tool params must also avoid
Bolna's own argument names — `run_id`, `method` (refused: "ERROR CALLING API: 'method'"), and to be safe `url`,
`headers`, `param`: `confirm_result` sends `answer_method`. Then add
`call_sid` to every tool (`"call_sid": "%(call_sid)s"`); `from_number` as `%(from_number)s` (with or without `+`).
**Voice smoke (chat #7):** Bolna pastes each value raw into a quoted JSON template, so no value may contain `"`: the
Aero agents send `params` as `k=v; k=v` and quotes as `a | b`. `propose_action` may send its params as one `params` object, that pair string, or each param under its own name (as the Day-0 agent
does); `readback_confirmed` may be `"true"`/`"false"`; `caller_quotes` may be one string. `lookup_customer` takes
`claimed_name` when the caller says who they are. The tools' `pre_call_webhook_url` and the agent's `webhook_url`
both point at `{API_URL}/webhooks/bolna` (same guard): it maps the call sid to the run id when `%(execution_id)s` does
not substitute. Until Day-0 records real bodies, `tests/fixtures/bolna` holds synthetic ones from these docs.

## Events
`POST https://api.bolna.ai/v1/call/{run_id}/events` with `{ "event": "<name>", "properties": {...} }` and
`Authorization: Bearer <key>` → `202 {"status":"accepted"}`; `404 {"detail":"No active call found for this run_id"}`
once the call has ended. Properties merge into `context_data`, but chat #7 saw them **not** substituted into node prompts (`{{reference}}` reached the LLM as `{reference}`), so no node relies on them. Events wait until the agent
finishes speaking. Static target nodes speak in ~50 ms.
Sent by `apps/api/src/bolna/client.ts` (one retry on a 5xx or network error; a 404 is logged and the decision stands;
synthetic `sid:` run ids are never sent) and, for `timeout`, by the Hub's alarm. `done` carries
`{reference: "AERO-XXXXXX", summary}` — the summary is English with no names or full numbers (the LLM node speaks it in
the caller's language).

## Keypad (superseded: DTMF off on every agent, Day-0 check 6)
`task_config.dtmf_enabled: true`; digits reach the agent as `dtmf_number: <digits>` after `#`. Bolna's docs list DTMF
as **not supported on Vobiz**, which both our numbers use, so the Confirm agent is speech-first (Day-0 check 6).

## Outbound calls
`POST https://api.bolna.ai/call` with `agent_id`, `recipient_phone_number`, `from_phone_number` (B), `user_data`
(`request_id`, action summary, `purpose`). Never `bypass_call_guardrails`.
The Confirm callback (`apps/api/src/confirm/start.ts`): `agent_id` = `BOLNA_CONFIRM_AGENT_ID`, recipient =
`CUSTOMER_PHONE` only, and only when its hash is the customer's registered number; from `NUMBER_B`; only 09:00–21:00
IST; `user_data` = `{customer_name: "सक्षम" (the spoken form, never Roman), action_summary, request_id,
language: "Hinglish"|"English", purpose: "confirmation", timezone: "Asia/Kolkata"}`. If the passkey answers first, the
call is stopped while still queued (`POST /call/{execution_id}/stop`); an answered call's `confirm_result` is recorded
and ignored.

## Web calls
Bolna Web Call SDK (`@bolna/web-call` v3.0.1) in `/aero` ("Call Aero") and for the US region. Our API mints the
session server-side: `POST https://api.bolna.ai/web-call/session {agent_id, user_data}` → a single-use session that
expires in ~120 s; the browser never sees the `bn-` key. As built (Step 12): `POST /web/calls/session` (customer session)
mints for the region's agent (`BOLNA_AERO_AGENT_ID` IN, `BOLNA_AERO_EN_AGENT_ID` US) and registers the mint's `run_id` in
the Hub as that customer's browser call before returning it, so the Gate sees proof `app_session` (scenario 10). A web
call has **no call sid** (Bolna fills `call_sid` and `from_number` with `"None"` and overwrites any LLM value), so the
mint passes `user_data.call_ref` (a Halyn id), the US prompt shows it as `{{call_ref}}`, every US tool has a required
`call_ref` argument, and the API reads it as the call sid (chat #9, call 3e039987). `aero-en`
(`agents/aero-en.graph.json`, generated by `scripts/bolna/make-aero-en.mjs`) is English, USD, the same Sarvam voice
as IN (Deepgram TTS failed to connect, call d63a0f08), web only, with no transfer to a phone.
**Outcome lines are static nodes** (`confirmed`, `protect`, `refused`, …): as LLM nodes after an event they
improvised ("under review"); an allow is sent only as `done`, straight from `propose` (chat #9).

## Tools available
Bolna MCP (in Claude Code): agents, calls, executions, numbers, docs search. The graph-agent tools Bolna documents
(`create_graph_agent`, `update_graph_agent`, `validate_graph_agent`, `send_graph_agent_event`) are not in this
session's MCP, so `scripts/bolna/*.ts` cover them over REST with `BOLNA_API_KEY`: `agent.ts` (create/update/get with
a compliance gate and secret-free snapshots), `numbers.ts`, `call.ts` (owned numbers only, 09:00–21:00 IST),
`events.ts`, `executions.ts`. Every write needs `--yes`.
