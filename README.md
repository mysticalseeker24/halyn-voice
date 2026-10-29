# Halyn

**The permission layer for voice agents.** A voice agent never holds the power to act: it can only *propose* an
action. Halyn decides — allow, step-up, hold or deny — from policy, proof and signals, never from how the caller
sounds, and only Halyn can execute, with a one-time grant bound to the exact action.
*Don't trust the voice. Trust the permission.*

Built on [Bolna](https://www.bolna.ai) with [Sarvam](https://www.sarvam.ai) speech for the Bolna Symphony
Buildathon 2026, by Saksham Mishra.

## The problem
Voice agents at banks and fintechs are starting to act: waive fees, move EMIs, send money. Three callers abuse that:

| Caller | Why today's checks fail | Halyn |
|---|---|---|
| Impersonator with a cloned voice | Biometrics can be fooled; "known details" aren't secret | Voice is only a signal; risky actions need a passkey or a callback to the registered number |
| AI assistant calling for a customer | Banks hang up, or can't check its authority | **Halyn Pass**: a signed, scoped permission, spoken as a one-time code |
| Real customer coached by a scammer | Every check passes; a step-up gets approved | Coaching signals → **hold** and a human specialist |

Deepfake fraud attempts rose 1,300% in 2024 (Pindrop). US consumers reported $12.5B lost to fraud in 2024, $2.95B to
imposter scams (FTC). About ₹120 crore was lost to "digital arrest" scams in early 2024 (The Wire). And AI agents that
call companies for consumers are being funded: Pine raised $25M.

## Try it
- **Call Aero Bank** (a fictional bank, in English): **+91 80653 56344**. You're an unregistered caller, so anything
  risky steps up to the demo customer and won't execute for you.
- **Web:** https://halyn-voice.vercel.app — Stage (live decisions), Console (requests, ledger, handoffs, Halyn
  Test), the Aero Bank app (passkey approvals; "Call Aero" in the browser for the US twin) and Saksham's Assistant.
  Demo access code on request.
- The acceptance scenarios with exact expected outcomes: [`docs/SCENARIOS.md`](docs/SCENARIOS.md).

## How it works
```
Callers ─► Bolna (Vobiz numbers A/B, Web Call SDK)
            ├─ Aero voice agent (graph)  ──custom functions──►  Halyn API (Cloudflare Worker, Hono)
            ├─ Halyn Confirm (outbound)  ◄──event injection──     ├─ Gate (pure) · Signals · Pass
            └─ Assistant agent (outbound)                         └─ Hub Durable Object: WebSockets, alarms, ledger
Halyn API ─► TiDB (system of record) ─► Aero Core Worker + D1 (mock bank; verifies every grant)
Web (Vercel, Next.js): /stage /console /aero /assistant  ◄── REST + WebSocket
```
1. The Aero agent collects the details, reads them back and calls `propose_action`. It has **no tool that executes
   anything.**
2. The **Gate** (a pure, property-tested function) takes the action's tier from the region's policy pack; proof and
   signals can only *raise* it — unregistered number, call bursts, unusual hour, velocity, coaching score.
3. **step_up** → the customer confirms out of band: a passkey in the Aero app, or a Confirm call to the registered
   phone. First answer wins; 60 s of silence is a deny. **hold** → a specialist, with a warm transfer.
4. **allow** → Halyn signs an Ed25519 grant (≤ 120 s, SHA-256 of the exact parameters, one-time id). Aero Core refuses
   any write without one. Every step lands in a hash-chained ledger that `/ledger/verify` checks.
5. Any error or unknown state on a write path is a **deny**, and the caller still hears a polite outcome.

More: [Halyn Pass protocol](docs/PASS.md) · [architecture](docs/ARCHITECTURE.md) · [policy engine](docs/GATE.md).

## Bolna and Sarvam
- **Graph agents** (Aero, Confirm): outcome nodes have only *event* edges, so the agent can't talk itself into "done".
- **Custom functions** (`lookup_customer`, `verify_pass`, `propose_action`, `confirm_result`, `get_pass_code`),
  guarded by Bolna's source IPs **and** a shared secret.
- **Event injection:** Halyn pushes `allow / step_up / hold / deny / done / approved / denied / timeout` into the
  live call.
- **Outbound calls** from number B: the Confirm call, and the Assistant calling the bank.
- **Web Call SDK** for the US twin: Halyn mints a single-use session; the Bolna key never reaches the browser.
- **Sarvam:** `saaras:v4` speech-to-text, `bulbul:v4-flash` voices, the coaching LLM (signals only raise a tier), and
  an instant clone of Saksham's own voice — consented and labelled — for the impersonation demo.

## Halyn Test results
Every scenario runs in text mode against the real Gate, Hub and Aero Core (no mocks of Halyn); voice personas are
scored too.

| Last "Run all" on the deployed API | Result |
|---|---|
| Scenarios passed | _filled from the last run_ |
| Actions executed without a grant | **0** |
| `propose_action` latency | _filled from the last run_ |

Real calls on Bolna (English): _filled after the call rounds_.

## Compliance
Protective prompts only; scam detection lives in code. Every greeting discloses the AI and the recording. Outbound
agents keep calling hours 09:00–21:00 and never bypass them, and call only numbers the builder owns. No
attacker-persona agents (attacks run in text mode). The clone is the builder's own voice, consented and labelled.
Demo-only shortcuts are listed in [`docs/COMPLIANCE.md`](docs/COMPLIANCE.md).

## Business
Banks, lenders, fintechs and insurers whose voice agents can act — Indian lenders on Bolna first, then the US. Free
builder tier, then a platform fee plus a price per decision and per Confirm call. Pindrop scores callers for human
contact centres, Hamming and Cekura test agents before launch, guardrails live inside the model, Google AP2 covers
online payments; Halyn sits between the agent and the bank. Moat: the Pass network, attack data from the ledger and
test library, and being Bolna's default layer.

## Roadmap
US phone calls; Pass over SIP headers between agents; a Google AP2 intent mandate inside a Pass; liveness providers
as signals; more policy packs; Halyn as a one-click layer for any Bolna agent.
