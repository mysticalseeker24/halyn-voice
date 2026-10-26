# Halyn Pass — protocol spec v0.1 (`halyn-pass/0.1`)

**A Pass is a signed permission a customer gives his AI assistant, presented on a call as a one-time spoken code.**

## Lifecycle
1. **Issue** — in the bank app the customer picks the assistant (name + calling numbers), ticks Pass-eligible
   actions (policy `pass_eligible: true` only), sets limits and expiry (≤ 30 days) and approves with his passkey.
   Halyn signs. Critical actions can never be included.
2. **Hold** — the assistant stores the Pass token (compact JWS, EdDSA).
3. **Present** — on the call, the assistant calls `get_pass_code` with its token and says the 6 digits.
4. **Verify** — the bank agent calls `verify_pass(code)`; Halyn checks hash, expiry (5 min), unused, calling number
   ∈ `assistant.numbers`, Pass active and unexpired. Five failures lock the Pass.
5. **Use** — the Gate treats proof as `pass` for in-scope actions (decrementing `max_uses`); out of scope = no proof.
6. **Revoke** — customer revokes in one tap; effective immediately.

## Pass token claims
```json
{
  "v": "halyn-pass/0.1",
  "pid": "pass_01J...",
  "tenant": "ten_aero",
  "sub": "cus_saksham",
  "assistant": { "name": "Saksham's Assistant", "numbers": ["+918065356379"] },
  "scopes": [
    { "action": "statement.view" },
    { "action": "card.freeze" },
    { "action": "emi.move_date", "max_uses": 1 }
  ],
  "iat": 1761400000, "exp": 1762004800,
  "cnf": { "customer_passkey_sig": "<base64url WebAuthn assertion over SHA-256(canonical claims)>" }
}
```
Signed by Halyn (Ed25519; header `{alg: "EdDSA", kid, typ: "halyn-pass+jwt"}`). Verified with Halyn's JWKS.
Schema: `packages/shared/src/pass.ts` (scopes unique, never a critical action, `exp − iat` ≤ 30 days).

## Codes
6 random digits from `crypto.getRandomValues`, stored only as `SHA-256(pepper ‖ code)`, single use, 5-minute
expiry, bound to `(pass_id, tenant, calling number)`. Spoken with pauses ("4 7 2 9 1 5").

Implementation (`apps/api/src/pass`, pure; the caller loads and stores `passes` / `pass_codes` rows):
- **Randomness** is injected: the Worker passes a WebCrypto rng (`src/platform/crypto-rng.ts`, the only caller of
  `getRandomValues`); digits are drawn by rejection sampling, so every code is equally likely. The pepper
  (`PASS_CODE_PEPPER`, ≥ 16 chars) is required for both minting and verifying.
- **Mint** refuses unless the Pass is active and unexpired and the calling number is one of `assistant.numbers`.
- **Verify** (`verify_pass`) takes the call's tenant and compares the code's hash with every code record of every
  Pass of that tenant listing the calling number (a candidate from another tenant fails closed), then requires, in
  order: the Pass is active (not revoked, locked or past `exp`), the code is unused, unexpired, and
  bound to the calling number (which the Pass still lists). On success the code is marked used.
- **Failures:** every failed attempt adds 1 to `failures` on the matched Pass, or on every Pass listing that number when
  no code matches. The 5th failure sets `status: locked`. Failures are cumulative over the Pass's life (not reset on a
  success). The tool answers only `{valid:false}`; the reason (`replayed`, `expired`, `wrong_number`, `locked`,
  `revoked`, `pass_expired`, `no_match`) is for logs.
- **Token:** `verifyPassToken` checks the JWS (EdDSA, `typ: halyn-pass+jwt`, known `kid`), the claims, expiry and an
  `iat` at most 5 s in the future. A valid token is never enough on its own: revocation and locking live on the row.
- **Revoke** sets `status: revoked` and `revoked_at` once (idempotent); every mint and verify checks the row.

## Security properties (tested)
- Replay of a used code → `X_PASS_INVALID`. Expired code → invalid. Code from an unlisted number → invalid.
- Out-of-scope action never gains proof. Critical actions are rejected at issue time.
- Five failures → Pass `locked`. Revocation is checked on every verify.

## Roadmap
SIP-header transport between agents on SIP trunks; carrying a Google AP2 intent mandate inside a Pass.
