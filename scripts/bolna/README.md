# Bolna REST helpers

For what the Bolna MCP in Claude Code lacks (graph agents, event injection) and for anything we want typed, gated and
masked. All read `BOLNA_API_KEY` (and numbers) from `.env`, print masked output, and refuse every write without
`--yes` (`--dry-run` prints the request without the key). Run from the repo root with `pnpm exec tsx`.

| Script | Does | Guards |
|---|---|---|
| `agent.ts create <file> \| update <id> <file> \| get <id> [--out=…]` | Create/update agents from `agents/**.json` (graph or simple); snapshot with secrets stripped | Compliance gate: AI + recording disclosure, guardrails 9–21 on outbound, temperature 1 on GPT-5, no banned wording, no `bypass_call_guardrails`; push-time placeholders `{{PROBE_URL}}`, `{{HALYN_TOOL_SECRET}}`, `{{SPECIALIST_NUMBER}}` |
| `call.ts <agent_id> <customer\|specialist\|a\|b> [--from=b] [--user-data=json] [--purpose=security_demo]` | Outbound call (`POST /call`) | Only Saksham's / our numbers; 09:00–21:00 IST; timezone set; never bypasses guardrails |
| `events.ts <run_id> <event> [json]` | Inject an event into a live graph-agent call | UUID run id, lower_snake_case event |
| `numbers.ts link <number_id> <agent_id> \| unlink <number_id>` | Inbound linking | Needs Saksham's go-ahead (CLAUDE.md §3); never deletes the old agent |
| `executions.ts get <id> [--out=…]` | Status, cost, transcript, tool calls, latency | Numbers masked |

Pure parts are tested in `tests/tooling/bolna-helpers.test.ts`. Day-0 usage: `docs/DAY0.md`.
