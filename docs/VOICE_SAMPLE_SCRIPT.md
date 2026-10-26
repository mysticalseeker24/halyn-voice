# Voice sample for the clone (Day-0 check 8, used in Step 19)

Sarvam Instant Voice Cloning (beta) makes a clone from **one clip of 10–15 seconds** of clean, single-speaker audio,
and **copies the performance**: pace, tone and energy carry into everything the clone says. The clone can speak Hindi
or English whatever the clip's language (your accent carries over). So: record the takes below, then we pick the
cleanest one per language.

## How to record (5 minutes)
- Quiet room, door shut, fan/AC off; soft furnishings help (bedroom > bathroom).
- Phone's voice-recorder app (not a phone call, not speakerphone), held 15–20 cm from your mouth, same distance
  throughout. If the app offers WAV or "high quality", pick it.
- One second of silence before and after. Speak the way you'd talk to a bank on the phone: natural, clear, not
  performed. Don't whisper or shout; the clone copies it.
- Each take 10–15 seconds. Do each one twice. Save to `scripts/out/voice/` (git-ignored; audio is never committed).

## Take A — Hinglish, Hindi-led (main take: the demo's clone speaks Hindi)
हेलो, मैं साक्षम मिश्रा बोल रहा हूँ। मुझे अपने सेविंग्स अकाउंट के बारे में एक छोटा सा काम करवाना था।
थोड़ा जल्दी कर दीजिए, मैं अभी एक मीटिंग में हूँ। मेरा कस्टमर नंबर है — चार, सात, दो, नौ, एक, पाँच। थैंक यू।

*Romanised (read whichever is easier):* Hello, main Saksham Mishra bol raha hoon. Mujhe apne savings account ke baare
mein ek chhota sa kaam karwana tha. Thoda jaldi kar dijiye, main abhi ek meeting mein hoon. Mera customer number hai —
chaar, saat, do, nau, ek, paanch. Thank you.

## Take B — English (Indian English)
Hi, this is Saksham Mishra. I'm calling about my savings account. Could you please tell me my current balance, and the
date of my next EMI? I'd also like to check one recent transaction. Thanks a lot for your help.

## Take C — calm Hindi (backup, slower and warmer)
नमस्ते, मैं साक्षम बोल रहा हूँ। आज मौसम बहुत अच्छा है, तो सोचा अभी फ़ोन कर लूँ। आप आराम से बताइए,
मुझे कोई जल्दी नहीं है। धन्यवाद, आपका दिन अच्छा रहे।

*Romanised:* Namaste, main Saksham bol raha hoon. Aaj mausam bahut achha hai, toh socha abhi phone kar loon. Aap aaraam
se bataiye, mujhe koi jaldi nahin hai. Dhanyavaad, aapka din achha rahe.

## Consent clip (separate file, kept with the project records, never sent to Sarvam)
"I am Saksham Mishra. This is my own voice. I consent to Sarvam AI creating a clone of my voice for the Halyn
buildathon demo, where it will be labelled as an AI clone of my own voice. Recorded on the twenty-sixth of October,
twenty twenty-six."

## What happens next
1. Send the file paths. I check length, noise and format (and convert to WAV mono 24 kHz if needed).
2. You tick Sarvam's mandatory consent box when the voice is saved (dashboard; only you can do this).
3. The voice is created from Take A (and B for English); a test line is rendered for you to judge on a phone
   speaker. Cost: Sarvam bills ₹2 per 1,000 characters of generated speech (your Sarvam credits, not the Bolna wallet).

Rules (docs/COMPLIANCE.md): your own voice only, consented, never used as a Bolna agent voice, labelled "AI clone of
my own voice" wherever it is shown or played. The takes contain no scam wording; the clone's demo lines are rendered
from docs/DEMO_SCRIPT.md in Step 19.
