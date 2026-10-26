import { CORE_RESPONSES } from '@halyn/shared';
import { describe, expect, it } from 'vitest';
import { rows, seedCustomer } from '../../test/fixtures/env';
import { mintGrant } from '../../test/fixtures/grants';
import { coreRequest, reply, testApp } from '../../test/fixtures/http';

const NOW_MS = Date.UTC(2026, 9, 27, 4, 30, 0);
const NOW_S = NOW_MS / 1000;
const send = testApp(NOW_MS);

async function freeze(sub: string, card_last4 = '8812') {
  const params = { card_last4 };
  const grant = await mintGrant({ action: 'card.freeze', params, sub, iat: NOW_S });
  return { grant, res: await reply(send(coreRequest('card.freeze', params, grant.token))) };
}

describe('POST /core/cards/freeze (card.freeze, scenario 1)', () => {
  it('freezes the customer’s card, records the grant, and answers with a reference', async () => {
    const sub = await seedCustomer();
    const { grant, res } = await freeze(sub);
    expect(res.status).toBe(200);
    expect(CORE_RESPONSES['card.freeze'].parse(res.body)).toEqual({
      action: 'card.freeze',
      reference: `AERO-${grant.jti.slice(-6)}`,
      card: { last4: '8812', status: 'frozen' },
      already_frozen: false,
    });
    expect(
      await rows('SELECT status, frozen_at, updated_by_grant FROM cards WHERE customer_ref = ?', sub),
    ).toEqual([{ status: 'frozen', frozen_at: new Date(NOW_MS).toISOString(), updated_by_grant: grant.jti }]);
    expect(
      await rows('SELECT tenant_id, customer_ref, action, used_at FROM used_grants WHERE jti = ?', grant.jti),
    ).toEqual([
      {
        tenant_id: 'ten_aero',
        customer_ref: sub,
        action: 'card.freeze',
        used_at: new Date(NOW_MS).toISOString(),
      },
    ]);
  });

  it('is idempotent: a second grant on a frozen card succeeds with already_frozen and keeps frozen_at', async () => {
    const sub = await seedCustomer();
    await freeze(sub);
    const second = await freeze(sub);
    expect(second.res.status).toBe(200);
    expect(second.res.body).toMatchObject({ already_frozen: true });
    expect(await rows('SELECT updated_by_grant FROM cards WHERE customer_ref = ?', sub)).toEqual([
      { updated_by_grant: second.grant.jti },
    ]);
  });

  it('an unknown card → 404 E_NOT_FOUND, and the grant is not used up', async () => {
    const sub = await seedCustomer();
    const { grant, res } = await freeze(sub, '0000');
    expect(res).toEqual({
      status: 404,
      body: { error: { code: 'E_NOT_FOUND', message: 'No card ending 0000 for this customer' } },
    });
    expect(await rows('SELECT jti FROM used_grants WHERE jti = ?', grant.jti)).toEqual([]);
  });

  it('acts only on the grant’s customer: another customer’s card with the same last 4 is untouched', async () => {
    const [mine, theirs] = [await seedCustomer(), await seedCustomer()];
    expect((await freeze(mine)).res.status).toBe(200);
    expect(await rows('SELECT status FROM cards WHERE customer_ref = ?', theirs)).toEqual([
      { status: 'active' },
    ]);
  });
});
