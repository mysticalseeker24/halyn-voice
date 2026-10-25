# Bolna REST helpers

Use these when the Bolna MCP in Claude Code lacks a capability (for example graph agents or event injection).
All read `BOLNA_API_KEY` from env and print masked output. None of them place calls or spend credit unless run with
`--confirm`.

Planned (built in Steps 4 and 8):
- `create-agents.ts` — create/update agents from `agents/*.json` + `prompts/*.md`; verifies `restricted: false`.
- `send-event.ts <run_id> <event> [json]` — `POST /v1/call/{run_id}/events` (Day-0 check 3).
- `call.ts <agent> <to> [--purpose security_demo] --confirm` — outbound call from number B; refuses non-owned numbers.
- `violations.ts` — list violations (used by `/compliance-check`).
