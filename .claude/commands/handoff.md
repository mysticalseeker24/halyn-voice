---
description: End-of-session handoff — update STATE.md and WORKLOG.md, check docs drift, propose a commit message
---

1. Update `docs/STATE.md`: phase/step, scenario table, Bolna resource ids, deployed URLs, blockers, next step,
   known issues. Set "Last updated" with date/time IST.
2. Prepend a `docs/WORKLOG.md` entry: what changed (files/modules), tests run with counts, decisions, what's next, risks.
3. For each behaviour change in this session, confirm the matching doc was updated (API, GATE, DATA_MODEL, BOLNA,
   UI, COMPLIANCE). Fix any drift.
4. If a trade-off was made, add an ADR with `/new-adr`.
5. Print `git status --short` and a conventional commit message. Do not commit unless Saksham says so.
