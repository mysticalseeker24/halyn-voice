# Recorded Bolna payloads (contract tests)

One JSON file per payload shape seen in real calls. The contract test
(`apps/api/test/contract/bolna.contract.test.ts`) picks the schema by the file-name prefix, so a new file needs no
code change:

| Prefix | What | Checked against |
|---|---|---|
| `tool-<name>[-variant].json` | a custom-function request body (`<name>` = the tool) | `normalizeToolBody` + the tool's request schema (`packages/shared`), then the real API answers it |
| `webhook-<status>.json`, `execution-<id>.json` | an execution record (agent webhook, pre-call webhook, `GET /executions/{id}`) | `BolnaExecutionSchema` |
| `call-<status>.json` | `POST /call` response | `BolnaCallResponseSchema` |
| `event-<result>.json` | `POST /v1/call/{run_id}/events` response; `_http` is the status | `BolnaEventAcceptedSchema` (202) / `BolnaEventRefusedSchema` (404) |
| `stop-<status>.json` | `POST /call/{execution_id}/stop` response | `BolnaStopResponseSchema` |

Keys starting with `_` are metadata, never part of the payload. Files marked `"_source": "synthetic-from-docs"` were
written from Bolna's documented shapes before the Day-0 calls; replace each with a real recording (`/pull-call`) and
drop the marker. Phone numbers are masked to the last 4 digits (`••••0003`); the test turns a masked number back into
a `+91900000xxxx` test number. If Bolna changes a shape, the contract test fails first.
