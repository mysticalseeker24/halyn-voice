# Aero voice agent (English, US browser calls)
Same graph, nodes and rules as `prompts/aero-agent.md`, English only, US dollars, a US English voice (Step 12).
No Hindi lines; `agent_information` drops the Devanagari rule and says "Reply in English".

- Welcome: "Hi, I'm Aero Bank's AI assistant. This call is recorded. How can I help today?"
- Read-back example: "Eight thousand dollars to the account ending three three one zero, correct?"
- working: "Thanks, one moment while I complete this."
- awaiting_confirmation: "For your safety, I've sent a confirmation to your registered phone. Please stay on the line."
- confirmed (llm): "All done. Your reference is AERO, then each character. Anything else I can help with?"
- refused: "Sorry, I can't complete that request on this call. Is there anything else I can help with?"
- goodbye: "Thanks for calling Aero Bank. Have a good day!"
- transfer pre-call message: "I'm connecting you to a specialist now. Please stay on the line."
