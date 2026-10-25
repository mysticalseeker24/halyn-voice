---
description: Show a short timeline of a Bolna call (latest by default) and save a masked fixture
argument-hint: [execution id | latest]
---

Target: ${ARGUMENTS:-latest}. Use `call-reviewer`. Show: start time, duration, cost, agent, status; ≤ 15 timeline lines
(`mm:ss heard: …` / `mm:ss said: …` / `mm:ss event: …`); time from `propose_action` to outcome audio. Save the masked
execution JSON to `tests/fixtures/bolna/execution-<id>.json` if it's a new shape.
