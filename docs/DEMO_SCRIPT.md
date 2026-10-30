# Submission video (2:55) — script, shots, subtitles

For the judges and the pitch deck. Arc: **instant for the real customer, useless to a perfect clone, kind to a scam
victim, open to your AI assistant, two countries.** Everything on screen is the real product on real calls (Bolna,
number A); cuts only remove waiting time. The X cut (45–60 s) lives in [`LAUNCH.md`](LAUNCH.md).

**Format:** 1920×1080, 30 fps, MP4 (H.264), < 3:00. Screen: `https://halyn-voice.vercel.app/stage?recording=1`
(controls hidden; Escape shows them), **dark** theme for every Stage and Console shot (the decision colours read
best), **light** for the landing page B-roll. Phone footage: screen recording of the registered phone (Aero app,
Confirm call) placed picture-in-picture, bottom right, 30% width. Narration: Saksham's own voice (VO), recorded
separately and laid over the cut; the real call audio stays underneath at −12 dB with subtitles.

**Cast and kit.** Laptop on the phone hotspot (the home Wi-Fi blocks `*.workers.dev`). *Registered phone* (Saksham's,
…6517): calls in scenarios 1, 2, 4; the Aero app signed in; receives the Confirm callback. *Second phone* (…0400): the
clone's phone in scenario 3, mic held to the laptop speaker. Headphones for the US browser call. Recorder: OBS or the
Windows Game Bar at 1920×1080.

**On every clone moment** the corner label **"AI CLONE OF MY OWN VOICE"** is on screen (white on black, top left,
JetBrains Mono, all caps). Never show: a full phone number, the Bolna dashboard, a terminal, `.env`, or the
Console handoff whose payee names a real regulator (an old test-data row: scroll past it or crop).

---

## Beat sheet (story order)

Agent lines are what the agents really say (fixed lines are exact; LLM lines may vary slightly — subtitle what was
said). "VO" = Saksham's narration.

### 1 · Hook — 0:00–0:12
- **Screen:** Stage, dark, recording mode, mid-call of scenario 3: the Live call panel shows the clone's lines; at
  0:09 the decision flips to **STEP-UP → DENIED**. Corner label "AI CLONE OF MY OWN VOICE".
- **Audio:** the clone clip (real call audio): *"Hi, this is सक्षम मिश्रा. I need to send forty-five thousand rupees
  to a new account."*
- **VO (over the clip's tail):** "That's not me. That's an AI clone of my own voice, asking my bank's AI agent for
  forty-five thousand rupees. Watch what it gets."
- **Caption (burned, centre bottom, large):** "A perfect AI clone of my voice called my bank."
- **B-roll:** none.

### 2 · The problem — 0:12–0:27
- **Screen:** deck image `deck/02-three-callers.png` (three columns: CLONE · AI ASSISTANT · COACHED CUSTOMER), then a
  stats card, light theme, one number at a time:
  - "Deepfake fraud attempts: +1,300% in 2024 — Pindrop"
  - "US consumers reported $12.5B lost to fraud in 2024 — FTC"
  - "~₹120 crore lost to 'digital arrest' scams, early 2024 — The Wire"
- **VO:** "Voice agents are starting to move money. Three callers can abuse that: a voice clone, an AI assistant nobody
  can verify, and a real customer being coached by a scammer."
- **Caption:** the source line under each number (as above).

### 3 · The one rule — 0:27–0:40
- **Screen:** `deck/04-propose-decide-execute.png` (PROPOSE → DECIDE → EXECUTE), then the landing page hero in light.
- **VO:** "Halyn is the permission layer for voice agents. The agent can only propose. Halyn decides, from policy and
  proof, never from how the caller sounds. And only Halyn can execute, with a one-time grant."
- **Caption:** "The agent proposes · Halyn decides · only Halyn executes"

### 4 · The real customer: instant (scenarios 1 + 2) — 0:40–1:00
- **Screen:** Stage (dark). Picture-in-picture: Saksham with the registered phone at his ear. Decision **ALLOWED**
  `P_TIER0 · P_PROTECTIVE`; the Aero app panel flips to "The card ending 8812 is frozen"; ledger rows `proposed →
  decided → grant_issued → executed` appear. Jump cut to the fee waiver: **ALLOWED** `P_WITHIN_LIMIT`, balance +₹600.
- **Call audio (subtitled):**
  - Saksham: "Please freeze my card."
  - Aero: "You'd like to freeze your card ending eight eight one two, is that right?"
  - Saksham: "Yes."
  - Aero: "Done! That's complete, and you can see it in your Aero app."
  - (cut) Saksham: "Please waive my six hundred rupee late fee." … Aero: "Done!"
- **VO (light, between lines):** "From my registered number, for low-risk requests: instant. Allowed by policy,
  executed with a grant, written to the ledger."
- **Caption:** "Real call · registered number · ALLOWED"

### 5 · The clone gets nothing (scenario 3) — 1:00–1:30
- **Screen:** Stage. Corner label "AI CLONE OF MY OWN VOICE". Live call: the clone's request and the agent's read-back.
  Decision **STEP-UP** `P_TIER3_STEP_UP · S_UNREGISTERED_NUMBER`. Halyn Confirm panel: "Send ₹45,000 to a NEW payee …
  account ending 4471 — sent via passkey + callback · first answer wins". PiP: the registered phone rings (Halyn
  Confirm) and the Aero app shows the approval sheet. Saksham declines. Decision → **DENIED** `C_DECLINED`. Hold on the
  ledger: no `grant_issued` row for this request.
