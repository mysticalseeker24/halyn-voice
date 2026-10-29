# Brand (Halyn) — palette, type, and image prompts

**Palette** (tokens in `apps/web/src/app/globals.css`): ink `#16171C` on paper `#F7F7F4` (light), paper `#EDEDEA`
on near-black `#141519` (dark), one signal colour, cobalt `#3A55D6` (dark theme `#7C93F5`), for focus, links and
the live dot only. Outcome colours always carry their word: ALLOWED green, STEP-UP amber, HELD violet, DENIED red.
**Type:** Inter (tight tracking for display), JetBrains Mono for labels, ids and hashes. **Mark:** an "H" whose
crossbar is a gate: `apps/web/public/halyn-mark.png` (generated, 512 px), drawn in the UI by `halyn-mark.tsx` (same geometry);
wordmark `apps/web/public/halyn-lockup.png`; social card `apps/web/public/og.png` (watermark covered); favicon
`apps/web/src/app/icon.svg` (drawn from the mark — the generated favicon and diagram were unusable).
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
