# Build plan (adjusted Oct 25, 22:30 IST)

Freeze **Wed Oct 28, 23:59 IST** · Record Thu Oct 29 · Post Fri Oct 30 · Submit **Sat Oct 31**.
Real outbound calls only 09:00–21:00 IST (calling guardrails). Steps map 1:1 to `PROMPTS.md`.

| When | Steps | Done when |
|---|---|---|
| **Sun Oct 25, night** | 0 scaffold · 1 shared package · 2 Gate + policy compile · 3 grants, ledger, Pass core (all pure, test-first) | `pnpm verify` green; property tests for invariants pass |
| **Mon Oct 26, 09:00** | 4 Day-0 checks (needs go-ahead + wallet) | 12 checks recorded in STATE.md with fallbacks chosen |
| **Mon Oct 26** | 5 API Worker + Hub DO + TiDB · 6 Aero Core + D1 · 7 tools + events + Confirm orchestration · 8 Bolna agents (Aero, Confirm) · 9 web: Aero app + Stage v1 (parallel, `web-builder`) | Scenarios 1–3 pass in text mode; 1–3 voice smoke on number A |
| **Tue Oct 27** | 10 Pass issue + Assistant · 11 coaching, hold, transfer, handoffs · 12 US pack + English agent + web call · 13 Console pages · 14 scenario suite 12/12 | Scenarios 4, 5, 6, 10 voice; 12/12 text |
| **Wed Oct 28** | 15 Halyn Test UI + permission map (+ voice personas if Bolna approved) · 16 e2e + security review · 17 deploy demo env + seed · 18 rehearsal ×2, freeze 23:59 | Definition of done (below) all ticked |
| Thu Oct 29 | 19 record video + 45 s cut + teaser | Video < 3:00 |
| Fri Oct 30 | Post video + thread on X; fixes only | |
| Sat Oct 31 | 20 README, submission | Submitted |

## Tiers and cut order
- **Tier 1 (must):** steps 0–9 → scenarios 1, 2, 3. A complete demo on its own.
- **Tier 2:** steps 10–14 → scenarios 4, 5, 6, 10.
- **Tier 3:** step 15 → Test UI, permission map, voice personas.
- **Stretch:** post-call liveness, SIP-header Pass, WhatsApp alerts via a Bolna workflow, public ledger anchor, Break the Bank page.
- **Cut in this order if late:** stretch → voice personas → region switch (10) → Assistant (5, 6). Never cut 3 or 4.

## Definition of done
- [ ] Scenarios 1–6 and 10 run end to end on real calls (10 via browser), twice in a row, from Stage buttons
- [ ] 12/12 scenarios pass in text mode; coverage thresholds met; `pnpm verify` green in CI
- [ ] Aero agent has no executing tool; Aero Core rejects writes without a valid grant (test + manual curl)
- [ ] Reused/expired/mismatched grants rejected and logged
- [ ] Passkey approval works on Saksham's phone; callback works by voice and keypad
- [ ] Step-up result reaches the live call in < 2 s (Bolna logs)
- [ ] `/web/ledger/verify` passes; editing a row by hand makes it fail
- [ ] All agents `restricted: false`; violations list clean after each session; guardrails 9–21; AI + recording disclosure
- [ ] No secrets in git; fail-closed drill (stop API mid-call → no money moves, clear message)
- [ ] Stage records cleanly at 1080p; README, PASS.md, COMPLIANCE.md, video, live links ready
