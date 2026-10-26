# packages/sdk — @halyn/sdk

What a bank installs. Small, dependency-light, works in Workers, Node 22+ and browsers (WebCrypto only).
- `verifyGrant(token, { jwks, expectedAction, params, now })` → `{ ok: true, jti, claims } | { ok: false, code }`;
  `now` is epoch ms (`Date.now()`); the JWKS may be the object or its JSON string (imported keys are cached per object).
  `expectedAction` is one ActionId or a list (one route serving several actions; the verified one is `claims.action`);
  optional `expectedSub` / `expectedTenant` bind the customer and tenant.
- `proposeAction(client, request)` → typed wrapper for non-Bolna voice platforms (Zod-validated both ways; never throws)
- `verifyLedger(entries)` → `{ ok, entries, head_hash | first_bad_seq }` (the chain rules live in `@halyn/shared`)
- All crypto comes from `@halyn/shared` (`crypto.ts`, `ledger.ts`) so Halyn and the bank verify with the same code.
- ≥ 95% coverage; README with a 10-line integration example (this is the "about 10 lines per endpoint" claim — keep it
  true).
