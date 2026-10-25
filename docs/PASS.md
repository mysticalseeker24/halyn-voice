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
Signed by Halyn (Ed25519, `kid` in header). Verified with Halyn's JWKS.

## Codes
6 random digits from `crypto.getRandomValues`, stored only as `SHA-256(pepper ‖ code)`, single use, 5-minute
expiry, bound to `(pass_id, tenant, calling number)`. Spoken with pauses ("4 7 2 9 1 5").

## Security properties (tested)
- Replay of a used code → `X_PASS_INVALID`. Expired code → invalid. Code from an unlisted number → invalid.
- Out-of-scope action never gains proof. Critical actions are rejected at issue time.
- Five failures → Pass `locked`. Revocation is checked on every verify.

## Roadmap
SIP-header transport between agents on SIP trunks; carrying a Google AP2 intent mandate inside a Pass.
