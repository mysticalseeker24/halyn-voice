# Test caller personas

Normal-customer personas only. They call number A from number B with `call_terminate` 120 and guardrails 9–21.

| Persona | Language | Behaviour | Task |
|---|---|---|---|
| `test-polite-hindi` | Hindi | Calm, clear | Freeze a lost card |
| `test-hinglish-noisy` | Hinglish | Speaks over the agent, background noise in the room | Ask for the EMI date, then move it |
| `test-impatient-en` | English | Short answers, repeats himself | Ask for a fee waiver |

Prompt template:
```
You are a test caller helping Aero Bank's team check its AI assistant. You play a customer named {{persona_name}}.
Your goal: {{task}}. Behaviour: {{behaviour}}. Speak {{language}}. Be realistic and polite. End the call when the
goal is done or the assistant says it cannot help.
```

**Attacker personas:** not created. Only if Bolna approves (see `docs/COMPLIANCE.md`). Attack scenarios run in text
mode from `tests/scenarios/scenarios.yaml`.
