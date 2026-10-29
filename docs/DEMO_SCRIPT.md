# Demo script (3:00)

Arc: fast for the real customer, useless to a perfect clone, kind to a scam victim, open to your AI assistant, global.
Recorded from the Stage; Saksham's phone filmed beside the screen.

| Time | Scenario | On screen | Line |
|---|---|---|---|
| 0:00–0:12 | Hook | Clone playing; Saksham to camera | "That's not me. That's a clone of my voice, asking my bank for ₹45,000." |
| 0:12–0:28 | Problem | Three threats; deepfake fraud attempts up 1,300%; US consumers reported $12.5B lost to fraud in 2024 | "Voice agents can now move money. Who decides what they're allowed to do?" |
| 0:28–0:45 | 1, 2 | Card frozen by voice (English), fee waived, Aero app updating | "For me: instant." |
| 0:45–1:20 | 3 | Passkey prompt on the phone, callback ringing, Stage turns red | "A perfect copy of my voice got nothing." |
| 1:20–2:00 | 4 | Saksham, coached, asks to move ₹4.8 lakh; Aero holds it, hands him to a person | "Authentication can't save you from a scammer on the other line. Halyn can." |
| 2:00–2:25 | 5, 6 | Two agents talking; Pass card; the transfer attempt rings the phone | "My assistant gets exactly what I allowed." |
| 2:25–2:40 | 10 + Test | Region switch India → US (browser call); Test scorecard: actions without a grant, 0 | "Two countries, two rulebooks, one product." |
| 2:40–3:00 | Close | Architecture picture, one-command install, tagline | "Halyn. Don't trust the voice. Trust the permission." |

45-second cut: hook, scenario 3, close. Label the clone on screen as "AI clone of my own voice".

Scenario 3's clone lines, in English since 2026-10-29 (8 clips: "Hi, this is सक्षम मिश्रा.", "I need to send
forty-five thousand rupees to a new account.", account ending 4471, "The IFSC is AERO, like the bank's name, then six zeros and a one.", payee Rohan Verma, "Yes, that's
right, please send it.",
waiting, goodbye) live in `scripts/clone-clips.ts` (voice C, atempo 1.25, KV `file:ten_aero:clip:<id>`); play them
from `/stage/soundboard` into the second phone. Record the Stage with `/stage?recording=1` (Escape leaves).

## Recording checklist (each take)
1. Before every take: Stage → **Demo reset** (or `node scripts/ops/demo-reset.mjs`) so the call-burst signal starts
   clean, and `pnpm seed:core --remote --yes` (go-ahead) so the card is unfrozen and balances are back.
2. Laptop: `https://halyn-voice.vercel.app/stage?recording=1` at 1920×1080 (Escape shows the controls), Stage tab
   **muted**; the Aero app open on the phone for scenarios 1–2 and the passkey sheet.
3. Calls: phone held **at the ear** (speaker noise keeps the speech detector open). Scenario 3 uses the **second
   phone**: call number A from it and play `/stage/soundboard` clips 1→8 into it; decline on the real phone.
4. Order: 1 freeze → 2 fee waiver → 3 clone → 4 coached → 5+6 Assistant → 10 US browser call → Halyn Test "Run all"
   (daytime only: after 23:00 IST the unusual-hour signal raises every tier, by design; run one Stage scenario first so
   the Hub is warm; a live run executes real Aero Core actions, so `seed:core` again afterwards).
5. After the session: `/compliance-check` and the COMPLIANCE.md session log.
