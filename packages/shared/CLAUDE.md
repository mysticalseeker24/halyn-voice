# packages/shared — types, schemas, pure helpers (no I/O)

- Zod schemas for every API body, Bolna payload, WebSocket message, policy pack, Pass claims, grant claims.
- `reason-codes.ts` (single source of all codes), `money.ts` (integer minor units, formatting per currency, no floats),
  `canonical-json.ts` (sorted keys, no whitespace, stable numbers — used for hashes and signatures), `actions.ts`
  (ActionId union + per-action param schemas), `ws.ts` (message types).
- ≥ 95% coverage. Canonical JSON and money get property tests (round-trip, ordering independence, no float drift).
