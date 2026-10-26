import { base64urlDecode, base64urlEncode, canonicalJson, HalynError, utf8 } from '@halyn/shared';
import { describe, expect, it } from 'vitest';
import { SESSION_SECRET } from '../../test/fixtures/api';
import { SESSION_MAX_TTL_SECONDS, SESSION_TYP, signSession, verifySession } from './session';

const NOW = Date.UTC(2026, 9, 26, 10, 0, 0);
const customer = { tenant_id: 'ten_aero', kind: 'customer' as const, customer_id: 'cus_saksham' };

async function hmac(secret: string, input: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return base64urlEncode(new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8(input))));
}

/** A token with any header/claims, correctly signed — for confusion attacks that only the schema can stop. */
async function forge(header: unknown, claims: unknown, secret = SESSION_SECRET): Promise<string> {
  const input = `${base64urlEncode(utf8(canonicalJson(header)))}.${base64urlEncode(utf8(canonicalJson(claims)))}`;
  return `${input}.${await hmac(secret, input)}`;
}

const goodClaims = (over: Record<string, unknown> = {}) => ({
  v: 'halyn-session/0.1',
  tenant: 'ten_aero',
  kind: 'customer',
  sub: 'cus_saksham',
  iat: NOW / 1000,
  exp: NOW / 1000 + 3600,
  ...over,
});

describe('session tokens', () => {
  it('round-trip a customer and a console session; the tenant comes from the token', async () => {
    const { token, session } = await signSession(customer, SESSION_SECRET, NOW);
    expect(session).toEqual({
      tenant_id: 'ten_aero',
      kind: 'customer',
      customer_id: 'cus_saksham',
      expires_at: new Date(NOW + SESSION_MAX_TTL_SECONDS * 1000).toISOString(),
    });
    expect(await verifySession(token, SESSION_SECRET, NOW + 1000)).toEqual(session);
    const consoleToken = (
      await signSession({ tenant_id: 'ten_aero', kind: 'console', customer_id: null }, SESSION_SECRET, NOW)
    ).token;
    expect((await verifySession(consoleToken, SESSION_SECRET, NOW))?.customer_id).toBeNull();
  });

  it('refuse a forged signature, a wrong secret and a tampered payload or header', async () => {
    const { token } = await signSession(customer, SESSION_SECRET, NOW);
    const [h = '', p = '', s = ''] = token.split('.');
    expect(await verifySession(token, 'another-secret-0123456789abcdef0123456789', NOW)).toBeNull();
    const otherPayload = base64urlEncode(utf8(canonicalJson(goodClaims({ sub: 'cus_someone_else' }))));
    expect(await verifySession(`${h}.${otherPayload}.${s}`, SESSION_SECRET, NOW)).toBeNull();
    const otherHeader = base64urlEncode(utf8(canonicalJson({ alg: 'HS256', typ: SESSION_TYP, kid: 'x' })));
    expect(await verifySession(`${otherHeader}.${p}.${s}`, SESSION_SECRET, NOW)).toBeNull();
    const flipped = base64urlDecode(s) as Uint8Array;
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    expect(await verifySession(`${h}.${p}.${base64urlEncode(flipped)}`, SESSION_SECRET, NOW)).toBeNull();
  });

  it('refuse alg and typ confusion even when the HMAC is right', async () => {
    for (const header of [
      { alg: 'none', typ: SESSION_TYP },
      { alg: 'EdDSA', typ: SESSION_TYP },
      { alg: 'HS512', typ: SESSION_TYP },
      { alg: 'HS256', typ: 'halyn-grant+jwt' },
      { alg: 'HS256', typ: 'halyn-pass+jwt' },
      { alg: 'HS256' },
    ])
      expect(
        await verifySession(await forge(header, goodClaims()), SESSION_SECRET, NOW),
        JSON.stringify(header),
      ).toBeNull();
  });

  it('refuse expired, future-dated, over-long and inconsistent claims', async () => {
    const header = { alg: 'HS256', typ: SESSION_TYP };
    const t = NOW / 1000;
    const cases: Record<string, unknown>[] = [
      goodClaims({ exp: t }), // expired exactly now
      goodClaims({ iat: t + 6, exp: t + 600 }), // issued in the future
      goodClaims({ exp: t + SESSION_MAX_TTL_SECONDS + 1 }), // lives over 12 h
      goodClaims({ kind: 'console' }), // console with a customer sub
      goodClaims({ sub: 'console' }), // customer with the console sub
      goodClaims({ tenant: 'aero' }),
      goodClaims({ v: 'halyn-session/0.2' }),
      goodClaims({ admin: true }),
    ];
    for (const claims of cases)
      expect(
        await verifySession(await forge(header, claims), SESSION_SECRET, NOW),
        JSON.stringify(claims),
      ).toBeNull();
    expect(
      await verifySession(await forge(header, goodClaims({ iat: t + 5, exp: t + 600 })), SESSION_SECRET, NOW),
    ).not.toBeNull();
  });

  it('refuse anything that is not a well-formed token', async () => {
    const { token } = await signSession(customer, SESSION_SECRET, NOW);
    const [h = '', p = ''] = token.split('.');
    for (const bad of [
      undefined,
      42,
      '',
      'a.b',
      `${token}.x`,
      `${h}.${p}.!!`,
      `${h}.${p}.AAAA`,
      `${h}.${base64urlEncode(utf8('not json'))}.${await hmac(SESSION_SECRET, `${h}.${base64urlEncode(utf8('not json'))}`)}`,
      'x'.repeat(3000),
    ])
      expect(await verifySession(bad, SESSION_SECRET, NOW)).toBeNull();
  });

  it('refuse to sign a bad ttl or an inconsistent session', async () => {
    for (const ttl of [0, -1, 1.5, SESSION_MAX_TTL_SECONDS + 1])
      await expect(signSession(customer, SESSION_SECRET, NOW, ttl)).rejects.toBeInstanceOf(HalynError);
    await expect(signSession({ ...customer, customer_id: null }, SESSION_SECRET, NOW)).rejects.toBeInstanceOf(
      HalynError,
    );
    await expect(signSession({ ...customer, tenant_id: 'aero' }, SESSION_SECRET, NOW)).rejects.toBeInstanceOf(
      HalynError,
    );
  });
});
