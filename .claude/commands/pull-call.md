---
description: Show a short timeline of a Bolna call (latest by default) and save a masked fixture
argument-hint: [execution id | latest]
---
> **Speed mode (CLAUDE.md §5) overrides this file:** do the work yourself in the chat — never spawn a subagent. Where it names an agent (`code-reviewer`, `call-reviewer`, …), read that agent's `.claude/agents/<name>.md` only as a checklist.


Target: ${ARGUMENTS:-latest}. Use `call-reviewer`. Show: start time, duration, cost, agent, status; ≤ 15 timeline lines
(`mm:ss heard: …` / `mm:ss said: …` / `mm:ss event: …`); time from `propose_action` to outcome audio. Save the masked
execution JSON to `tests/fixtures/bolna/execution-<id>.json` if it's a new shape.
