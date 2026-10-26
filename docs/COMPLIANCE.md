# Bolna compliance

Halyn is a fraud-prevention product, so some demo calls deliberately sound like fraud. Every part runs inside
Bolna's published rules; where a rule is unclear we ask Bolna first; every test session ends with a violations check.

## What Bolna requires → how we comply
| Requirement (source) | Compliance |
|---|---|
| Content-safety check on every agent; disallowed: scam/fraud behaviour, illegal activity, harmful or misleading info, political, profanity, adult ([FAQ](https://www.bolna.ai/docs/frequently-asked-questions)) | Protective prompts only; detection in code; `restricted` checked after every save |
| Call-level violation flags (content, regulatory, fraud) | Bolna told in advance (Slack, Oct 25); scenario 3/4 calls tagged `purpose: security_demo`, kept few; violations checked after every session |
| Calling hours: India 9–21 and no DND without consent; US 8–21 and prior express consent ([guardrails](https://www.bolna.ai/docs/outbound/calling-guardrails)) | `calling_guardrails: {call_start_hour: 9, call_end_hour: 21}` on all outbound agents; bypass never used; only Saksham's own numbers; US = browser only |
| AI voices are "artificial voices" under US robocall rules (FCC, Feb 2024) | No automated call to any US number |
| Compliance application before buying numbers ([docs](https://www.bolna.ai/docs/compliance-application/introduction)) | Approved; numbers A and B bought |
| No HMAC on tools/webhooks; fixed source IPs ([security](https://www.bolna.ai/docs/concepts/security)) | IP allowlist + `x-halyn-secret` |
| Recordings/transcripts stored by Bolna, US region by default | Synthetic data only |

## Our rules
1. Protective prompts; no real bank/regulator/brand names; no attack lines in any prompt (unless attacker personas are approved).
2. AI + recording disclosure in every greeting; the Assistant says it's an AI calling for Saksham with his permission.
3. Outbound only to numbers Saksham owns.
4. Voice clone = Saksham's own voice, consented, never a Bolna agent voice, labelled in the video.
5. No workarounds around the content check.
6. Tag `security_demo` calls.
7. After every session: `restricted` on all agents + `list_violations`; log below.
8. Never spend wallet, place calls, buy/delete numbers, relink numbers or create agents without Saksham's go-ahead.

## Attacker personas
Status: **awaiting Bolna** (update `docs/STATE.md` when answered).
If approved: name "Halyn Test: authorised security test caller", prompt states QA role against our own Aero agent,
calls only B → A, 2-minute cap, guardrails on; create one, check `restricted` and violations after one call, then the rest.
If declined or no answer by Tue Oct 27: text mode only; Saksham plays the clone and the coached customer.

## Per-session checklist
- [ ] Wallet covers planned minutes (`get_user_info`, cents)
- [ ] Guardrails on outbound agents
- [ ] `restricted: false` on all agents
- [ ] `security_demo` tag on scenario 3/4 calls
- [ ] After: violations list clean; log below

## Session log
| Date | Calls | Agents changed | restricted all false? | Violations | Notes |
|---|---|---|---|---|---|
| 2026-10-26 (Day-0 setup, with go-ahead) | 0 | Created 4 test agents (Aero test graph, Confirm test, Assistant, polite test caller); number A relinked from the old listener (kept) to the Aero test agent | Yes, 4/4 | None (checked 2026-10-27 01:50 IST) | Calls deferred: window closed. Guardrails 9–21 on the 3 outbound agents |
