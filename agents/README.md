# Bolna agent snapshots

Exported agent configurations (JSON), **with every key and secret stripped**. Written by the `bolna-voice-engineer`
before and after each change: `<agent>.<YYYYMMDD-HHmm>.json`, plus `<agent>.current.json` for the live version.
Prompts live in `prompts/` (source of truth); these files record what was actually deployed, so changes can be
diffed and rolled back. `aero.graph.json` is the graph design (nodes, edges, tools) that `scripts/bolna/create-agents.ts` pushes.
