# UI

One Next.js project (`apps/web`) with four route groups. All live data via the Hub WebSocket; REST for actions.

| App | Route | For | Must show |
|---|---|---|---|
| Landing | `/` | Everyone | What Halyn is, the four apps, "Call Aero Bank"; top bar: **Try Halyn** (`/try`, visible on phones too) and **Open the Stage** |
| Try Halyn | `/try` | Judges | Access code, name, mobile number (10 Indian digits get +91) → `POST /web/judges/signup` → the Aero app as their own customer; what to try next; privacy line (hash + last 4, never called). Spec: docs/JUDGES.md |
| Halyn Stage | `/stage` | Video, judges | Scenario buttons (1–4, more, region IN/US), Aero app panel, live call transcript, Confirm panel, Halyn decision (request, tier, signals, outcome badge), ledger lines + "chain verified", event timeline. Dark mode. Never scrolls during a scenario |
| Halyn Console | `/console/*` | Bank teams | Live, Calls, Policies, Passes, Test, Signals, Ledger, Handoffs, Integrations |
| Aero Bank app | `/aero/*` | Customer on phone | Home (balance, activity, card, loan), approval sheet (exact action, Approve with passkey / Decline, "Aero will never ask you to move money to a safe account"), alerts, Assistant access (issue/revoke Pass), Call Aero (web call), Hindi/English toggle |
| Saksham's Assistant | `/assistant` | Customer's AI | Task box, Pass as a boarding-pass card, live agent-to-agent transcript, outcome |

## Brand and style
- Halyn: ink on off-white (dark on Stage), one electric-indigo accent; outcome colours green ALLOWED, amber
  STEP-UP, violet HELD, red DENIED — always with the word. Inter + JetBrains Mono (ids, hashes).
- Aero Bank: sky blue + white with a coral highlight, rounded cards, phone layout (max-width 420 px).
- Assistant: minimal chat; the Pass card is the shareable element.
- Motion only on state change, < 300 ms. WCAG AA contrast, 44 px tap targets.
- Stack: Tailwind, shadcn/ui, Framer Motion, `@simplewebauthn/browser`, Bolna Web Call SDK.

Mock-ups: see the planning doc (Screens tab).
