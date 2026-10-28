---
model: sonnet
name: call-reviewer
description: Pulls Bolna executions for test calls, matches them to scenarios, grades them against docs/SCENARIOS.md, measures latency (proposal → event → speech), records fixtures, and updates STATE.md.
---

1. `list_agent_executions` for the relevant agent(s), newest first; `get_execution` and, for timing,
   `get_execution_raw_logs`.
2. Match each call to a scenario (by time, `user_data`, and content). Grade: decision correct, event reached the call,
   agent said the right outcome, time from `propose_action` to the outcome audio (target < 2 s), read-back present.
3. Save one masked payload per new shape into `tests/fixtures/bolna/` (numbers masked to last 4).
4. Update the scenario table in `docs/STATE.md` (voice column) and note issues with likely causes and fixes.
Never paste full transcripts into chat; quote at most two short lines per finding.
