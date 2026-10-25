# STATE — read at the start of every session, update at the end (`/handoff`)

_Last updated: 2026-10-25 22:30 IST by planning session (pre-build)._

## Where we are
- Phase: **Step 0 — repo scaffold** (see `PROMPTS.md`). Nothing built yet.
- Tier target: Tier 1 (scenarios 1, 2, 3 end to end) by **Mon Oct 26, night**.
- Freeze: **Wed Oct 28, 23:59 IST**. Video Oct 29. Post Oct 30. Submit Oct 31.

## Waiting on (blockers outside the code)
| Item | Owner | Status |
|---|---|---|
| Bolna reply on attacker personas + fraud-like demo calls | Saksham (Slack) | Sent? → update here |
| Bolna credits ($40 requested) | Bolna | Pending. Wallet ≈ $4.95 — enough for Day-0 checks only |
| ElevenLabs partner credits ($15) | Bolna | Pending. Sarvam instant cloning (beta) is the plan until then |
| Relink number A from old Kavach listener to the Aero agent | Claude Code, with Saksham's go-ahead | Not done |

## Approvals (from Saksham)
- Attacker persona agents on Bolna: **NOT approved yet** — text mode only.
- Spending: any real call / number / agent creation needs a go-ahead in the session.

## Bolna resources
| Resource | Id / value | Notes |
|---|---|---|
| Number A | +918065356344 · `9a3b9852-ae7e-4b7c-bab9-f1f0bf4b24d2` | linked to OLD agent `1ad15c7b-3483-4c9e-a336-e371ce112b98` (Kavach listener, to retire) |
| Number B | +918065356379 · `b6875116-e8b9-4174-9c71-08a87cd1dc62` | unlinked |
| Aero agent (graph, Hindi/English) | — | to create |
| Aero agent (English, US web) | — | to create |
| Halyn Confirm agent | — | to create |
| Assistant agent | — | to create |

## Deployed
| Thing | URL | Status |
|---|---|---|
| API Worker | — | — |
| Aero Core Worker | — | — |
| Web (Vercel) | — | — |
| TiDB cluster | — | — |

## Scenario status (12)
| # | Text mode | Voice | Notes |
|---|---|---|---|
| 1 Freeze card (Hindi) | ☐ | ☐ | |
| 2 Fee waiver | ☐ | ☐ | |
| 3 Clone attack | ☐ | ☐ | hero |
| 4 Coached customer | ☐ | ☐ | hero |
| 5 Assistant in Pass | ☐ | ☐ | |
| 6 Assistant beyond Pass | ☐ | ☐ | |
| 7 Unknown AI, no Pass | ☐ | — | text only |
| 8 Bystander cross-talk | ☐ | — | text only |
| 9 Distress → human | ☐ | — | text only |
| 10 Region US (browser) | ☐ | ☐ | |
| 11 Prompt injection | ☐ | — | text only |
| 12 Velocity split | ☐ | — | text only |

## Next step
Run **Step 0** in `PROMPTS.md`.

## Known issues / notes
- Outbound calls only between 9:00 and 21:00 IST (calling guardrails). Plan voice work inside that window.
