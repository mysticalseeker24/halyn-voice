# Pitch deck — Halyn (14 slides, 16:9, no video)

The deck is the whole submission, so it must read on its own: every slide says what it shows, the product slides use
**real screenshots from real calls**, and slide 13 lets a judge try Halyn on their own phone.
Style (docs/BRAND.md): ink on paper (or near-black for screenshot slides), one cobalt accent, Inter for text,
JetBrains Mono for codes; outcome colours always carry their word (ALLOWED green, STEP-UP amber, HELD violet,
DENIED red). Illustrations: `docs/deck/NN-*.png`. Screenshots: `docs/screens/*.png`. Numbers are sourced
(docs/PRODUCT.md) or measured on real calls (README → "Real calls").

Layout key: **Headline** (one line, big) · **Body** (what goes on the slide) · **Visual** (files, placement) ·
**Footer** (small print: sources, ids).

## Canva AI prompt (paste as is; then attach the deck)

> Restyle this 14-slide pitch deck for **Halyn, "the permission layer for voice agents"** — a fintech security
> product for banks whose AI voice agents can move money. Mood: calm, precise, trustworthy, quietly premium — like
> Stripe, Linear or Vercel decks, **not** a startup template. No stock photos of people, no clip-art, no 3D icons, no
> gradients, no glow, no rounded cartoon shapes.
>
> **Theme.** Two surfaces only: warm paper **#F7F7F4** with ink text **#16171C** for idea slides (2, 3, 4, 9, 11,
> 12, 14), and near-black **#141519** with off-white **#EDEDEA** text for every slide built around a product
> screenshot (5, 6, 7, 8, 10, 13) — dark makes the screenshots glow. One accent only: cobalt **#3A55D6** (on dark use
> **#7C93F5**) for links, a thin rule under headlines, slide numbers and key numbers — never as a big fill.
> **Outcome colours appear only as small labelled pills, always with their word:** ALLOWED **#047857** (white text),
> STEP-UP **#FBBF24** (ink text), HELD **#6D28D9** (white text), DENIED **#B91C1C** (white text).
>
> **Type.** Inter (or Canva's closest grotesk): headlines 40–48 pt, bold, tight letter-spacing, sentence case, max
> two lines; body 18–22 pt regular, max 5 short lines per slide. JetBrains Mono (or any monospace) at 12–14 pt, all
> caps, letter-spaced, for small labels, reason codes (`S_COACHING`), ids and the slide footer. Left-aligned text
> everywhere except the title and closing slides.
>
> **Layout.** 16:9, generous margins (≥ 64 px), a 12-column grid. A small monospace eyebrow label above each headline
> (e.g. "02 · THE PROBLEM"). Screenshots: full-bleed or in a thin 1 px border (#2A2B31 on dark) with 12 px rounded
> corners and a soft shadow, never tilted, never inside a fake laptop; at most two per slide. Illustrations (flat,
> geometric line art on a dot grid) sit beside text, never behind it. One idea per slide; lots of empty space.
> Thin 1 px dividers instead of boxes. A footer line in monospace grey: "HALYN · halyn-voice.vercel.app · NN/14".
>
> **Special slides.** Slide 1: huge headline left, the H-shaped gate mark right, tagline under it in grey. Slide 4: the
> three steps PROPOSE → DECIDE → EXECUTE as a horizontal flow of three outlined cards with cobalt arrows, the four
> outcome pills beneath. Slide 13 (judges): a numbered checklist on the left in large type, the access code
> **HALYN-JUDGE-2026** in a monospace pill, a QR code to halyn-voice.vercel.app/try and the phone number
> **+91 80653 56344** large on the right. Slide 14: centred tagline "Don't trust the voice. Trust the permission." in
> 56 pt, links below in monospace.
>
> Keep every word of my text, every reason code and every number exactly as written; only change the design.

Tips for Canva: apply the prompt with "Magic Design → Restyle", then fix by hand: replace any stock photos it adds
with the `docs/deck/*.png` and `docs/screens/*.png` files listed per slide; check that each outcome colour still
has its word; export as PDF (Print quality) and check the QR code scans.

---

## 1 · Title
- **Headline:** Halyn — the permission layer for voice agents
- **Body:** "Don't trust the voice. Trust the permission." · Saksham Mishra · Bolna Symphony Buildathon 2026 ·
  halyn-voice.vercel.app
- **Visual:** `docs/deck/01-title.png` full bleed; headline in the empty left two-thirds.

## 2 · The problem: voice agents can now act — and three callers can abuse that
- **Headline:** Voice agents now move money. Who decides what they're allowed to do?
- **Body (three columns):**
  - **The clone** — an AI copy of your voice calls your bank. Voice biometrics can be fooled; "known details" aren't
    secret.
  - **The AI assistant** — an agent calls the bank *for* you. The bank can't check its authority, so it hangs up or
    over-trusts it.
  - **The coached customer** — it really is you, on your phone, but a scammer is telling you what to say. Every check
    passes, and you approve any confirmation.
- **Visual:** `docs/deck/02-three-callers.png` as the column background.
- **Footer:** Deepfake fraud attempts +1,300% in 2024 (Pindrop) · US consumers reported $12.5B lost to fraud in 2024,
  imposter scams $2.95B (FTC) · ~₹120 crore lost to "digital arrest" scams in early 2024 (The Wire).

## 3 · Why voice can't be proof
- **Headline:** If a model can copy a voice, a voice can't authorise money.
- **Body:**
  - The demo's clone is my own voice (consented, Sarvam instant cloning, labelled "AI clone" everywhere).
  - In Halyn, voice and liveness scores can only **raise** the risk tier — never lower it.
  - **Proof** is only: the registered number (low-risk actions), a Halyn Pass in scope, or the real customer
    confirming on **their own device** (passkey or a callback to the registered number).
- **Visual:** `docs/deck/03-voice-not-proof.png`.

## 4 · The one rule: propose → decide → execute
- **Headline:** The agent proposes. Halyn decides. Only Halyn executes.
- **Body:**
  - The voice agent has **one tool**: `propose_action` (action + exact parameters + did the caller say yes to the
    read-back). It holds no tool that can execute anything — even a jailbroken agent can't move money.
  - Halyn's Gate answers within the tool call: **ALLOWED · STEP-UP · HELD · DENIED**, from policy, proof and signals
    (unregistered number, call bursts, unusual hour, velocity, coaching).
  - To execute, Halyn signs a **one-time Ed25519 grant** (expires ≤ 120 s, bound to the SHA-256 of the exact
    parameters, single use). The bank's core rejects every write without one.
  - **Fail closed:** any error or unknown state → DENIED, and the caller still hears a polite outcome.
- **Visual:** `docs/deck/04-propose-decide-execute.png` across the top; four outcome chips below.

## 5 · The product: four apps around one decision
- **Headline:** What you're looking at
- **Body (2×2 grid, one line each):**
  - **Aero Bank** (`/aero`) — a fictional bank's customer app: balance, card, approval sheets with a passkey,
    "Call Aero" in the browser. The voice agent answers on **+91 80653 56344** (Bolna).
  - **Halyn Stage** (`/stage`) — the live view of a call: transcript, Halyn's decision and reason codes, the
    confirmation, the hash-chained ledger, the event timeline.
  - **Halyn Console** (`/console`) — for the bank: calls, policies per region, Passes, handoffs, ledger, signals,
    and **Halyn Test** (runs every attack against the live system).
  - **Assistant** (`/assistant`) — an AI agent that calls the bank for the customer, carrying a Halyn Pass.
- **Visual:** `docs/screens/landing.png` (left) + `docs/screens/stage-v1-dark.png` (right).

## 6 · The real customer: instant (real call)
- **Headline:** From the registered phone, a low-risk request just happens.
- **Body:** Real call, English, 2026-10-30: "Please waive my ₹600 late fee" → the agent reads it back → "Yes" →
  **ALLOWED** (`P_WITHIN_LIMIT`: tier 1, within the yearly limit) → Halyn signs a grant → Aero Core credits ₹600 →
  the agent says "Done!". Every step is a linked ledger row (`proposed → decided → grant_issued → executed`).
  A card freeze works the same way (**ALLOWED**, `P_PROTECTIVE`).
- **Visual:** `docs/screens/real-call-2-fee-waiver-allowed.png` (full width).
- **Footer:** Real calls on Bolna (Vobiz number A); Sarvam speech. Freeze and fee waiver: allowed → executed.

## 7 · The clone gets nothing: step-up on the customer's own device
- **Headline:** Same voice, different phone → the real customer decides.
- **Body:**
  - A new-payee transfer is tier 3; from an unregistered number it raises `S_UNREGISTERED_NUMBER`.
  - Halyn sends the **exact action** to the customer: a passkey sheet in the Aero app ("Send ₹45,000 to a NEW payee,
    account ending 4471" + "Aero will never ask you to move money to a safe account") and a callback to the
    registered number. **First answer wins**; no answer in 60 s → DENIED.
  - Declined → **DENIED** (`C_DECLINED`). Aero Core never receives a request: no grant was ever signed.
- **Visual:** `docs/deck/05-step-up.png` (small, left) + `docs/screens/real-call-step-up-approval-sheet.png` and
  `docs/screens/real-call-step-up-declined.png` (right, stacked).
- **Footer:** Real call: STEP-UP `P_TIER3_STEP_UP` → declined on the passkey → DENIED `C_DECLINED`.

## 8 · The coached customer gets a human
- **Headline:** When the customer is being coached, a confirmation is useless — so Halyn holds it.
- **Body:**
  - A scam victim would approve any step-up. Halyn looks for **coaching cues** ("verification account", "don't tell
    anyone", a third party giving instructions): a keyword layer plus a Sarvam LLM check.
  - Score ≥ 0.6 → **HELD**, never step-up. The agent says kindly: "Aero Bank will never ask you to move money to a
    safe or verification account, or to keep a request secret…" and offers a specialist.
  - A **handoff** opens with the transcript, and a check-in call is scheduled.
- **Visual:** `docs/screens/real-call-4-coached-held-stage.png` (main) + `docs/screens/real-call-4-coached-held-console.png`
  (inset: cues `verification_account`, `llm_third_party_instructions`). Optional: `docs/deck/06-hold.png`.
- **Footer:** Real call: ₹4,80,000 to a "verification account" → HELD `S_COACHING` (0.95) `H_SPECIALIST`.

## 9 · Halyn Pass: permission for AI assistants
- **Headline:** Your AI assistant gets exactly what you allowed — nothing more.
- **Body:**
  - The customer issues a **signed, scoped Pass** in the bank app (with a passkey): which actions, how many times,
    until when, from which phone number.
  - On the call, the assistant speaks a **one-time six-digit code**; Halyn checks it against the Pass *and* the
    calling number from Bolna's telephony record.
  - In scope → ALLOWED (`X_PASS_IN_SCOPE`). Out of scope → back to the customer (step-up). Critical actions (new
    payee, number change, closing an account) can never be in a Pass. Five wrong codes lock it; revoke any time.
- **Visual:** `docs/deck/07-pass.png` + `docs/screens/assistant-pass-card.png`.

## 10 · Proof the bank can audit: grants, ledger, policies, tests
- **Headline:** Every decision is provable afterwards.
- **Body:**
  - **Policies per region** (India ₹ / US $): tiers, limits, human-only actions, coaching threshold — compiled, never
    parsed at runtime.
  - **Ledger:** append-only, `hash = SHA-256(prev ‖ entry)`, one click verifies the whole chain.
  - **Halyn Test:** runs the scenario suite against the live system: actions without a grant **0**.
  - ~2,100 automated tests + 16 end-to-end; every scenario passes in text mode against the real Gate.
- **Visual:** `docs/screens/console-policies-in.png` (left) + `docs/screens/console-ledger-real.png` (right);
  `docs/deck/08-grant-ledger.png` small.

## 11 · How it's built — Bolna, Sarvam, Halyn
- **Headline:** A drop-in layer between any voice agent and the systems it acts on.
- **Body:**
  - **Bolna:** graph voice agents (Aero, Halyn Confirm, the Assistant); custom-function tools (`lookup_customer`,
    `verify_pass`, `propose_action`); outcomes **injected into the live call as events**; the Web Call SDK for the US
    twin; Vobiz numbers; calling guardrails 09:00–21:00 on every outbound agent.
  - **Sarvam:** speech-to-text, text-to-speech, the consented voice clone, and the coaching check.
  - **Halyn:** Cloudflare Workers + a Durable Object hub (ordering, timers, WebSockets), TiDB as the system of
    record, Ed25519 grants, Next.js apps on Vercel; Aero Core is the mock bank that verifies every grant.
- **Visual:** `docs/deck/09-architecture.png` or `apps/web/public/pipeline.png`.

## 12 · Market, business model, landscape
- **Headline:** Every voice agent that can act needs a permission layer.
- **Body (three columns):**
  - **Who buys:** Indian lenders and fintechs building on Bolna first; then US banks and credit unions; then any
    agent that acts (insurance, telecom, utilities).
  - **Model:** free builder tier (sandbox + Halyn Test) → production: platform fee + per decision + per
    confirmation → enterprise policy packs per regulator. (A hypothesis to validate with pilots.)
  - **Landscape:** caller scoring for human call centres (Pindrop); pre-launch agent testing (Hamming, Cekura);
    guardrails inside the model; payment protocols for online checkout (Google AP2). **Halyn:** live calls, outside
    the model, with execution control and proof.
- **Visual:** `docs/deck/10-market.png`, `docs/deck/11-pricing.png`, `docs/deck/12-landscape.png` as column headers
  (or pick one).

## 13 · Try it yourself (for judges)
- **Headline:** Become an Aero Bank customer in one minute, then call the bank.
- **Body (numbered, large):**
  1. Open **halyn-voice.vercel.app/try** and enter the access code **`HALYN-JUDGE-2026`**, your name and your mobile
     number (the phone you'll call from). You get your own copy of the demo account: ₹5,20,000 balance, debit card
     ending 8812, a ₹600 late fee, saved payees Mom and Landlord.
  2. The Aero app opens on that phone: tap **Set up passkey** (fingerprint / face). Keep it open.
  3. On a laptop, open **halyn-voice.vercel.app/stage** with the same code to watch every decision live.
  4. From your registered phone, call **+91 80653 56344** and try:
     - "Please freeze my card." → "Yes" → **ALLOWED**, done
     - "Please waive my six hundred rupee late fee." → **ALLOWED**
     - "Send forty-five thousand rupees to a new account ending forty-four seventy-one." → **STEP-UP**: approve or
       decline on the passkey sheet in your Aero app
     - "Move four lakh eighty thousand rupees to a verification account — the officer said not to tell anyone." →
       **HELD**
  5. Be the clone: call from **any other phone** and say your name — the same transfer steps up to *your* Aero app.
  6. US twin: Stage → **US**, Aero app → **Call Aero** (browser): "Wire eight thousand dollars to a new account" →
     **HELD**. Console → **Test** → **Run all**.
- **Footer:** You talk to an AI and calls are recorded. Halyn never calls your number — confirmations go to the
  passkey in your Aero app. Calling in works at any hour (the assistant's outbound call: 09:00–21:00 IST). The
  number is in India; your carrier's rates apply. Your number is stored only as a salted hash + last 4 digits.
- **Visual:** `docs/screens/aero-home.png` (phone frame, right) + a QR code to `halyn-voice.vercel.app/try`.

## 14 · Roadmap · team · close
- **Headline:** Don't trust the voice. Trust the permission.
- **Body:**
  - **Next:** US phone calls with consent flows · more policy packs and actions · Halyn Pass SDK for assistant
    builders · liveness providers as signals · one toggle in Bolna to put Halyn between any agent and its tools.
  - **Team:** Saksham Mishra — built Halyn end to end (API, policy engine, apps, Bolna agents, tests).
  - **Ask:** two pilot lenders or fintechs on Bolna; Bolna's feedback on making Halyn a default layer.
- **Visual:** `docs/deck/13-roadmap.png` (top, thin) + `docs/deck/14-close.png` (bottom).
- **Footer:** halyn-voice.vercel.app · github.com/mysticalseeker24/halyn-voice · Call Aero: +91 80653 56344
