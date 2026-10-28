import { CompiledPolicyPackSchema } from '@halyn/shared';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AppHarness, appHarness, UNREGISTERED } from '../../test/fixtures/app';
import { IN_PACK } from '../../test/fixtures/gate';
import { flowContext } from '../flow/context';
import type { RequestRecord } from '../hub/types';
import { loadPacks, packKey } from '../packs/load';
import { callbackAvailability, inCallingWindow, startCallback } from './start';

// The Confirm callback's rules (docs/COMPLIANCE.md): 09:00–21:00 IST only, only Saksham's own number, only when it is
// the customer's registered number; anything missing → passkey only, never a guess.

const IST = (h: number, m = 0) => Date.UTC(2026, 9, 28, h, m) - (5 * 60 + 30) * 60 * 1000;
let h: AppHarness;

beforeEach(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  h = await appHarness();
});
afterEach(() => vi.restoreAllMocks());

describe('the calling window', () => {
  it('09:00 ≤ IST < 21:00', () => {
    expect(inCallingWindow(IST(8, 59))).toBe(false);
    expect(inCallingWindow(IST(9))).toBe(true);
    expect(inCallingWindow(IST(20, 59))).toBe(true);
    expect(inCallingWindow(IST(21))).toBe(false);
  });
});

describe('callbackAvailability', () => {
  it('is off without Bolna or the Confirm settings, and outside the window', async () => {
    const deps = { clock: h.clock, rng: h.rng, bolnaFetch: h.bolna.fetch };
    const on = await callbackAvailability(flowContext(h.env, h.tenant, deps));
    expect(on).toEqual({ available: true, number_hash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    const noAgent = { ...h.env, BOLNA_CONFIRM_AGENT_ID: 'not-a-uuid' } as unknown as Env;
    expect(await callbackAvailability(flowContext(noAgent, h.tenant, deps))).toEqual({
      available: false,
      number_hash: null,
    });
    const noBolna = { ...h.env, BOLNA_API_KEY: '' } as unknown as Env;
    expect((await callbackAvailability(flowContext(noBolna, h.tenant, deps))).available).toBe(false);
    const night = { nowMs: () => IST(22) };
    expect(
      (await callbackAvailability(flowContext(h.env, h.tenant, { ...deps, clock: night }))).available,
    ).toBe(false);
  });

  it('a step-up at night offers the passkey only', async () => {
    h.clock.advance(IST(22) - IST(10, 30));
    const run = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
    await h.tool('lookup_customer', {
      run_id: run,
      from_number: UNREGISTERED,
      claimed_name: 'Saksham Mishra',
    });
    const res = await h.tool('propose_action', {
      run_id: run,
      from_number: UNREGISTERED,
      action: 'transfer.saved',
      params: { amount_minor: 1000000, currency: 'INR', payee_id: 'payee_mom' },
      readback_confirmed: true,
    });
    await h.settle();
    const { request_id } = (await res.json()) as { request_id: string };
    expect((await h.hub.requestState(request_id))?.confirm?.channels).toEqual(['passkey']);
    expect(h.bolna.calls).toEqual([]);
  });
});

describe('startCallback', () => {
  const record = (channels: ('passkey' | 'callback')[]) =>
    ({
      request_id: 'req_x',
      summary: 'x',
      confirm: { channels, deadline: 0, execution_id: null },
    }) as unknown as RequestRecord;

  it('does nothing without the callback channel, and drops the channel when it cannot ring', async () => {
    const ctx = flowContext(h.env, h.tenant, { clock: h.clock, rng: h.rng, bolnaFetch: h.bolna.fetch });
    expect(
      await startCallback(ctx, record(['passkey']), { spoken_name: 'सक्षम', language: 'hi' }),
    ).toBeNull();
    expect(await startCallback(ctx, record(['passkey', 'callback']), null)).toBeNull();
    const refusing = flowContext(h.env, h.tenant, {
      clock: h.clock,
      rng: h.rng,
      bolnaFetch: async () => new Response('{}', { status: 400 }),
    });
    expect(
      await startCallback(refusing, record(['passkey', 'callback']), {
        spoken_name: 'सक्षम',
        language: 'en',
      }),
    ).toBeNull();
  });
});

describe('loadPacks (KV)', () => {
  it('parses each region’s compiled pack and leaves out a missing, invalid or mismatched one', async () => {
    const tenant = 'ten_packs';
    await env.CONFIG.put(packKey(tenant, 'IN'), JSON.stringify(CompiledPolicyPackSchema.parse(IN_PACK)));
    await env.CONFIG.put(packKey(tenant, 'US'), JSON.stringify(CompiledPolicyPackSchema.parse(IN_PACK)));
    const packs = await loadPacks(env.CONFIG, tenant);
    expect(packs.IN?.region).toBe('IN');
    expect(packs.US).toBeUndefined();
    await env.CONFIG.put(packKey(tenant, 'IN'), '{"schema":"halyn-policy-pack/1"}');
    await env.CONFIG.put(packKey(tenant, 'US'), 'not json');
    expect(await loadPacks(env.CONFIG, tenant)).toEqual({});
  });
});
