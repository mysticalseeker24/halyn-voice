# packages/shared — types, schemas, pure helpers (no I/O)

- Zod schemas for every API body, Bolna payload, WebSocket message, policy pack, Pass claims, grant claims.
- `src/` is pure (ESLint purity rule): no `node:` imports, no clock, no randomness. Don't name files `db.ts`,
  `bolna.ts`, `hub.ts` or `core-client.ts` here (the rule blocks importing those names).
- Files: `reason-codes.ts` (single source of all codes; equals the list in docs/GATE.md), `errors.ts` (`HalynError`),
  `ids.ts` (ULID, prefixed ids, E.164, hex, scenario ids), `region.ts`, `money.ts` (integer minor units, ₹ lakh and $
  grouping, parse/format without floats), `canonical-json.ts` (sorted keys, no whitespace — used for hashes and
  signatures), `actions.ts` (ActionId union, strict params per action, money-moving and critical sets),
  `policy-pack.ts` (YAML source schema + normalised compiled schema + `compilePolicyPack`), `pass.ts`, `grant.ts`,
  `jws.ts`, `decision.ts` (outcomes and strictness order), `events.ts` (events injected into calls), `api.ts`
  (tool and web bodies), `ws.ts` (Hub → apps messages), `clock.ts` (`Clock`, `Rng` — injected, never read here),
  `crypto.ts` (the one implementation of base64url, SHA-256, params hash, Ed25519 JWK import and EdDSA compact JWS
  sign/verify — WebCrypto `subtle` only), `mask.ts` (phone/account numbers → last 4), `ledger.ts` (entry schema, chain
  hash, `verifyLedgerChain`).
- Tests: unit + `*.prop.test.ts` (fast-check, fixed seeds) next to the code; contract tests that read the repo's specs
  (docs/GATE.md, policy-packs/*.yaml, tests/scenarios/scenarios.yaml) in `test/`.
- ≥ 95% coverage. Canonical JSON and money get property tests (round-trip, ordering independence, no float drift).
