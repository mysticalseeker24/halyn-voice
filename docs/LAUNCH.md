# Launch on X — the 52-second video, the post, the thread

Built for reach: the strongest moment in the first 2 seconds, readable with the sound off, one idea per screen.
Every number has a source (docs/PRODUCT.md); every clip is the real product on a real call. The full judge video is
[`DEMO_SCRIPT.md`](DEMO_SCRIPT.md).

## The X video (52 s)

**Two exports from one edit:** vertical **9:16 (1080×1920)** for the phone feed, square **1:1 (1080×1080)** for the
timeline. Silent-autoplay first: big burned-in captions (Inter Bold, 64 px on 9:16, white with a 70% black box),
decision badges full size, music low (−24 dB) under the real call audio.

**Framing.** The Stage is 16:9, so never show it whole in 9:16. Stack two crops instead: **top half** = the Halyn
Decision panel (badge + reason codes), **bottom half** = the Live call panel or the phone footage. In 1:1, show the
Decision panel over the Live call panel, cropped tight. Corner label **"AI CLONE OF MY OWN VOICE"** whenever the clone
speaks.

| Time | Picture (top / bottom in 9:16) | Audio | Caption (burned in) |
|---|---|---|---|
| 0–2 s | Red **DENIED** badge slams in / clone lines in the call panel | Clone: "I need to send forty-five thousand rupees…" | **A perfect AI clone of my voice just asked my bank for ₹45,000.** |
| 2–5 s | Live call: the clone's request + read-back / label "AI CLONE OF MY OWN VOICE" | Clone + Aero read-back | **Same voice. Different phone.** |
| 5–9 s | **STEP-UP** badge, `S_UNREGISTERED_NUMBER` / registered phone ringing (Halyn Confirm) + approval sheet | Aero: "For your safety, I've sent a confirmation to your registered phone." | **The bank's AI asks the real me, on my own phone.** |
| 9–13 s | **DENIED** `C_DECLINED` / Saksham's thumb on Decline (or "No" on the call) | Saksham: "No." | **I said no. It got nothing. The bank never even saw the request.** |
| 13–20 s | **HELD** `S_COACHING` / Saksham, phone at ear | Saksham: "…to a verification account. The officer said not to tell anyone." | **Harder: it's really me — but a scammer is coaching me.** |
| 20–25 s | **HELD** + "Specialist handoff: open" / Aero's protection line | Aero: "Aero Bank will never ask you to move money to a safe or verification account…" | **A step-up would fail (I'd approve it). So it goes to a human.** |
| 25–31 s | **ALLOWED** `P_PROTECTIVE` / Aero app: card frozen | Saksham: "Please freeze my card." Aero: "Done!" | **Me, asking normally? Instant.** |
| 31–38 s | Pass card / **ALLOWED** `X_PASS_IN_SCOPE` | Assistant: "I'm an AI assistant calling on behalf of सक्षम, with permission." | **My AI assistant gets a Halyn Pass: exactly what I allowed. Nothing more.** |
| 38–45 s | `pipeline.png` crop: PROPOSE → DECIDE → EXECUTE | — | **The voice agent can only propose. Halyn decides. Only Halyn executes.** |
| 45–52 s | End card: Halyn lockup on near-black | — | **Don't trust the voice. Trust the permission.** · halyn-voice.vercel.app |

**Shots needed** (all come from the submission takes in DEMO_SCRIPT.md, no extra calls): take C (clone, with the
phone screen), take D (coached), take A (freeze), take E (Assistant + Pass card), the pipeline figure, the lockup.
Captions as SRT: [`docs/video/x.srt`](video/x.srt).

**Alt text (paste into X's video description):** "Screen recording of Halyn on real phone calls. An AI clone of the
builder's own voice calls a demo bank's AI agent and asks to send ₹45,000 to a new payee; Halyn steps up to the real
customer's phone, he declines, and the request is denied. Then a customer coached by a scammer is put on hold for a
human, a normal card freeze is allowed instantly, and an AI assistant acts within a Halyn Pass. Ends with the tagline
'Don't trust the voice. Trust the permission.'"

## The post — three hook options (pick one; each ≤ 280 characters)

**A — the clone (recommended):**
> A perfect AI clone of my voice called my bank's AI agent and asked for ₹45,000.
>
> It got nothing.
>
> I built Halyn: a permission layer for voice agents. The agent can only propose an action — Halyn decides, and asks
> the real me on my own phone. 🧵

**B — the question:**
> Voice agents at banks can now move money. So who decides what they're allowed to do?
>
> Not the voice. I cloned my own voice and called my bank's AI agent with it.
>
> Here's what happened 👇

**C — the rule:**
> Don't trust the voice. Trust the permission.
>
> Halyn is a permission layer for voice agents: the agent proposes, Halyn decides from policy and proof, and only
> Halyn can execute — with a one-time grant bound to the exact action. Built for the Bolna buildathon 🧵

## The thread (posts 2–7)

**2 — the problem**
> Three callers can abuse a voice agent:
> • a voice clone
> • an AI assistant nobody can verify
> • a real customer coached by a scammer
>
> Deepfake fraud attempts rose 1,300% in 2024 (Pindrop). US consumers reported $2.95B lost to imposter scams in 2024
> (FTC).

**3 — what Halyn does**
> The voice agent has one tool: propose_action.
>
> Halyn answers allow, step-up, hold or deny from policy, proof and signals — never from how you sound.
>
> Only Halyn can execute, with an Ed25519 grant that expires in 2 minutes and is bound to the exact amount and payee.

**4 — the clone (attach a 10 s clip or a Stage screenshot)**
> The clone called from a new number. Voice is never proof, so a new payee needs the real customer: a passkey on my
> phone, or a call to my registered number.
>
> I said no. Denied. The bank's core never even saw the request.

**5 — the coached victim**
> The hardest case: the real customer, being coached.
>
> A step-up fails here — they'd approve it. Halyn spots coaching cues ("verification account", "don't tell anyone")
> and holds the request for a human. No step-up offered.

**6 — Halyn Pass**
> AI assistants will call banks for us.
>
> A Halyn Pass is a signed, scoped permission the assistant speaks as a one-time code. It gets exactly what you
> allowed; anything else comes back to you.

**7 — built with + links**
> Built on @bolna_ai (a graph voice agent, custom functions, live event injection) with Sarvam [handle — confirm]
> for speech and the coaching check. Cloudflare Workers + TiDB, hash-chained ledger.
>
> Try it: halyn-voice.vercel.app
> Code: github.com/mysticalseeker24/halyn-voice

**Tags:** only accounts Saksham confirms. `@bolna_ai` comes from Saksham's own brief; Sarvam's handle is left as
`[handle — confirm]` — check it on X before posting, never guess.

## Posting tips
- **When:** Saturday 2026-10-31, 19:30–21:30 IST (09:00–11:00 ET, so both India and the US morning see it) — or right
  after submission if the buildathon asks for a post by a deadline.
- **Native video** in post 1 (never a YouTube link); the 9:16 export for mobile-first reach, 1:1 if the 9:16 crops
  the badges badly.
- **Links go in the last post**, not the first (link posts reach fewer people); reply to post 1 with "Live demo +
  code ↓" pointing at post 7 if needed.
- **Pin** the thread to the profile for the judging week. Reply to the first comments within the first hour.
- No hashtag stack: at most one (`#VoiceAI`) in post 7, or none.
- Claims stay true: "real phone calls", "an AI clone of my own voice" (consented), "a demo bank" (Aero Bank is
  fictional) — never imply a real bank uses Halyn.
