# Pitch deck — Halyn (16 slides, 16:9)

Style: docs/BRAND.md (ink on paper, one cobalt accent, Inter + JetBrains Mono; outcome colours always with their
word). Images: `docs/deck/NN-*.png` from the BRAND.md prompts; real screenshots from `docs/screens/` beat
illustrations on the product slides. Every number is sourced (docs/PRODUCT.md) or measured (README "Real calls").

---

### 1 · Title
- **Message:** Halyn — the permission layer for voice agents.
- **On slide:** wordmark; "Don't trust the voice. Trust the permission."; "Saksham Mishra · Bolna Symphony Buildathon
  2026".
- **Image:** `deck/01-title.png`.
- **Notes:** "Voice agents are starting to act on our money. Halyn decides what they're allowed to do."

### 2 · The problem: three callers
- **Message:** A voice agent that can act can be abused by three kinds of caller — and today's checks fail all three.
- **Bullets:** A **voice clone** — biometrics can be fooled; known details aren't secret. · An **AI assistant** calling
  for a customer — banks can't check its authority. · A **real customer coached by a scammer** — every check passes,
  and they approve any step-up.
- **Image:** `deck/02-three-callers.png`.
- **Notes:** Deepfake fraud attempts +1,300% in 2024 (Pindrop); US consumers reported $12.5B lost to fraud in 2024,
  imposter scams $2.95B (FTC); ~₹120 crore lost to "digital arrest" scams in early 2024 (The Wire).

### 3 · Why voice isn't proof
- **Message:** If a model can copy a voice, a voice can't authorise money.
- **Bullets:** The demo's clone is my own voice (consented, Sarvam instant voice cloning), and it sounds like me. ·
  Liveness and biometric scores can only *raise* risk
  in Halyn, never lower it. · Proof is the registered number (low risk only), a Halyn Pass, or the customer on their
  own device.
- **Image:** `deck/03-voice-not-proof.png`.
- **Notes:** Mention the consented clone used in the demo, labelled every time.

### 4 · The one rule
- **Message:** The agent proposes. Halyn decides. Only Halyn executes.
- **Bullets:** One tool for the agent: `propose_action`. · Four answers: **allow / step-up / hold / deny**, from policy,
  proof and signals. · Execution needs a one-time **Ed25519 grant**: expires ≤ 120 s, bound to the SHA-256 of the
  exact parameters, single use.
- **Image:** `deck/04-propose-decide-execute.png`.
- **Notes:** "Even a jailbroken agent can't move money: it holds no tool that executes anything."

### 5 · Demo
- **Message:** Real calls, one product.
- **On slide:** the submission video (2:55) embedded; fallback link.
- **Notes:** Play it; if time is short, start at 1:00 (the clone).

### 6 · Step-up across two devices
- **Message:** Risky requests from an unproven caller go to the real customer, on their own device.
- **Bullets:** Passkey sheet in the bank app *and* a callback to the registered number; first answer wins. · The sheet
  shows the exact action ("Send ₹45,000 to a NEW payee, account ending 4471") and a safe-account warning. ·
  Unanswered in 60 s → denied.
- **Image:** `docs/screens/real-call-step-up-approval-sheet.png` (real call) or `deck/05-step-up.png`.
- **Notes:** The clone can sound perfect; it still can't answer my phone.

### 7 · The coached victim gets a human
- **Message:** When the customer is being coached, a step-up is useless — so Halyn holds and hands over to a person.
- **Bullets:** Coaching cues ("verification account", "don't tell anyone", a third party giving instructions): a
  keyword layer plus a Sarvam LLM check. · Score ≥ 0.6 → **hold**, never step-up. · The agent explains kindly,
  offers a specialist; a handoff with the transcript and a check-in call is scheduled.
- **Image:** `docs/screens/real-call-4-coached-held-stage.png` (real call: HELD, `S_COACHING`).
- **Notes:** This is the case authentication alone can't solve.

### 8 · Halyn Pass — permission for AI assistants
- **Message:** Your AI assistant gets exactly what you allowed, and nothing more.
- **Bullets:** A signed, scoped Pass: which actions, how many times, until when, from which number. · Spoken on the
  call as a one-time six-digit code, checked against Bolna's telephony record. · Critical actions can never be in a
  Pass; five wrong codes lock it; revoke any time.
