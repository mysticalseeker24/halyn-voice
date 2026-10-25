---
description: Run one scenario — text mode always; voice mode only with go-ahead
argument-hint: <scenario id 1-12> [voice]
---

Scenario: $ARGUMENTS.
1. Text mode: run it through the scenario runner (`pnpm test:scenarios -- --id <n>`) and show the decision, reasons,
   events, ledger entries and pass/fail vs `docs/SCENARIOS.md`.
2. If `voice` was given: check time (09:00–21:00 IST), wallet and Saksham's go-ahead; for scenarios 3/4 set
   `user_data.purpose = "security_demo"`; trigger from the Stage or tell Saksham which phone to dial; then use
   `call-reviewer` to grade the call and `compliance-reviewer` to check violations. Update STATE.md.
