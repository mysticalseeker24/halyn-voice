# @halyn/sdk

What a bank installs so that its core system only executes actions Halyn has approved. Dependency-light, WebCrypto
only: it runs in Cloudflare Workers, Node 22+ and browsers.

- `verifyGrant(token, { jwks, expectedAction, params, now })` checks the one-time grant Halyn signed for this exact
  action and these exact params. Returns `{ ok: true, jti, claims }` or `{ ok: false, code }` with `E_GRANT_MISSING`,
  `E_GRANT_INVALID`, `E_GRANT_EXPIRED` or `E_PARAMS_MISMATCH`. It never throws.
- `verifyLedger(entries)` re-checks Halyn's hash-chained audit ledger: `{ ok: true, head_hash }` or
  `{ ok: false, first_bad_seq }`.
- `proposeAction(client, request)` lets a voice platform other than Bolna propose an action to Halyn.

## Protecting one endpoint (about 10 lines)

```ts
import { verifyGrant } from '@halyn/sdk';

app.post('/core/cards/freeze', async (c) => {
  const params = await c.req.json();
  const grant = await verifyGrant(c.req.header('x-halyn-grant'), {
    jwks: c.env.HALYN_PUBLIC_JWKS, expectedAction: 'card.freeze', params, now: Date.now(),
  });
  if (!grant.ok) return c.json({ error: { code: grant.code } }, 401);
  await freezeCard(c.env.DB, params, grant.jti); // insert grant.jti into used_grants in the same transaction
  return c.json({ ok: true });
});
```

`verifyGrant` checks, in this order: the grant is present; its JWS is EdDSA, typed `halyn-grant+jwt`, signed by a key
in the JWKS; the claims are valid (`iss: halyn`, `aud: aero-core`, lifetime ≤ 120 s); the action is the route's
action; it was not issued in the future (5 s skew); it has not expired (no leeway); and SHA-256 of the canonical JSON
of `params` equals `params_hash`. Nothing in the payload is trusted before the signature checks out.

**Single use is yours.** The grant's `jti` must be recorded atomically with the write (Aero Core inserts it into its
D1 `used_grants` table in the same batch), so a replayed grant fails with `E_GRANT_REUSED`.

**One route, several actions.** `expectedAction` also takes a list, for a route that executes more than one action
(Aero Core's `POST /core/transfers` serves `transfer.saved`, `transfer.new_payee` and `wire.new`). The grant's signed
`claims.action` must be in the list, and it tells you which one to run; an empty list accepts nothing.

**So is the customer.** Params identify a resource only within one customer (a card's last 4 digits are not unique),
so act on the accounts of `grant.claims.sub`, or pass `expectedSub` (and `expectedTenant` if one core serves several
Halyn tenants) and a grant issued for anyone else is `E_GRANT_INVALID`.

## Checking the ledger

```ts
import { verifyLedger } from '@halyn/sdk';

const result = await verifyLedger(await fetchLedgerExport()); // rows in seq order, from seq 1
if (!result.ok) alert(`ledger tampered from entry ${result.first_bad_seq}`);
```

Each entry's `hash` is `SHA-256(prev_hash ‖ canonical JSON of {seq, tenant_id, type, ref_id, payload, created_at})`,
starting from 64 zeros, so any edited, deleted, reordered or inserted row is found.

A chain cannot, on its own, show that someone with database access rewrote a row *and* re-hashed every row after it,
or cut off the newest rows. Keep a head you received earlier (an export receipt, Halyn's published head) and pass it:
`verifyLedger(rows, { anchor: { seq, hash } })` fails at that seq when the history leading to it changed, and at the
first missing seq when the chain is shorter than the anchor.
