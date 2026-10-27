import {
  base64urlEncode,
  coreEndpoints,
  CoreOutcomeDetailsSchema,
  ErrorEnvelopeSchema,
  utf8,
} from '@halyn/shared';
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { rows, seedCustomer } from '../fixtures/env';
import { type MintOptions, mintGrant, strangerSigner, testSigner } from '../fixtures/grants';
import { BASE, coreRequest, reply } from '../fixtures/http';

// Every 401 path through the real Worker entry point (Miniflare, real clock), and proof that a refused request changes
// nothing: the balance stays, no transaction, no used_grants row. The grant check runs before anything else.

const SAVED = { amount_minor: 490000, currency: 'INR', payee_id: 'payee_landlord' };
const OPENING = 52_000_000;
const fetchCore = (request: Request) => reply(exports.default.fetch(request));

async function state(sub: string, jti?: string) {
  const [account] = await rows<{ balance_minor: number }>(
    'SELECT balance_minor FROM accounts WHERE customer_ref = ?',
    sub,
  );
  const txns = await rows(
    'SELECT id FROM transactions WHERE customer_ref = ? AND grant_jti IS NOT NULL',
    sub,
  );
  const used = jti ? await rows('SELECT jti FROM used_grants WHERE jti = ?', jti) : [];
  return { balance: account?.balance_minor, txns: txns.length, used: used.length };
}

async function attempt(sub: string, mint: Partial<MintOptions>, presented: Record<string, unknown> = SAVED) {
  const grant = await mintGrant({ action: 'transfer.saved', params: SAVED, sub, ...mint });
  const res = await fetchCore(coreRequest('transfer.saved', presented, grant.token));
  return { res, after: await state(sub, grant.jti) };
}

const UNCHANGED = { balance: OPENING, txns: 0, used: 0 };
const now = () => Math.floor(Date.now() / 1000);

describe('401 E_GRANT_MISSING', () => {
  it.each(coreEndpoints().map((e) => [`${e.method} ${e.path}`, e] as const))(
    '%s without a grant',
    async (_, endpoint) => {
      const res = await fetchCore(new Request(`${BASE}${endpoint.path}`, { method: endpoint.method }));
      expect(res).toEqual({
        status: 401,
        body: { error: { code: 'E_GRANT_MISSING', message: 'An x-halyn-grant header is required' } },
      });
    },
  );

  it('scenario 11: a direct POST /core/transfers with the attack params and no grant changes nothing', async () => {
    const sub = await seedCustomer();
    const params = {
      amount_minor: 4500000,
      currency: 'INR',
      payee_account_last4: '4471',
      payee_ifsc: 'AERO0000001',
    };
    const variants: Record<string, string>[] = [{}, { 'x-halyn-grant': '' }, { 'x-halyn-grant': '   ' }];
    for (const headers of variants) {
      const res = await fetchCore(coreRequest('transfer.new_payee', params, null, { headers }));
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ error: { code: 'E_GRANT_MISSING' } });
    }
    expect(await state(sub)).toEqual(UNCHANGED);
  });
});

