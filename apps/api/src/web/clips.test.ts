import { ClipAudioResponseSchema, ClipListResponseSchema } from '@halyn/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AppHarness, appHarness } from '../../test/fixtures/app';
import { clipKey } from './clips';

// The Stage soundboard's clips from KV (Step 19, ADR-023).

let h: AppHarness;
beforeEach(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  h = await appHarness();
});
afterEach(() => vi.restoreAllMocks());

const meta = (order: number, label: string) => ({
  label,
  text: 'Namaste (the line in Devanagari on the real clips)',
  order,
  content_type: 'audio/mpeg',
});

describe('GET /web/clips', () => {
  it('lists the clips in scene order and serves one as base64; console sessions only', async () => {
    const bytes = new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3, 250]);
    await h.env.CONFIG.put(clipKey(h.tenant, 'request'), bytes, { metadata: meta(2, 'Request') });
    await h.env.CONFIG.put(clipKey(h.tenant, 'greet'), bytes, { metadata: meta(1, 'Greeting') });
    await h.env.CONFIG.put(clipKey(h.tenant, 'junk'), bytes, { metadata: { label: 'no order' } });
    await h.env.CONFIG.put(clipKey('ten_other', 'theirs'), bytes, { metadata: meta(0, 'Other tenant') });
    const token = await h.consoleToken();

    const list = ClipListResponseSchema.parse(await (await h.web('/web/clips', undefined, token)).json());
    expect(list.clips.map((c) => c.id)).toEqual(['greet', 'request']);

    const audio = ClipAudioResponseSchema.parse(
      await (await h.web('/web/clips/greet', undefined, token)).json(),
    );
    expect(audio.content_type).toBe('audio/mpeg');
    expect(Uint8Array.from(atob(audio.audio_b64), (ch) => ch.charCodeAt(0))).toEqual(bytes);

    expect((await h.web('/web/clips/nope', undefined, token)).status).toBe(404);
    expect((await h.web('/web/clips/..%2Fpack', undefined, token)).status).toBe(404);
    expect((await h.web('/web/clips', undefined, await h.customerToken())).status).toBe(401);
  });
});
