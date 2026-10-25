# Recorded Bolna payloads (contract tests)

One JSON file per payload shape seen in real calls: custom-function requests (`tool-<name>.json`), webhook bodies
(`webhook-<status>.json`), execution records (`execution-<id>.json`), event responses. Phone and account numbers masked
to the last 4 digits. Contract tests validate these against the Zod schemas in `packages/shared`; if Bolna changes a
shape, the contract test fails first. Add one the first time you see a new shape (`/pull-call` does this).