- **Image:** `docs/screens/assistant-pass-card.png` or `deck/07-pass.png`.
- **Notes:** Agent-to-agent calls are coming (assistants that call companies for consumers are already funded).

### 9 · Grant and ledger
- **Message:** Every decision is provable afterwards.
- **Bullets:** The bank's core rejects any write without a valid Halyn grant (401 on a forged or replayed one). ·
  Append-only, hash-chained ledger: `hash = SHA-256(prev ‖ entry)`; one click verifies the chain. · Fail closed: any
  error on a write path → deny, and the caller still hears a polite outcome.
- **Image:** `docs/screens/console-ledger-real.png` or `deck/08-grant-ledger.png`.

### 10 · Architecture — how Bolna and Sarvam are used
- **Message:** A drop-in layer between the voice agent and the bank.
- **Bullets:** **Bolna:** graph voice agents (Aero, Halyn Confirm, the Assistant), custom-function tools, outcomes
  injected into the live call as events, Web Call SDK for the US, Vobiz numbers. · **Sarvam:** speech-to-text and
  text-to-speech (and the consented voice clone for the demo), plus the coaching check. · **Halyn:** Cloudflare
  Workers + a Durable Object hub (ordering, timers, WebSockets), TiDB as the system of record, Next.js apps on Vercel.
- **Image:** `apps/web/public/pipeline.png` or `deck/09-architecture.png`.

### 11 · Results
- **Message:** It works on real calls, and every rule has a test.
- **Bullets:** Real calls (2026-10-30): card freeze and fee waiver **allowed → executed**; coached ₹4.8 lakh
  **held** (`S_COACHING` 0.95); US $8,000 wire **held** (`P_HUMAN_ONLY_ABOVE_LIMIT`); step-up **declined → denied**,
  bank core never called. · ~2,100 automated tests + 16 end-to-end; every scenario passes in text mode against the
  real Gate. · Actions without a grant: **0** (fill the Run all numbers from the 2026-10-31 daytime run).
- **Image:** the README "Real calls" table as a slide table; `docs/screens/console-calls-real.png`.

### 12 · Market
- **Message:** Every bank, lender and insurer that lets a voice agent act needs a permission layer.
- **Bullets:** First: Indian lenders and fintechs already building on Bolna. · Then: US banks and credit unions
  (browser and app channels first). · Later: any voice or chat agent that acts — insurance claims, telecom,
  utilities.
- **Image:** `deck/10-market.png`.
- **Notes:** No invented market-size numbers: talk about who buys and why now.

### 13 · Business model
- **Message:** Free to build; paid per decision in production.
- **Bullets:** Free builder tier (sandbox, Halyn Test). · Production: platform fee + per decision + per Confirm call.
  · Enterprise: policy packs per regulator, on-prem ledger export, SLAs. (Pricing is a hypothesis to validate with
  pilots.)
- **Image:** `deck/11-pricing.png`.

### 14 · Landscape
- **Message:** Others score callers or test agents; Halyn decides and controls execution, live.
- **Bullets:** Caller scoring for human call centres (Pindrop). · Pre-launch agent testing (Hamming, Cekura). ·
  Guardrails inside the model. · Payment-authorisation protocols for online checkout (Google AP2), not calls. ·
  **Halyn:** live calls, outside the model, with execution control and proof.
- **Image:** `deck/12-landscape.png`.
- **Notes:** Moat: the Pass network, the attack library from Halyn Test and the ledger, and being the default
  permission layer inside Bolna.

### 15 · Roadmap
- **Message:** From one demo bank to the default permission layer.
- **Bullets:** US phone calls (with consent flows). · More policy packs (per regulator) and actions. · Halyn Pass SDK
  for assistant builders. · Liveness providers as signals. · A Bolna marketplace integration: one toggle to put
  Halyn between any agent and its tools.
- **Image:** `deck/13-roadmap.png`.

### 16 · Team and ask · Close
- **Message:** Built solo in a week; looking for pilots.
- **Bullets:** Saksham Mishra — built Halyn end to end (API, policy engine, apps, Bolna agents, tests). · Ask: two
  pilot lenders or fintechs on Bolna; feedback from Bolna's team on making Halyn a default layer.
- **On slide (close):** wordmark · "Don't trust the voice. Trust the permission." · halyn-voice.vercel.app ·
  github.com/mysticalseeker24/halyn-voice · Call Aero: +91 80653 56344.
- **Image:** `deck/14-close.png` or `docs/screens/landing.png`.
