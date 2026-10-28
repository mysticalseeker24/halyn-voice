import { type Clock, errorEnvelope, fixedClock, importSigningKey } from '@halyn/shared';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { aeroCore } from '../../test/fixtures/aero-core';
import { seededRng } from '../../test/fixtures/crypto';
import { type SignedGrant, signGrant } from '../grants';
import { buildCoreRequest, type CoreTransport, callCore, referenceFor } from './client';

const NOW = Date.now();
const CLOCK = fixedClock(NOW);
const keys = env as unknown as { HALYN_SIGNING_KEY: string };

async function grant(
  action: 'card.freeze' | 'statement.view' | 'fee.waive',
  params: Record<string, unknown>,
  tenant = 'ten_aero',
  clock: Clock = CLOCK,
): Promise<SignedGrant> {
  const signer = await importSigningKey(keys.HALYN_SIGNING_KEY);
  return signGrant(
    { tenant, sub: 'cus_saksham', action, params, request_id: 'req_core_test' },
    signer,
    clock,
    seededRng(Math.floor(Math.random() * 1e9)),
  );
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A transport that answers from a script and records how often it was called. */
function scripted(...answers: (Response | Error)[]): CoreTransport & { calls: number } {
  const fn = Object.assign(
    async () => {
      const next = answers[Math.min(fn.calls, answers.length - 1)];
      fn.calls += 1;
      if (next instanceof Error) throw next;
      return next!.clone();
    },
    { calls: 0 },
  );
  return fn;
}

const EXECUTED = {
  outcome: 'executed',
  reference: 'AERO-ABC123',
  request_id: 'req_core_test',
  used_at: '2026-10-28T10:00:00.000Z',
};

describe('buildCoreRequest', () => {
  it('GET routes take the params as the query string, POST routes as the JSON body, with the grant header', async () => {
    const get = buildCoreRequest('statement.view', { account: 'savings' }, 'tok');
    expect(get.method).toBe('GET');
    expect(new URL(get.url).pathname + new URL(get.url).search).toBe('/core/statement?account=savings');
    expect(get.headers.get('x-halyn-grant')).toBe('tok');
    const post = buildCoreRequest('card.freeze', { card_last4: '8812' }, 'tok');
    expect(post.method).toBe('POST');
    expect(await post.json()).toEqual({ card_last4: '8812' });
  });

  it('refuses a non-string GET param (it could not hash the same on both sides)', () => {
    expect(() => buildCoreRequest('statement.view', { account: 1 }, 'tok')).toThrow(/not a string/);
  });
});

describe('callCore outcome table (docs/API.md → "The API\'s core client must")', () => {
  const freeze = { card_last4: '8812' };
  const body200 = {
    action: 'card.freeze',
    reference: 'AERO-ABC123',
    card: { last4: '8812', status: 'frozen' },
    already_frozen: false,
  };

  it.each([
    [
      '200 → executed with the body',
      [json(body200, 200)],
      { status: 'executed', reference: 'AERO-ABC123', fresh: true },
      1,
    ],
    [
      '401 REUSED + executed → executed earlier (never "not executed")',
      [json(errorEnvelope('E_GRANT_REUSED', 'used', EXECUTED), 401)],
      { status: 'executed', reference: 'AERO-ABC123', fresh: false, body: null },
      1,
    ],
    [
      '500 + executed → executed',
      [json(errorEnvelope('E_FAIL_CLOSED', 'x', EXECUTED), 500)],
      { status: 'executed', fresh: false },
      1,
    ],
    [
      '500 unknown, then REUSED + executed → executed (one retry, same grant)',
      [
        json(errorEnvelope('E_FAIL_CLOSED', 'x', { outcome: 'unknown' }), 500),
        json(errorEnvelope('E_GRANT_REUSED', 'used', EXECUTED), 401),
      ],
      { status: 'executed', fresh: false },
      2,
    ],
    [
      'network error, then 200 → executed',
      [new Error('reset'), json(body200, 200)],
      { status: 'executed', fresh: true },
      2,
    ],
    [
      'unknown twice → unknown (fail closed, reconcile)',
      [json(errorEnvelope('E_FAIL_CLOSED', 'x', { outcome: 'unknown' }), 500)],
      { status: 'unknown', http: 500 },
      2,
    ],
    ['timeouts twice → unknown', [new Error('timeout')], { status: 'unknown', http: null }, 2],
    [
      'a 502 with no envelope → retried, then unknown',
      [new Response('bad gateway', { status: 502 })],
      { status: 'unknown', http: 502 },
      2,
    ],
    [
      '400 bank refusal → refused, nothing executed',
      [json(errorEnvelope('E_BAD_REQUEST', 'already waived'), 400)],
      { status: 'refused', code: 'E_BAD_REQUEST', http: 400 },
      1,
    ],
    [
      '404 → refused',
      [json(errorEnvelope('E_NOT_FOUND', 'no card'), 404)],
      { status: 'refused', code: 'E_NOT_FOUND', http: 404 },
      1,
    ],
    [
      '401 expired → refused, no retry',
      [json(errorEnvelope('E_GRANT_EXPIRED', 'expired'), 401)],
      { status: 'refused', code: 'E_GRANT_EXPIRED', http: 401 },
      1,
    ],
    [
      'REUSED without its outcome hint → unknown (cannot tell)',
      [json(errorEnvelope('E_GRANT_REUSED', 'used'), 401)],
      { status: 'unknown', http: 401 },
      1,
    ],
  ] as const)('%s', async (_, answers, expected, calls) => {
    const transport = scripted(...answers);
    const result = await callCore({
      transport,
      grant: await grant('card.freeze', freeze),
      action: 'card.freeze',
      params: freeze,
      clock: CLOCK,
    });
    expect(result).toMatchObject(expected);
    expect(transport.calls).toBe(calls);
  });

  it('a 200 whose body does not parse is still executed, with the jti reference', async () => {
    const g = await grant('card.freeze', freeze);
    const result = await callCore({
      transport: scripted(json({ nope: true }, 200)),
      grant: g,
      action: 'card.freeze',
      params: freeze,
      clock: CLOCK,
    });
    expect(result).toEqual({
      status: 'executed',
      reference: referenceFor(g.claims.jti),
      fresh: true,
      body: null,
    });
  });

  it('an expired-grant refusal after a lost first attempt is unknown, never "not executed"', async () => {
    const transport = scripted(new Error('reset'), json(errorEnvelope('E_GRANT_EXPIRED', 'expired'), 401));
    const result = await callCore({
      transport,
      grant: await grant('card.freeze', freeze),
      action: 'card.freeze',
      params: freeze,
      clock: CLOCK,
    });
    expect(result).toEqual({ status: 'unknown', http: 401 });
    expect(transport.calls).toBe(2);
  });

  it('a grant presented before (the Hub sweep): an expired refusal on the first attempt is unknown too', async () => {
    const g = await grant('card.freeze', freeze);
    const expired = () => scripted(json(errorEnvelope('E_GRANT_EXPIRED', 'expired'), 401));
    const input = { grant: g, action: 'card.freeze' as const, params: freeze, clock: CLOCK };
    expect(await callCore({ ...input, transport: expired(), presentedBefore: true })).toEqual({
      status: 'unknown',
      http: 401,
    });
    // A bank refusal stays a refusal: Aero Core checks the jti before any business rule.
    const refused = scripted(json(errorEnvelope('E_BAD_REQUEST', 'no'), 400));
    expect(await callCore({ ...input, transport: refused, presentedBefore: true })).toEqual({
      status: 'refused',
      code: 'E_BAD_REQUEST',
      http: 400,
    });
  });

  it('does not retry once the grant has expired', async () => {
    let now = NOW;
    const clock = { nowMs: () => now };
    const g = await grant('card.freeze', freeze, 'ten_aero', clock);
    const transport = Object.assign(
      async () => {
        transport.calls += 1;
        now += 120_000;
        throw new Error('timeout');
      },
      { calls: 0 },
    );
    const result = await callCore({ transport, grant: g, action: 'card.freeze', params: freeze, clock });
    expect(result).toEqual({ status: 'unknown', http: null });
    expect(transport.calls).toBe(1);
  });

  it('a GET with a non-string param is refused without calling Aero Core', async () => {
    const transport = scripted(json({}, 200));
    const result = await callCore({
      transport,
      grant: await grant('statement.view', { account: 'savings' }),
      action: 'statement.view',
      params: { account: 7 },
      clock: CLOCK,
    });
    expect(result).toEqual({ status: 'refused', code: 'E_FAIL_CLOSED', http: 0 });
    expect(transport.calls).toBe(0);
  });
});

describe('callCore against the real Aero Core (in-process, Miniflare D1)', () => {
  it('executes once; a retry of the same grant is "executed earlier" with the same reference', async () => {
    const tenant = `ten_core${Date.now().toString(36)}`;
    const rng = seededRng(5);
    const core = await aeroCore(tenant, CLOCK, rng);
    const g = await grant('card.freeze', { card_last4: '8812' }, tenant);
    const first = await callCore({
      transport: core.transport,
      grant: g,
      action: 'card.freeze',
      params: { card_last4: '8812' },
      clock: CLOCK,
    });
    expect(first).toMatchObject({ status: 'executed', fresh: true, reference: referenceFor(g.claims.jti) });
    const again = await callCore({
      transport: core.transport,
      grant: g,
      action: 'card.freeze',
      params: { card_last4: '8812' },
      clock: CLOCK,
    });
    expect(again).toEqual({
      status: 'executed',
      reference: referenceFor(g.claims.jti),
      fresh: false,
      body: null,
    });
  });

  it('a read executes and gets the jti reference; a bank refusal leaves nothing executed', async () => {
    const tenant = `ten_core${Date.now().toString(36)}r`;
    const core = await aeroCore(tenant, CLOCK, seededRng(6));
    const read = await grant('statement.view', { account: 'savings' }, tenant);
    const statement = await callCore({
      transport: core.transport,
      grant: read,
      action: 'statement.view',
      params: { account: 'savings' },
      clock: CLOCK,
    });
    expect(statement).toMatchObject({ status: 'executed', reference: referenceFor(read.claims.jti) });
    const waive = { amount_minor: 1, currency: 'INR', fee_id: 'fee_late_oct' };
    const refused = await callCore({
      transport: core.transport,
      grant: await grant('fee.waive', waive, tenant),
      action: 'fee.waive',
      params: waive,
      clock: CLOCK,
    });
    expect(refused).toEqual({ status: 'refused', code: 'E_BAD_REQUEST', http: 400 });
  });
});
