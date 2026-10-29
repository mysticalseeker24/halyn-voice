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
   Created 2026-10-27 via Sarvam's API (`POST /voices/create`, which has no consent field), one voice per take
   (`scripts/out/voice/Take N trimmed.wav`), each named "… - AI clone of my own voice": Take A Hinglish `hi-IN`
   `svc-cda5c816-f859-491a-8b39-b426d84e0693`; Take B English `en-IN` `svc-abd98a9c-5310-4583-85b9-bf89dfcaa055`;
   Take C calm Hindi `hi-IN` `svc-90c91242-37e0-4581-ac86-c3def603b9aa`. **Consent record:** Saksham's recorded consent statement
   (`scripts/out/voice/Consent Clip.m4a`, text in `docs/VOICE_SAMPLE_SCRIPT.md`, kept locally, never sent to Sarvam)
   and his choice of the API route in the 2026-10-27 session. Used only for the Step 19 demo clips, labelled
   "AI clone of Saksham's own voice".
5. No workarounds around the content check.
6. Tag `security_demo` calls.
7. After every session: `restricted` on all agents + `list_violations`; log below.
8. Never spend wallet, place calls, buy/delete numbers, relink numbers or create agents without Saksham's go-ahead.

## Demo-only shortcuts (not for production)
- **Demo access code:** anyone holding `DEMO_ACCESS_CODE` can mint a Console session or a session as any demo
  customer (`POST /web/session`). Production would use the bank's own sign-in; the code is shared only with judges
  on request.
- **Dependency audit:** `pnpm audit --prod` reports one low advisory (deepmerge, via the shadcn CLI, a dev-time
  generator; no patched release on 2026-10-30). Not reachable from the deployed Workers or the web bundle.
- **Demo reset:** the Console's "Demo reset" only moves the call-burst window for retakes; it deletes nothing.

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
| 2026-10-28 15:08–15:40 IST (Day-0 calls, with go-ahead) | 11: 5 inbound by Saksham to A (card freeze ×3, transfer, 1 short), 5 outbound Confirm from B to Saksham, 1 agent-to-agent B → A | Aero test + Confirm test: tool params only (no run id; Confirm: DTMF off, question in greeting, no `method` arg) — each with go-ahead | Yes, 4/4 | None (15:45 IST) | Only Saksham's own numbers dialled; all in 09:00–21:00; no fraud-like content; 33.9 ¢ spent (wallet 958.7 ¢) |
| 2026-10-28 23:45 – 10-29 01:00 IST (Step 8/10 setup, with go-ahead) | 0 | Created Aero graph `f02fa07d…`, Halyn Confirm graph `96a6c2a2…`, Saksham's Assistant `29d45c35…` from the protective Devanagari prompts; number A relinked from the Day-0 Aero test agent (kept) to the Aero graph | Yes (3/3, checked with `get_agent`) | None (`list_violations` empty) | Guardrails 9–21 on Confirm + Assistant; DTMF off; no calls placed |