describe('401 E_GRANT_INVALID', () => {
  const forgedHeader = (header: Record<string, unknown>) => async (sub: string) => {
    const { token } = await mintGrant({ action: 'transfer.saved', params: SAVED, sub });
    const [, payload] = token.split('.');
    return `${base64urlEncode(utf8(JSON.stringify(header)))}.${payload}.${base64urlEncode(new Uint8Array(64))}`;
  };
  const tokens: [string, (sub: string) => Promise<string>][] = [
    [
      'a tampered payload (amount raised, signature kept)',
      async (sub) => {
        const { token, claims } = await mintGrant({ action: 'transfer.saved', params: SAVED, sub });
        const [h, , s] = token.split('.');
        return `${h}.${base64urlEncode(utf8(JSON.stringify({ ...claims, sub: 'cus_other' })))}.${s}`;
      },
    ],
    [
      'a signature from a key Aero Core does not trust',
      async (sub) =>
        (await mintGrant({ action: 'transfer.saved', params: SAVED, sub, signer: await strangerSigner() }))
          .token,
    ],
    [
      'another key under the trusted kid',
      async (sub) =>
        (
          await mintGrant({
            action: 'transfer.saved',
            params: SAVED,
            sub,
            signer: await strangerSigner((await testSigner()).kid),
          })
        ).token,
    ],
    [
      'a Pass token (wrong typ)',
      async (sub) =>
        (await mintGrant({ action: 'transfer.saved', params: SAVED, sub, typ: 'halyn-pass+jwt' })).token,
    ],
    ['alg none', forgedHeader({ alg: 'none', kid: 'test-aero-core', typ: 'halyn-grant+jwt' })],
    ['alg HS256', forgedHeader({ alg: 'HS256', kid: 'test-aero-core', typ: 'halyn-grant+jwt' })],
    ['a malformed token', () => Promise.resolve('eyJhbGciOiJFZERTQSJ9.not-a-grant')],
    [
      'the wrong issuer',
      async (sub) =>
        (await mintGrant({ action: 'transfer.saved', params: SAVED, sub, overrides: { iss: 'mallory' } }))
          .token,
    ],
    [
      'the wrong audience',
      async (sub) =>
        (await mintGrant({ action: 'transfer.saved', params: SAVED, sub, overrides: { aud: 'halyn-api' } }))
          .token,
    ],
    [
      'a lifetime over 120 s',
      async (sub) => (await mintGrant({ action: 'transfer.saved', params: SAVED, sub, ttl: 121 })).token,
    ],
    [
      'issued more than 5 s in the future',
      async (sub) =>
        (await mintGrant({ action: 'transfer.saved', params: SAVED, sub, iat: now() + 30 })).token,
    ],
    [
      'another tenant',
      async (sub) =>
        (await mintGrant({ action: 'transfer.saved', params: SAVED, sub, tenant: 'ten_other' })).token,
    ],
  ];

  it.each(tokens)('%s → 401, nothing changes', async (_, token) => {
    const sub = await seedCustomer();
    const res = await fetchCore(coreRequest('transfer.saved', SAVED, await token(sub)));
    expect(res).toEqual({
      status: 401,
      body: { error: { code: 'E_GRANT_INVALID', message: 'The grant is not valid for this request' } },
    });
    expect(await state(sub)).toEqual(UNCHANGED);
  });

  it('a grant for another action, at this route or another → 401 (a read grant cannot write)', async () => {
    const sub = await seedCustomer();
    const freeze = await mintGrant({ action: 'card.freeze', params: { card_last4: '8812' }, sub });
    const res = await fetchCore(
      new Request(`${BASE}/core/fees/waive`, {
        method: 'POST',
        headers: { 'x-halyn-grant': freeze.token },
        body: '{"card_last4":"8812"}',
      }),
    );
    expect(res.body).toMatchObject({ error: { code: 'E_GRANT_INVALID' } });
    const read = await mintGrant({ action: 'statement.view', params: { account: 'savings' }, sub });
    expect((await fetchCore(coreRequest('transfer.saved', { account: 'savings' }, read.token))).status).toBe(
      401,
    );
    expect(await state(sub)).toEqual(UNCHANGED);
  });
});

describe('401 E_GRANT_EXPIRED', () => {
  it('a grant at or past exp (no leeway) → 401, nothing changes', async () => {
    const sub = await seedCustomer();
    for (const iat of [now() - 60, now() - 61, now() - 3600]) {
      const { res, after } = await attempt(sub, { iat, ttl: 60 });
      expect(res).toEqual({
        status: 401,
        body: { error: { code: 'E_GRANT_EXPIRED', message: 'The grant has expired' } },
      });
      expect(after).toEqual(UNCHANGED);
    }
  });
});

