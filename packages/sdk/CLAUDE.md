# packages/sdk — @halyn/sdk

What a bank installs. Small, dependency-light, works in Workers, Node 20 and browsers (WebCrypto only).
- `verifyGrant(token, { jwks, expectedAction, params, now })` → `{ ok: true, jti } | { ok: false, code }`
- `proposeAction(client, request)` → typed wrapper for non-Bolna voice platforms
- `verifyLedger(entries)` → first bad `seq` or ok
- Fully unit- and property-tested; README with a 10-line integration example (this is the "about 10 lines per endpoint" claim — keep it true).
