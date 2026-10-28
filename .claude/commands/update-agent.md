---
description: Push a prompt or graph change from prompts/ or agents/ to a Bolna agent and verify it
argument-hint: <agent: aero-hi | aero-en | halyn-confirm | assistant | test-*> [what to change]
---
> **Speed mode (CLAUDE.md §5) overrides this file:** do the work yourself in the chat — never spawn a subagent. Where it names an agent (`code-reviewer`, `call-reviewer`, …), read that agent's `.claude/agents/<name>.md` only as a checklist.


Use the `bolna-voice-engineer` subagent. Agent: $ARGUMENTS.
1. If a change is described, edit the source file first (`prompts/*.md` or `agents/*.json`) and show the diff.
2. Snapshot the live config to `agents/` (keys stripped). 3. Push. 4. `get_agent` → verify `restricted: false`,
text matches, temperature 1, guardrails (outbound), disclosure. 5. Run the `compliance-reviewer` checks for this agent.
6. Say which scenario to re-test.
