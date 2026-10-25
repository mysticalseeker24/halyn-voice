# Gate and policy engine

The Gate is a **pure function**: `decide(request, context, pack, clock) → Decision`. No I/O. All data it needs
(counters, Pass, signals, coaching score) is gathered by the caller and passed in. This makes it deterministic,
fast (< 1 ms CPU) and property-testable.

## Inputs
```ts
type ProposeRequest = {
  tenant_id: string; run_id: string; channel: 'phone' | 'web';
  caller: { from_number?: string; app_session_customer_id?: string; kind: 'human' | 'ai_assistant' | 'unknown' };
  customer_id: string | null;             // from lookup_customer, null if unknown
  action: ActionId;                       // e.g. 'transfer.new_payee'
  params: Record<string, unknown>;        // validated per action by Zod
  readback_confirmed: boolean;            // the agent read the exact details back and heard a clear yes
  caller_quotes: string[];                // last few caller sentences (max 5, max 300 chars each)
};
type GateContext = {
  proof: 'none' | 'registered_number' | 'app_session' | 'pass';
  pass?: { scopes: Scope[]; uses: Record<ActionId, number> };
  counters: { per_action_period: Record<ActionId, { count: number; amount_minor: number }>; transfers_last_10m: number };
  signals: { unregistered_number: boolean; calls_last_hour: number; unusual_hour: boolean; liveness?: number };
  coaching: { score: number; cues: string[] };   // from Signals (keywords + Sarvam LLM)
  distress: boolean;                              // trigger phrases
};
```

## Evaluation order (first match wins)
1. **Readback** — write actions with `readback_confirmed = false` → `deny` `R_READBACK_NOT_CONFIRMED`.
2. **Distress / human-only perimeter** — `distress` → `hold` `T_DISTRESS`; action `perimeter: human_only` → `hold` `P_HUMAN_ONLY`; action with `human_only_above_minor` and amount above → `hold` `P_HUMAN_ONLY_ABOVE_LIMIT`. When several apply, the outcome is `hold` and **every** applicable code is included (scenario 9 expects both `P_HUMAN_ONLY` and `T_DISTRESS`).
3. **Coaching** — `coaching.score ≥ pack.coaching.threshold` (0.6) on any money-moving action → `hold` `S_COACHING`, `H_SPECIALIST`. Never step-up.
4. **Protective** — `protective: true` actions (card freeze) → `allow` `P_PROTECTIVE` with any proof, including none.
5. **Proof** — Pass present: action in scope and uses left → proof `pass` (`X_PASS_IN_SCOPE`); else treat as `none` and add `X_PASS_OUT_OF_SCOPE`. No customer identified and action is not protective → `deny` `I_NO_PROOF` for reads; `step_up` impossible (no one to confirm) → `deny`.
6. **Tier** = action tier + 1 per signal (`unregistered_number`, `calls_last_hour ≥ 3`, `unusual_hour`, `liveness < 0.3` when present, `transfers_last_10m ≥ 2` → `S_VELOCITY`). Signals never lower the tier.
   `unregistered_number` is true only when the calling number matches **neither** the customer's registered number
   **nor** a calling number listed in a valid Pass; it is not counted for `app_session` (browser) calls.
7. **Limits** — over a per-period amount or count limit → at least `step_up` (`P_OVER_LIMIT`).
8. **Tier → outcome**

| Tier | Proof registered_number / app_session / pass-in-scope | Proof none |
|---|---|---|
| 0 | allow (`P_TIER0`) | deny (`I_NO_PROOF`) |
| 1 | allow within limits (`P_WITHIN_LIMIT`) | step_up |
| 2 | allow (`P_TIER2`) | step_up |
| 3 | step_up (`P_TIER3_STEP_UP`) | step_up |
| 4 | step_up, then scheduled 24 h hold (`P_TIER4_HOLD_24H`) | step_up, then hold |
| ≥ 5 | hold (`H_SPECIALIST`) | hold |

9. **Errors** anywhere → `deny` `E_FAIL_CLOSED`.

**Reason codes in a decision** always include: the action's base-tier code (e.g. `P_TIER3_STEP_UP` for a tier-3
action, even if signals raised it further), every signal code that fired, any Pass code, and the code of the rule
that produced the final outcome.

After `step_up`: Confirm sends passkey + callback in parallel. `approved` → allow → grant → execute
(tier 4: schedule after 24 h; new payee above `cap_first_24h_minor` → `hold`). `declined` → deny `C_DECLINED`.
60 s no answer → deny `C_TIMEOUT`.

## Reason codes (complete list lives in `packages/shared/src/reason-codes.ts`)
`P_PROTECTIVE P_TIER0 P_WITHIN_LIMIT P_TIER2 P_TIER3_STEP_UP P_TIER4_HOLD_24H P_OVER_LIMIT P_HUMAN_ONLY
P_HUMAN_ONLY_ABOVE_LIMIT S_UNREGISTERED_NUMBER S_CALL_BURST S_UNUSUAL_HOUR S_LOW_LIVENESS S_VELOCITY S_COACHING
T_DISTRESS H_SPECIALIST X_PASS_IN_SCOPE X_PASS_OUT_OF_SCOPE X_PASS_INVALID I_NO_PROOF R_READBACK_NOT_CONFIRMED
C_APPROVED C_DECLINED C_TIMEOUT E_FAIL_CLOSED E_GRANT_MISSING E_GRANT_INVALID E_GRANT_REUSED E_GRANT_EXPIRED
E_PARAMS_MISMATCH`

## Properties that tests must prove (fast-check)
- Adding any signal never produces a *more permissive* outcome (allow < step_up < hold/deny ordering).
- `coaching.score ≥ threshold` on a money action never yields `step_up` or `allow`.
- Critical actions (`pass_eligible: false`) are never allowed via a Pass.
- `readback_confirmed = false` on a write never yields `allow`.
- The Gate is deterministic: same input → same output.

## Coaching score
- Layer 1, keywords (Hindi, English, Hinglish) from `apps/api/src/signals/coaching-lexicon.ts` — e.g. safe account,
  verification account, officer said, don't tell anyone, digital arrest, RBI account, customs, parcel seized. Each
  cue adds weight; ≥ 2 strong cues → 0.7.
- Layer 2, Sarvam chat model over `caller_quotes` returns `{probability, cues[]}` within 1.5 s; final score =
  max(layer1, layer2). LLM down or slow → layer 1 alone. The lexicon lives in code only, never in a Bolna prompt.
