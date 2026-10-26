# Bolna agents

Agent definitions we push and snapshots of what Bolna stored, **with every key and secret stripped** and phone numbers
masked. Prompts live in `prompts/` (source of truth); push with `scripts/bolna/agent.ts` (compliance-gated).

- `day0/` — Day-0 test agents (`docs/DAY0.md`): `aero-test.graph.json`, `confirm-test.json`, `assistant.json`,
  `persona-normal.json` (definitions with push-time placeholders) and `*.created.json` (what Bolna stored, 2026-10-26).
- Real agents (Step 8): `aero.graph.json` etc., with `<agent>.<YYYYMMDD-HHmm>.json` snapshots before and after each
  change, plus `<agent>.current.json` for the live version.
