# Submission checklist (Sat 2026-10-31)

Paste the buildathon form's exact fields here when you have them; the answers below cover the usual ones.

## Ready answers
| Field | Answer |
|---|---|
| Project name | Halyn |
| Tagline | The permission layer for voice agents. Don't trust the voice. Trust the permission. |
| Short description (1–2 lines) | Halyn is the permission layer for voice agents: the AI agent can only propose an action, and Halyn decides — from policy and proof, never from how the caller sounds — asking the real customer on their own device when it's risky. For banks, lenders and fintechs whose voice agents can move money, so a voice clone, an unverified AI assistant or a coached scam victim can't. |
| Try it (judges) | https://halyn-voice.vercel.app/try · access code `HALYN-JUDGE-2026` · then call +91 80653 56344 from that phone |
| Team | Saksham Mishra (solo) |
| Live demo | https://halyn-voice.vercel.app (Stage, Console, Aero app, Assistant; demo access code on request) |
| Call the demo bank | +91 80653 56344 (Aero Bank's English AI agent on Bolna; fictional bank) |
| Code | https://github.com/mysticalseeker24/halyn-voice |
| Video | _(YouTube/Drive link to the 2:55 submission video)_ |
| Pitch deck | _(link to the deck)_ |
| X post | _(link to the thread)_ |
| Built with | Bolna (graph voice agents, custom functions, event injection, Web Call SDK, Vobiz numbers), Sarvam (STT, TTS, coaching check), Cloudflare Workers + Durable Objects + KV + D1, TiDB, Next.js on Vercel |

**One paragraph:** Voice agents at banks are starting to act on money, and three callers can abuse them: a voice
clone, an AI assistant nobody can verify, and a real customer coached by a scammer. Halyn is the permission layer
between the agent and the bank: the voice agent has one tool, `propose_action`; Halyn decides allow, step-up, hold or
deny from policy, proof and signals — never from how the caller sounds — and only Halyn can execute, with a one-time
Ed25519 grant bound to the exact action that the bank's core verifies on every write. A clone of my own voice asking
for ₹45,000 is stepped up to my own phone and denied; a coached customer is held for a human instead of being asked
to approve; an AI assistant with a Halyn Pass gets exactly what the customer allowed. Every decision lands in a
hash-chained ledger, and Halyn Test runs the attacks against the live system. Built on Bolna with Sarvam, tested on
real calls in India and browser calls in the US.

**How Bolna is used:** three graph agents (Aero, Halyn Confirm, the customer's Assistant) plus voice-test personas;
custom-function tools (`lookup_customer`, `verify_pass`, `propose_action`, transfer to a specialist) authenticated by
Bolna's source IPs and a shared secret; outcomes injected into live calls as events (`done`, `step_up`, `hold`,
`deny`…); outbound Confirm callbacks and agent-to-agent calls from number B with calling guardrails 09:00–21:00; the
Web Call SDK for the US twin; execution webhooks for the telephony record (the calling number is proof only from
Bolna's record, never from the LLM).

**Compliance summary:** protective prompts only; no real bank, regulator or brand names in prompts; AI + recording
disclosure in every greeting; guardrails 09:00–21:00 on every outbound agent, never bypassed; calls only to the
builder's own numbers; no attacker-persona agents (attacks run in text mode); `restricted: false` on all agents and
0 violations (checked 2026-10-30, after ~35 calls). Details: docs/COMPLIANCE.md.

## Final pass (tick before submitting)
- [ ] Run all (daytime) numbers in the README; seed + reset afterwards
- [ ] README renders on GitHub: images, the `<picture>` wordmark, mermaid diagrams
- [ ] https://halyn-voice.vercel.app loads in light and dark; Stage, Console, Aero, Assistant open with the code
- [ ] Number A answers with the English greeting and the AI + recording disclosure
- [ ] Demo access code ready to share with judges (not in the repo)
- [ ] Video < 3:00 uploaded (unlisted or public), link works logged out
- [ ] Deck link works logged out; the video is embedded or linked on slide 5
- [ ] `demo-freeze` tag pushed; agent snapshots committed
- [ ] Bolna `list_violations` empty; all agents `restricted: false`
