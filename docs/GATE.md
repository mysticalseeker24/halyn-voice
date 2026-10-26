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

## Clarifications (2026-10-26, ADR-011)
Where the rules above leave a choice, the Gate does this. Each one is tested.
1. **Before step 1:** an action the region's pack does not offer, params that fail the action's schema, or an amount
   in a currency other than the pack's → `deny` `E_FAIL_CLOSED`.
2. **Reads without proof always deny.** With proof `none` a read (`read: true`) is `deny` `I_NO_PROOF` at every tier,
   never `step_up`; otherwise one extra signal would turn a deny into a step-up (more permissive). Policy packs may give
   tier 0 only to reads and protective actions, so no write can be denied at tier 0 and then stepped up at tier 1.
3. **Every `hold` includes `H_SPECIALIST`**, because every hold creates a handoff to a human.
4. **Reason codes**, unique, in this order: the base-tier code (tier 0 `P_TIER0`, 2 `P_TIER2`, 3 `P_TIER3_STEP_UP`,
   4 `P_TIER4_HOLD_24H`; tier 1 has none; human-only actions have none), every signal that fired, the Pass code, then
   the codes of the rule that decided. When the tier table decides, its row code for the *computed* tier is added
   (same mapping; ≥ 5 → `H_SPECIALIST`; tier 1 → `P_WITHIN_LIMIT` only on an `allow`), plus `P_OVER_LIMIT` when a limit
   is exceeded and `I_NO_PROOF` when proof is `none` and the outcome is not `allow`. Earlier rules add their own code
   (`R_READBACK_NOT_CONFIRMED`, `T_DISTRESS`, `P_HUMAN_ONLY…`, `S_COACHING`, `P_PROTECTIVE`). A fail-closed decision
   carries only `E_FAIL_CLOSED`. Scenario 3: `P_TIER3_STEP_UP, S_UNREGISTERED_NUMBER, P_TIER4_HOLD_24H, I_NO_PROOF`.
5. **Signals** add the pack's weight when their condition holds and are reported whenever it holds, for every action.
   `unregistered_number` is ignored when proof is `app_session` or the channel is `web`.
6. **Distress and the human-only perimeter come before protective** (first match wins as listed), so a distressed
   caller is held even for a card freeze. The distress lexicon is kept narrow (bereavement, self-harm, abuse,
   medical emergency) so ordinary panic about a lost card still freezes it at once.
7. **Pass in scope** needs all three: the action is in the Pass scopes, uses are left (`max_uses` absent = no cap), and
   the pack marks the action `pass_eligible`.
8. **Limits:** over when `counters.amount_minor + amount > limit.amount_minor` or `counters.count + 1 > limit.count`
   (counters cover the current period, supplied by the caller).
9. **After step-up** (`approved`): a new payee above `cap_first_24h_minor` → `hold` with `C_APPROVED`, `P_OVER_LIMIT`,
   `H_SPECIALIST`; else tier ≥ 4 → `allow` with `C_APPROVED`, `P_TIER4_HOLD_24H` and execution after `hold_hours`
   (24 when the pack sets none); else `allow` `C_APPROVED`. `declined` → `deny` `C_DECLINED`; `timeout` → `deny`
   `C_TIMEOUT`. The clock is used only here.

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
  cue adds weight; ≥ 2 strong cues → 0.7. As implemented: quotes are normalised (NFKC, lower-case, punctuation
  removed, Devanagari nukta folded) and each cue counts once; 0 strong cues → 0, 1 → 0.4, ≥ 2 → 0.7 + 0.1 per further
  strong cue; the weak cue (urgency) adds 0.05; capped at 1. So one strong cue plus urgency stays below 0.6. Cues are
  reported by id, never as the caller's words.
- Distress (step 2) comes from `apps/api/src/signals/distress-lexicon.ts`: four narrow categories (bereavement,
  self-harm, abuse, medical emergency) reported by id. Fear about a lost or stolen card is not distress (clarification 6).
- Both lexicon files are pure (ESLint purity rule) and covered at ≥ 95%.
- Layer 2, Sarvam chat model over `caller_quotes` returns `{probability, cues[]}` within 1.5 s; final score =
  max(layer1, layer2). LLM down or slow → layer 1 alone. The lexicon lives in code only, never in a Bolna prompt.