describe('401 E_GRANT_REUSED', () => {
  // Only Halyn holds a grant, so REUSED on a retry of its own grant means "executed earlier" (e.g. the first answer
  // was lost). The error carries the first use, so the API's core client can reconcile instead of saying "denied".
  async function usedRow(jti: string) {
    const [row] = await rows<{ request_id: string; used_at: string }>(
      'SELECT request_id, used_at FROM used_grants WHERE jti = ?',
      jti,
    );
    return row;
  }

  it('the same grant twice: the first executes, the replay is refused, changes nothing, and names the first use', async () => {
    const sub = await seedCustomer();
    const grant = await mintGrant({ action: 'transfer.saved', params: SAVED, sub });
    const first = await fetchCore(coreRequest('transfer.saved', SAVED, grant.token));
    expect(first.status).toBe(200);
    const replay = await fetchCore(coreRequest('transfer.saved', SAVED, grant.token));
    const use = await usedRow(grant.jti);
    expect(replay).toEqual({
      status: 401,
      body: {
        error: {
          code: 'E_GRANT_REUSED',
          message: 'The grant has already been used',
          details: {
            outcome: 'executed',
            reference: first.body.reference,
            request_id: grant.claims.request_id,
            used_at: use?.used_at,
          },
        },
      },
    });
    expect(
      CoreOutcomeDetailsSchema.parse(ErrorEnvelopeSchema.parse(replay.body).error.details),
    ).toMatchObject({
      outcome: 'executed',
    });
    expect(await state(sub, grant.jti)).toEqual({ balance: OPENING - 490000, txns: 1, used: 1 });
  });

  it('a read grant is single use too, and its replay names the first use', async () => {
    const sub = await seedCustomer();
    const params = { account: 'savings' };
    const grant = await mintGrant({ action: 'balance.view', params, sub });
    expect((await fetchCore(coreRequest('balance.view', params, grant.token))).status).toBe(200);
    const replay = await fetchCore(coreRequest('balance.view', params, grant.token));
    expect(replay.body).toEqual({
      error: {
        code: 'E_GRANT_REUSED',
        message: 'The grant has already been used',
        details: {
          outcome: 'executed',
          reference: `AERO-${grant.jti.slice(-6)}`,
          request_id: grant.claims.request_id,
          used_at: (await usedRow(grant.jti))?.used_at,
        },
      },
    });
  });
});

describe('401 E_PARAMS_MISMATCH', () => {
  it.each([
    ['a raised amount', { ...SAVED, amount_minor: 4900000 }],
    ['another payee', { ...SAVED, payee_id: 'payee_mom' }],
    ['an extra key', { ...SAVED, note: 'urgent' }],
    ['a missing key', { amount_minor: 490000, currency: 'INR' }],
    ['the amount as a string', { ...SAVED, amount_minor: '490000' }],
  ])('%s → 401, nothing changes', async (_, presented) => {
    const sub = await seedCustomer();
    const { res, after } = await attempt(sub, {}, presented);
    expect(res).toEqual({
      status: 401,
      body: {
        error: { code: 'E_PARAMS_MISMATCH', message: 'The request parameters do not match the grant' },
      },
    });
    expect(after).toEqual(UNCHANGED);
  });

  it('a body that is not JSON → 401 E_PARAMS_MISMATCH', async () => {
    const sub = await seedCustomer();
    const grant = await mintGrant({ action: 'transfer.saved', params: SAVED, sub });
    const res = await fetchCore(coreRequest('transfer.saved', SAVED, grant.token, { body: 'amount=490000' }));
    expect(res.body).toMatchObject({ error: { code: 'E_PARAMS_MISMATCH' } });
  });

  it('a repeated query key on a read → 401 E_PARAMS_MISMATCH', async () => {
    const sub = await seedCustomer();
    const grant = await mintGrant({ action: 'balance.view', params: { account: 'savings' }, sub });
    const res = await fetchCore(
      new Request(`${BASE}/core/balance?account=savings&account=current`, {
        headers: { 'x-halyn-grant': grant.token },
      }),
    );
    expect(res.body).toMatchObject({ error: { code: 'E_PARAMS_MISMATCH' } });
  });

  it('the same params in another key order are the same params → 200', async () => {
    const sub = await seedCustomer();
    const reordered = {
      payee_id: SAVED.payee_id,
      currency: SAVED.currency,
      amount_minor: SAVED.amount_minor,
    };
    expect((await attempt(sub, {}, reordered)).res.status).toBe(200);
  });
});

describe('the grant’s customer', () => {
  it('acts only on sub’s accounts; a grant for an unknown customer finds nothing (404)', async () => {
    const [mine, theirs] = [await seedCustomer(), await seedCustomer()];
    expect((await attempt(mine, {})).res.status).toBe(200);
    expect(await state(theirs)).toEqual(UNCHANGED);
    const ghost = await attempt('cus_nobody', {});
    expect(ghost.res).toMatchObject({ status: 404, body: { error: { code: 'E_NOT_FOUND' } } });
  });
});
