---
description: Run the 12 Day-0 feasibility checks (some place real calls — needs Saksham's go-ahead and 09:00–21:00 IST)
---
> **Speed mode (CLAUDE.md §5) overrides this file:** do the work yourself in the chat — never spawn a subagent. Where it names an agent (`code-reviewer`, `call-reviewer`, …), read that agent's `.claude/agents/<name>.md` only as a checklist.


Use the `bolna-voice-engineer` subagent for Bolna steps. Before any real call: state the expected minutes and cost,
check the wallet (`get_user_info`, cents) and get Saksham's go-ahead.

| # | Check | Pass if | Fallback |
|---|---|---|---|
| 1 | Relink number A to a test Aero graph agent; number B on a test Confirm agent | both ring their agents | browser calls |
| 2 | Custom function receives run id + caller number | `propose_action` sees both | map via call-start webhook |
| 3 | Event injection moves the graph, agent speaks | static line ≈1 s after `POST /v1/call/{run_id}/events` | `check_decision` polling |
| 4 | Agent-to-agent call B → A | clean turns for 60 s | tune interruption/endpointing; browser fallback |
| 5 | Call transfer to a mobile | specialist phone rings | "specialist will call you" + outbound |
| 6 | Keypad on outbound Confirm call | 1/2 reaches the agent | speech only |
| 7 | Web Call SDK + passkey verified inside a Worker | connects; verify within CPU budget | Workers Paid; callback-only |
| 8 | Sarvam instant voice cloning | clips sound like Saksham through a phone | ElevenLabs later |
| 9 | Content check on Confirm, Assistant, normal personas | `restricted: false` | reword |
| 10 | One attacker persona — ONLY if STATE.md records Bolna approval | restricted false, no violation after 1 call | text mode |
| 11 | TiDB HTTP driver + D1 from Workers | round-trip < 150 ms | TiDB Postgres preview / D1 only |
| 12 | Sarvam chat model from a Worker | score < 1.5 s | keywords only |

Record results and chosen fallbacks in `docs/STATE.md`, log calls in `docs/COMPLIANCE.md`, then `/handoff`.
