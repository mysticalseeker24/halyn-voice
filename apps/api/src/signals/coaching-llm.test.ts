import { describe, expect, it } from 'vitest';
import { parseCoachingAnswer, SARVAM_CHAT_URL, sarvamCoaching } from './coaching-llm';

// Sarvam is mocked here (docs/TESTING.md); the 1.5 s budget and every failure fall back to null (layer 1 alone).

function completion(content: string | null, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });
}

describe('sarvamCoaching', () => {
  it('asks Sarvam with the key and the quotes as data, and reads probability + known cues', async () => {
    const seen: Request[] = [];
    const llm = sarvamCoaching({
      apiKey: 'sk_test',
      fetch: async (r) => {
        seen.push(r);
        return completion('{"probability": 0.92, "cues": ["secrecy_request", "made_up", "secrecy_request"]}');
      },
    });
    expect(await llm(['he said not to tell anyone'])).toEqual({ score: 0.92, cues: ['llm_secrecy_request'] });
    expect(seen[0]?.url).toBe(SARVAM_CHAT_URL);
    expect(seen[0]?.headers.get('api-subscription-key')).toBe('sk_test');
    const body = (await seen[0]?.json()) as { messages: { role: string; content: string }[] };
    expect(body.messages[1]).toEqual({ role: 'user', content: '{"quotes":["he said not to tell anyone"]}' });
  });

  it('is null when Sarvam is slower than the budget, fails, or answers nonsense; no quotes → no call', async () => {
    let calls = 0;
    const slow = sarvamCoaching({
      apiKey: 'k',
      timeoutMs: 20,
      fetch: (r) =>
        new Promise((_, reject) => r.signal.addEventListener('abort', () => reject(new Error('aborted')))),
    });
    expect(await slow(['q'])).toBeNull();
    const down = sarvamCoaching({ apiKey: 'k', fetch: async () => completion('x', 503) });
    expect(await down(['q'])).toBeNull();
    const thrown = sarvamCoaching({
      apiKey: 'k',
      fetch: async () => {
        throw new Error('network');
      },
    });
    expect(await thrown(['q'])).toBeNull();
    const empty = sarvamCoaching({ apiKey: 'k', fetch: async () => completion(null) });
    expect(await empty(['q'])).toBeNull();
    const counted = sarvamCoaching({
      apiKey: 'k',
      fetch: async () => {
        calls += 1;
        return completion('{}');
      },
    });
    expect(await counted([])).toBeNull();
    expect(calls).toBe(0);
  });
});

describe('parseCoachingAnswer', () => {
  it('tolerates reasoning and fences, clamps the probability, and rejects what is not the shape', () => {
    expect(parseCoachingAnswer('<think>hmm {x}</think>```json\n{"probability": 1.4}\n```')).toEqual({
      score: 1,
      cues: [],
    });
    expect(parseCoachingAnswer('{"probability": -2, "cues": []}')).toEqual({ score: 0, cues: [] });
    expect(parseCoachingAnswer('no json here')).toBeNull();
    expect(parseCoachingAnswer('{"probability": "high"}')).toBeNull();
    expect(parseCoachingAnswer('{"probability": 0.5,')).toBeNull();
  });
});
