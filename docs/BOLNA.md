# Bolna design

Verify every field against Bolna docs before use (`search_docs` / `get_doc` in the Bolna MCP). Where this file
and the docs disagree, the docs win — then update this file.

## Agents
| Agent | Kind | Number | STT · TTS · LLM | Key settings | Tools |
|---|---|---|---|---|---|
| `aero-hi` Aero voice agent | Graph agent, inbound + web | A | Sarvam `saaras:v4` (hi, Hinglish) · Sarvam `bulbul:v3` · `gpt-5.4-mini` temp 1 | `call_terminate` 600, interruption words 3, endpointing ~500 ms, recording on | `lookup_customer`, `verify_pass`, `propose_action`, `check_decision` (fallback), transfer |
| `aero-en` Aero voice agent (US) | Same graph | Web only | Sarvam English · English voice | Same | Same |
| `halyn-confirm` | Simple, outbound | B | Sarvam hi/en | keypad input on, `call_terminate` 120, guardrails 9–21 | `confirm_result` |
| `assistant` Saksham's Assistant | Simple, outbound | B | English | `call_terminate` 180, guardrails 9–21 | `get_pass_code` |
| `test-*` normal personas | Simple, outbound | B | Varies | `call_terminate` 120, guardrails 9–21 | none |

Attacker personas: **not until Bolna approves** (see `docs/COMPLIANCE.md`).

## Aero graph (`agents/aero.graph.json`, prompts in `prompts/aero-*.md`)
`agent_information` = persona + rules (protective, disclose AI, never read secrets, read back every action in digits).

| Node | Type | Job | Edges |
|---|---|---|---|
| `greet` | static | "Aero Bank's AI assistant. This call is recorded and protected." | unconditional → `identify` |
| `identify` | llm | `lookup_customer`; if caller says it's an assistant → ask for Pass code → `verify_pass` | LLM edge → `understand` |
| `understand` | llm | Collect request + details; read back in digits; distress / bereavement / legal phrases → `transfer` | LLM edges → `propose`, `transfer` |
| `propose` | router, `function_call: propose_action` | Send action, params, `readback_confirmed`, last caller sentences | event edges: `allow`→`working`, `step_up`→`awaiting_confirmation`, `hold`→`protect`, `deny`→`refused` |
| `working` | static | "Done in a moment." | event `done` → `confirmed` |
| `awaiting_confirmation` | static, `repeat_after_silence_seconds: 8` | "I've sent a confirmation to your registered phone." | events `approved`→`working`, `denied`/`timeout`→`refused` |
| `protect` | llm | Gentle: Aero never asks to move money to a safe account; offer a specialist | → `transfer` |
| `confirmed` | static | "Done. Reference {{reference}}." | → `understand` |
| `refused` | static | "I can't do that on this call. A confirmation went to the registered number." | → `understand` |
| `transfer` | `function_call: transfer` | Warm transfer to `SPECIALIST_NUMBER` | end |

Outcome nodes have **only event edges**, so the agent cannot reach them without Halyn.

## Custom functions (shape to confirm on Day 0 via `search_docs("custom function")`)
Each tool: `POST {API_URL}/tools/<name>`, header `x-halyn-secret`, JSON body with the call's run id and caller number
mapped from Bolna's call context (Day-0 check 2), plus LLM-filled params. Keep descriptions short and protective.

## Events
`POST https://api.bolna.ai/v1/call/{run_id}/events` with `{ "event": "<name>", "properties": {...} }`. Properties
merge into `context_data` (usable as `{{variable}}`). 404 = call ended. Static target nodes speak in ~50 ms.

## Outbound calls
`POST https://api.bolna.ai/call` with `agent_id`, `recipient_phone_number`, `from_phone_number` (B), `user_data`
(`request_id`, action summary, `purpose`). Never `bypass_call_guardrails`.

## Web calls
Bolna Web Call SDK in `/aero` ("Call Aero") and for the US region. Starter templates in Bolna docs
(Developer resources → SDKs → Web Call).

## Tools available
Bolna MCP (in Claude Code): agents, calls, executions, numbers, docs search. If graph-agent or event tools are
missing in your MCP version, use `scripts/bolna/*.ts` against the REST API with `BOLNA_API_KEY`.
