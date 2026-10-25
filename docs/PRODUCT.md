# Product

**Halyn is the permission layer for voice agents.** The agent can only propose an action; Halyn decides whether it
happens; for anything risky the real customer confirms on his own device. *Don't trust the voice. Trust the permission.*

## Problem
Voice agents at banks and fintechs are starting to act (waive fees, move EMIs, send money, change phone numbers).
Three callers can abuse that:

| Threat | Why existing checks fail | Halyn |
|---|---|---|
| Impersonator with a cloned voice | Biometrics can be fooled; known details aren't secret | Voice is only a signal; risky actions need a passkey on the customer's device or a callback to the registered number |
| AI assistant calling for a customer | Banks hang up or can't check authority | Halyn Pass: signed, scoped permission, spoken as a one-time code |
| Real customer coached by a scammer | All checks pass; a step-up gets approved | Coaching signals → hold + human specialist |

Evidence (for slides and README): deepfake fraud attempts up 1,300% in 2024 (Pindrop); US consumers reported $12.5B
lost to fraud in 2024, imposter scams $2.95B (FTC); about ₹120 crore lost to "digital arrest" scams in early 2024
(The Wire); Pine raised $25M for AI agents that call companies for consumers. Links in the planning doc.

## Parts
| Part | Does |
|---|---|
| Gate | Decides allow / step_up / hold / deny from policy, proof, signals (`docs/GATE.md`) |
| Confirm | Passkey prompt in the bank app + callback to the registered number; result pushed into the live call |
| Pass | Protocol for AI assistants (`docs/PASS.md`) |
| Signals | Unregistered number, call bursts, unusual hour, velocity, coaching score, optional liveness |
| Ledger | Hash-chained record of every request, proof, decision, grant |
| Test | Simulated callers and attacks (text mode always; voice on Bolna), regression on every agent change, permission map |
| Handoffs | Queue of held / human-only requests with transcript; release or block |

## Customers and business
Banks, lenders, fintechs, insurers whose voice agents can act. First: Indian lenders/fintechs on Bolna; then US.
Pricing hypothesis: free builder tier; platform fee + per decision + per Confirm call. Competition: Pindrop (caller
scoring for human centres), Hamming/Cekura (pre-launch testing), guardrail tools (inside the model), Google AP2
(online payments, not calls). Moat: Pass network, attack data in the Ledger/Test library, default layer inside Bolna.

## Demo company
Aero Bank (fictional): India (₹, real calls on number A) and US ($, browser calls only). Customer: Saksham Mishra.
See `docs/SCENARIOS.md` and `docs/DEMO_SCRIPT.md`.