- **Call audio (subtitled):**
  - Clone: "I need to send forty-five thousand rupees to a new account." / "The account number ends in forty-four
    seventy-one." / "Yes, that's right, please send it."
  - Aero: "For your safety, I've sent a confirmation to your registered phone. Please stay on the line."
  - Halyn Confirm (on the real phone): "Hello सक्षम, this is Aero Bank's AI security assistant, and this call is
    recorded. A request just came in: send forty-five thousand rupees to a new payee… Do you approve it? Please say
    yes or no."
  - Saksham: "No."
  - Aero (to the clone): "I'm sorry, I can't complete this request on this call."
- **VO:** "Same voice, different phone. Voice is never proof, so a new payee needs me, on my own device: a passkey, or
  a call to my registered number. The clone can't answer my phone. I say no. Denied. The bank's core never even got a
  request."
- **Caption:** "Voice is a signal, never proof." then "DENIED · Aero Core never called"

### 6 · The coached customer gets a human (scenario 4) — 1:30–1:57
- **Screen:** Stage. PiP: Saksham, phone at ear, acting tense. Decision **HELD** `S_COACHING · H_SPECIALIST`, "Specialist
  handoff: open", no Confirm requested. Cut to Console → **Handoffs**: the open handoff (₹4,80,000 to a "verification
  account") with the scheduled check-in call. Console → **Live** row with cues `verification_account,
  llm_third_party_instructions`.
- **Call audio (subtitled):**
  - Saksham: "I need to move four lakh eighty thousand rupees to a verification account. The officer said not to tell
    anyone."
  - Aero: (read-back) … Saksham: "Yes."
  - Aero: "For your protection, this request is on hold. Aero Bank will never ask you to move money to a safe or
    verification account, or to keep a request secret, and no genuine official asks for this on a call. Would you
    like me to connect you to a specialist now?"
  - Saksham: "No, not now."
- **VO:** "The hardest case: it really is me, on my own phone, but someone is coaching me. A step-up would fail here,
  because I'd approve it. So Halyn holds it, tells me kindly why, and hands me to a human with the transcript."
- **Caption:** "Coached → HELD. No step-up offered."

### 7 · My AI assistant, with a Halyn Pass (scenarios 5 + 6) — 1:57–2:17
- **Screen:** `/assistant` (dark): the Halyn Pass card (statement, card freeze, EMI date ×1, 30 days). Task: "Get my
  card statement and move my EMI to the 10th" → **Call with Aero**. Stage: `verify_pass` ✓, **ALLOWED**
  `X_PASS_IN_SCOPE` ×2. Then the assistant asks for a ₹45,000 transfer → **STEP-UP** `X_PASS_OUT_OF_SCOPE ·
  P_TIER3_STEP_UP` → the real phone rings → declined → **DENIED**.
- **Call audio (subtitled):** Assistant: "Hello, I'm an AI assistant calling on behalf of सक्षम, with permission. This
  call is recorded." … reads the six-digit Pass code … Aero: "Done!" (×2) … step-up line.
- **VO:** "AI assistants will call banks for us. Mine carries a Halyn Pass: a signed, scoped permission, spoken as a
  one-time code. It gets exactly what I allowed. Anything more comes back to me."
- **Caption:** "Agent to agent · Halyn Pass · in scope: ALLOWED · out of scope: back to me"

### 8 · Two countries, and Halyn Test — 2:17–2:32
- **Screen:** Stage region switch **IN → US**. Aero app (US twin) → **Call Aero** in the browser: "Wire eight
  thousand dollars to a new account" → **HELD** `P_HUMAN_ONLY_ABOVE_LIMIT`. Cut to Console → **Test** → Run all
  scorecard: **Actions without a grant: 0**, attacks stopped, median `propose_action`.
- **Call audio:** Aero (US): "For your protection, this request is on hold, and a specialist from Aero will call you
  back."
- **VO:** "Two countries, two rulebooks: in the US, the same request is held for a specialist. And Halyn Test runs
  every attack against the live system. Actions without a grant: zero."
- **Caption:** "IN · ₹ · phone  |  US · $ · browser" then "Actions without a grant: 0"

### 9 · How it's built — 2:32–2:47
- **Screen:** `apps/web/public/pipeline.png`, slow zoom; then Console → Ledger → **Verify chain** ✓.
- **VO:** "Built on Bolna: a graph voice agent with one tool, propose action, and every outcome injected into the live
  call as an event. Sarvam for speech and the coaching check. Halyn runs on Cloudflare Workers with a hash-chained
  ledger, and the bank verifies an Ed25519 grant on every write."
- **Caption:** "Bolna · Sarvam · Cloudflare Workers · TiDB · Ed25519 grants · hash-chained ledger"

### 10 · Close — 2:47–2:55
- **Screen:** `apps/web/public/halyn-lockup.png` on near-black; tagline; links.
- **VO:** "Halyn. Don't trust the voice. Trust the permission."
- **On screen:** "halyn-voice.vercel.app · github.com/mysticalseeker24/halyn-voice · Call Aero: +91 80653 56344"

---

## Shot list (recording order, not story order)

Before the session: laptop on the hotspot; check the time is 09:00–21:00 IST (the Confirm callback and the Assistant
call are outbound); Stage open in recording mode, dark, **muted**; Aero app signed in on the registered phone.
"Reset" = Stage → **Demo reset**. "Seed" = `pnpm seed:core --remote --yes` (Claude runs it, or the terminal).

| # | Take | Before it | Record | Notes |
|---|---|---|---|---|
| A | Scenario 1, card freeze | Seed + Reset | Stage + PiP of Saksham | Wait for the greeting to finish before speaking |
| B | Scenario 2, fee waiver | Reset | Stage | One waiver per seed (yearly limit) |
| C | Scenario 3, clone | Seed + Reset | Stage + phone screen (Confirm call, approval sheet) | Second phone, mic to the speaker, clips 1, 2, 3, then 6 after the read-back; decline on the **Confirm call** (say "No"); keep the clone label in the edit |
| D | Scenario 4, coached | Reset | Stage + PiP; then Console → Handoffs, Live | Say "No, not now" to the specialist offer (a yes transfers the call to the specialist number) |
| E | Scenarios 5 + 6, Assistant | Seed + Reset | `/assistant` + Stage + phone screen | Pass `pass_demo` is valid until 2026-11-27; decline the transfer on the Confirm call |
| F | Scenario 10, US browser call | Reset; Stage → US | `/aero` → Call Aero + Stage | Headphones; Stage back to IN afterwards |
| G | Halyn Test, Run all | Seed + Reset | Console → Test → Run all (IN) | Daytime only; Seed again afterwards (it executes real Aero Core actions) |
| H | B-roll | — | Landing (light + dark), Console Policies IN/US, Ledger → Verify chain, pipeline figure | 5–8 s each, slow scroll |
| I | To camera | — | Hook line, close line | Quiet room; phone camera at eye level |
| J | VO | — | All VO lines below in one pass, then pick-ups | Phone voice memo is fine; −16 LUFS |

---

## Subtitles (SRT, burn in; English)

Saved as [`docs/video/submission.srt`](video/submission.srt). Timings follow the beat sheet; nudge them to the final
cut.

---

## Title card and thumbnail
- **Title card (0:00 overlay, 2 s):** "HALYN — the permission layer for voice agents" (small, top left).
- **Thumbnail (1280×720):** left: the red **DENIED** badge, huge; right, two lines in white on near-black:
  "A clone of my voice asked my bank for ₹45,000." / "It got nothing." Bottom-left: the Halyn mark.
- **Video title:** "Halyn — a perfect clone of my voice asked my bank for ₹45,000 (Bolna buildathon)"

## Compliance for the video (check before export)
- The AI + recording disclosure is audible in every call greeting, or captioned ("Hello! I'm Aero Bank's AI
  assistant, and this call is recorded").
- "AI CLONE OF MY OWN VOICE" on every clone moment; the clone is Saksham's own consented voice.
- No real bank, regulator or brand names on screen (Aero Bank is fictional); crop the old test-data handoff.
- Phone numbers only masked (…6517); number A may be shown (it is public on the README).
- No Bolna dashboard, terminal, raw logs or `.env` in any shot (the tool secret appears in Bolna's raw logs).
