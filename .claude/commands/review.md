---
description: Review the current diff before committing (invariants, security, tests, compliance, docs)
---
> **Speed mode (CLAUDE.md §5) overrides this file:** do the work yourself in the chat — never spawn a subagent. Where it names an agent (`code-reviewer`, `call-reviewer`, …), read that agent's `.claude/agents/<name>.md` only as a checklist.


Run the `code-reviewer` subagent on the current diff, then the `test-engineer` on any gaps it reports. Summarise:
blocking issues, non-blocking issues, and whether it is safe to commit.
