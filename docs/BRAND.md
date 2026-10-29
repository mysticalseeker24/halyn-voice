# Brand (Halyn) — palette, type, and image prompts

**Palette** (tokens in `apps/web/src/app/globals.css`): ink `#16171C` on paper `#F7F7F4` (light), paper `#EDEDEA`
on near-black `#141519` (dark), one signal colour, cobalt `#3A55D6` (dark theme `#7C93F5`), for focus, links and
the live dot only. Outcome colours always carry their word: ALLOWED green, STEP-UP amber, HELD violet, DENIED red.
**Type:** Inter (tight tracking for display), JetBrains Mono for labels, ids and hashes. **Mark:** an "H" whose
crossbar is a gate: `apps/web/public/halyn-mark.png` (generated, 512 px), drawn in the UI by `halyn-mark.tsx` (same geometry);
wordmark `apps/web/public/halyn-lockup.png`; social card `apps/web/public/og.png` (watermark covered); favicon
`apps/web/src/app/icon.png`; pipeline figure `apps/web/public/pipeline.png` (landing + README).
Aero Bank (the demo bank) has its own brand: sky blue + white with a coral highlight. Never mix the two.

## Image prompts (for an image model; save the results where noted)
1. **Logo mark** → `apps/web/public/halyn-mark.png` (1024×1024, transparent) and an SVG trace if possible.
   "A minimal geometric logo mark for a security software company called Halyn. A bold capital H built from two
   solid vertical bars; the crossbar is a short, separate rectangle in cobalt blue (#3A55D6) that reads as a gate or
   checkpoint between the bars. Flat vector, no gradients, no shadows, no 3D, no text. Ink black (#16171C) bars on a
   transparent background. Perfectly symmetrical, crisp edges, works at 16 px. Swiss, engineering-grade, calm."
2. **Wordmark lockup** → `apps/web/public/halyn-lockup.png` (2000×600, transparent).
   "The same H mark followed by the word 'Halyn' set in a neo-grotesque sans serif like Inter, semibold, tight letter
   spacing, ink black (#16171C), on a transparent background. Flat vector, generous spacing, no tagline, no effects."
3. **Social / Open Graph card** → `apps/web/public/og.png` (1200×630).
   "A clean product card on warm off-white paper (#F7F7F4) with a faint dotted grid. Left: large black headline
   'Don't trust the voice. Trust the permission.' in a neo-grotesque sans, tight tracking. Below it, small monospace
   caps 'HALYN · THE PERMISSION LAYER FOR VOICE AGENTS'. Right: three small white cards with thin grey borders, slightly
   tilted, each with one line of text and a small square status label: 'ALLOWED' (green), 'STEP-UP → DENIED' (amber,
   red), 'HELD' (violet). One cobalt (#3A55D6) dot as the only accent. No people, no robots, no glowing AI imagery, no
   gradients."
4. **Technical illustration** (optional, landing / README) → `docs/screens/hero-diagram.png` (1600×1000).
   "Monochrome engineering line drawing on white with a light dotted grid, like a figure in a research paper: a sound
   waveform enters from the left, passes through a narrow gate drawn as two vertical bars, and only a thin, straight
   signed line continues to a small bank-building icon on the right; branches above and below the gate end in small
   labelled squares 'step-up', 'hold', 'deny'. Thin black strokes, small monospace labels, one cobalt (#3A55D6) square
   marking the gate. No 3D, no gradients, no neon, no humans."
5. **Favicon** → `apps/web/src/app/icon.png` (512×512): the mark from prompt 1 on a solid ink (#16171C) rounded
   square, the bars in off-white (#F7F7F4) and the gate in cobalt (#3A55D6).

## Pitch deck images (16:9, 1920×1080 unless noted; save to `docs/deck/`)
Shared style line — append to every prompt: "Flat, editorial, engineering-grade. Warm off-white paper (#F7F7F4) with a
faint dotted grid, ink black (#16171C) shapes and thin strokes, small monospace caps labels, one cobalt (#3A55D6)
accent only. Status labels are small square tags with their word: ALLOWED green, STEP-UP amber, HELD violet, DENIED red.
No people's faces, no robots, no glowing brains, no neon, no gradients, no 3D, no stock-photo look, no watermark."

1. **Title slide** → `deck/01-title.png`. "Left two thirds empty for a headline. On the right, the Halyn H mark (two
   ink bars, a cobalt crossbar as a gate) large, with a thin sound waveform entering from the left edge of the canvas
   and stopping exactly at the gate."
2. **The problem: three callers** → `deck/02-three-callers.png`. "Three equal columns separated by thin vertical
   rules. Column 1: a phone handset icon with a second, ghosted copy of the same waveform beside it, labelled 'CLONED
   VOICE'. Column 2: a small rectangular chip icon speaking through a phone, labelled 'AI ASSISTANT'. Column 3: a
   phone handset with a second, thinner waveform intruding from the side like another voice on the line, labelled
   'COACHED CUSTOMER'. Under each, an empty line for a caption."
3. **Why voice is not proof** → `deck/03-voice-not-proof.png`. "Two identical waveforms stacked, one labelled
   'REAL', one labelled 'CLONE'; a thin bracket joins them with the label 'INDISTINGUISHABLE'. To the right, a passkey
   key icon and a phone with a checkmark, joined by a cobalt line, labelled 'PROOF = THE CUSTOMER'S OWN DEVICE'."
4. **The one rule** → `deck/04-propose-decide-execute.png`. "Three boxes left to right connected by arrows:
   'AGENT · PROPOSES' (outline), 'HALYN · DECIDES' (ink filled, with the cobalt gate mark), 'BANK · EXECUTES' (outline,
   a small bank-columns icon). Under the middle box, four small square tags in a row: ALLOWED, STEP-UP, HELD, DENIED."
5. **Step-up across two devices** → `deck/05-step-up.png`. "A simple sequence: a phone on a call on the left, a
   second phone on the right showing a minimal approval sheet with a key icon and two buttons, 'APPROVE' and
   'DECLINE'; a thin cobalt line labelled 'OUT OF BAND' runs between them; above, a timer ring labelled '60 S'. Line
   art only."
6. **The coached victim gets a human** → `deck/06-hold.png`. "A request card with the words 'MOVE ₹4.8 LAKH TO A
   VERIFICATION ACCOUNT' and a violet HELD tag; a thin line from it to a headset icon labelled 'SPECIALIST' and a small
   calendar icon labelled 'CHECK-IN'. Calm, protective, no alarm symbols."
7. **Halyn Pass** → `deck/07-pass.png`. "A boarding-pass style card: dark ink card with a cobalt header strip
   reading 'HALYN PASS', fields 'PASSENGER: ASSISTANT', 'ON BEHALF OF: CUSTOMER', a row of small rounded tags
   'STATEMENT', 'FREEZE CARD', 'MOVE EMI ×1', a perforated line, and a large six-digit code '4 7 2 9 1 5' in monospace.
   Slight perspective tilt, soft shadow on paper."
8. **Grant and ledger** → `deck/08-grant-ledger.png`. "Left: a small sealed envelope icon labelled 'GRANT · ED25519 ·
   ≤ 120 S · ONE USE · EXACT PARAMETERS'. Right: a vertical chain of six small rectangles connected by short links,
   each labelled in monospace (proposed, decided, confirm_requested, confirmed, grant_issued, executed), the last
   one with a small cobalt checkmark and the label 'CHAIN VERIFIED'."
9. **Architecture** → `deck/09-architecture.png`. "A clean block diagram on the grid: 'CALLERS' → 'BOLNA' (voice
   agents, phone numbers, web calls) → 'HALYN' (gate, signals, pass, ledger; the gate in cobalt) → 'BANK CORE'.
   A dotted return arrow from HALYN to BOLNA labelled 'EVENTS INTO THE LIVE CALL'. Side boxes: 'SARVAM · SPEECH',
   'TIDB · RECORDS', 'WEB APPS'. Thin strokes, monospace labels, generous spacing."
10. **Market** → `deck/10-market.png`. "Three concentric rings, like a target, labelled from inside out: 'INDIAN
    LENDERS & FINTECHS ON BOLNA', 'BANKS & INSURERS WITH VOICE AGENTS', 'EVERY VOICE AGENT THAT CAN ACT'. Leave space
    beside each ring for a number. Ink strokes, the innermost ring filled cobalt at low opacity."
11. **Business model** → `deck/11-pricing.png`. "Three stacked horizontal bars like a simple pricing ladder: 'FREE
    BUILDER TIER', 'PLATFORM FEE', 'PER DECISION · PER CONFIRM CALL', each a thin outlined bar with a small icon (a
    wrench, a building, a ticking counter)."
12. **Landscape** → `deck/12-landscape.png`. "A 2×2 grid with axes 'BEFORE LAUNCH ↔ LIVE CALLS' (horizontal) and
    'SCORES THE CALLER ↔ AUTHORISES THE ACTION' (vertical). Small unlabelled grey dots in three quadrants; one cobalt
    dot in the 'LIVE CALLS / AUTHORISES THE ACTION' quadrant labelled 'HALYN'."
13. **Roadmap** → `deck/13-roadmap.png`. "A horizontal timeline with five evenly spaced ticks labelled 'US PHONE
    CALLS', 'PASS OVER SIP', 'AP2 MANDATES IN A PASS', 'LIVENESS SIGNALS', 'ONE-CLICK FOR ANY BOLNA AGENT'; the first
    tick filled cobalt, the rest outlined."
14. **Closing** → `deck/14-close.png`. "Centre: the Halyn wordmark small, above a large empty band for the line 'Don't
    trust the voice. Trust the permission.'; the dotted grid fades out towards the edges."

Real screenshots beat illustrations for the demo slides — use these from `docs/screens/`: `stage-v1-dark.png`
(a decision live), `real-call-fee-waiver-stage.png` (a real call), `aero-approval.png` (step-up on the phone),
`assistant-pass-card.png` (the Pass), `console-policies.png`, `console-ledger.png`, `console-halyn-test-permission-map.png`,
and `landing.png` for the closing slide.
