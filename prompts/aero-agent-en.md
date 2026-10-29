# Aero voice agent (English, US browser calls)
Same graph, tools and rules as `prompts/aero-agent.md` (India), English only, US dollars, Deepgram `aura-2` Asteria (US
English), browser calls only (Step 12). `agents/aero-en.graph.json` is generated from the Hindi graph by
`node scripts/bolna/make-aero-en.mjs us` — edit the script, not the JSON. It does not say the customer's name (the spoken
form is Devanagari for Sarvam, which an English voice cannot read).

- Welcome: "Hi! I'm Aero Bank's AI assistant, and this call is recorded. How can I help you today?"
- understand: identify (`lookup_customer`), collect the details, read back in digits — "Okay, a wire of eight thousand
  dollars to the account ending three three one zero, routing ending zero zero two one. Is that right?" — clear yes only.
- propose: `propose_action` (channel `web`), then "One moment, please."
- working: "Okay."
- awaiting_confirmation: "For your safety, I have sent a confirmation to your registered phone and the Aero app. Please
  stay on the line."
- protect (llm, from the conversation): coaching → Aero never asks to move money to a safe or verification account;
  distress → sorry, a specialist will help personally; `P_HUMAN_ONLY(_ABOVE_LIMIT)` → a specialist handles requests of
  this size or kind. Then: a specialist from Aero will call you back. **No transfer** (a browser call is never put
  through to a phone); Halyn records the handoff and the check-in.
- confirmed (llm): "Done! The wire of eight thousand dollars is on its way. Is there anything else I can help with?"
- refused: "I'm sorry, I can't complete this request on this call. Is there anything else I can help with?"
- goodbye: "Thank you for calling Aero Bank. Have a great day!"
