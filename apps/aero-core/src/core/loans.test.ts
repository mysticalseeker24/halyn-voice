import { CORE_RESPONSES } from '@halyn/shared';
import { describe, expect, it } from 'vitest';
import { rows, seedCustomer, testEnv } from '../../test/fixtures/env';
import { mintGrant } from '../../test/fixtures/grants';
import { coreRequest, reply, testApp } from '../../test/fixtures/http';

const NOW_MS = Date.UTC(2026, 9, 27, 4, 30, 0);
const NOW_S = NOW_MS / 1000;
const send = testApp(NOW_MS);

async function move(sub: string, params: { loan_id: string; new_day: number }) {
  const grant = await mintGrant({ action: 'emi.move_date', params, sub, iat: NOW_S });
  return { grant, res: await reply(send(coreRequest('emi.move_date', params, grant.token))) };
}

describe('POST /core/loans/emi-date (emi.move_date, scenario 5)', () => {
  it('moves the EMI from the 5th to the 10th', async () => {
    const sub = await seedCustomer();
    const { grant, res } = await move(sub, { loan_id: 'loan_personal_1', new_day: 10 });
    expect(res.status).toBe(200);
    expect(CORE_RESPONSES['emi.move_date'].parse(res.body)).toEqual({
      action: 'emi.move_date',
      reference: `AERO-${grant.jti.slice(-6)}`,
      loan: { id: 'loan_personal_1', emi_day: 10, previous_emi_day: 5 },
    });
    expect(
      await rows('SELECT emi_day, updated_at, updated_by_grant FROM loans WHERE customer_ref = ?', sub),
    ).toEqual([{ emi_day: 10, updated_at: new Date(NOW_MS).toISOString(), updated_by_grant: grant.jti }]);
  });

  it('an unknown loan → 404; a closed loan → 400; neither changes anything', async () => {
    const sub = await seedCustomer();
    expect((await move(sub, { loan_id: 'loan_nope', new_day: 10 })).res.status).toBe(404);
    await testEnv().DB.prepare("UPDATE loans SET status = 'closed' WHERE customer_ref = ?").bind(sub).run();
    const closed = await move(sub, { loan_id: 'loan_personal_1', new_day: 10 });
    expect(closed.res).toEqual({
      status: 400,
      body: { error: { code: 'E_BAD_REQUEST', message: 'This loan is closed' } },
    });
    expect(await rows('SELECT emi_day FROM loans WHERE customer_ref = ?', sub)).toEqual([{ emi_day: 5 }]);
  });

  it('the US twin has no loans', async () => {
    const sub = await seedCustomer('US');
    expect((await move(sub, { loan_id: 'loan_personal_1', new_day: 10 })).res.status).toBe(404);
  });
});
