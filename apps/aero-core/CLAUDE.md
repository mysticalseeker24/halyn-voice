# apps/aero-core — the mock bank (separate Worker + D1)

This is "the bank's system", deliberately separate from Halyn. It must behave like a real core system that only
accepts writes carrying a valid Halyn grant.

- Every route requires `x-halyn-grant`; verify with `@halyn/sdk.verifyGrant(grant, {publicJwks, expectedAction, params})`:
  signature, `exp`, `params_hash` == SHA-256(canonical params), `jti` unused (insert into `used_grants` inside the
  same D1 batch as the write — atomic).
- Errors: 401 with `E_GRANT_MISSING | E_GRANT_INVALID | E_GRANT_EXPIRED | E_GRANT_REUSED | E_PARAMS_MISMATCH`.
- No business rules here beyond balances and basic validation — policy lives in Halyn.
- Seed from `scripts/seed.ts` (deterministic). Integration tests must cover every 401 path and a concurrent double-spend
  of the same grant (only one succeeds).
