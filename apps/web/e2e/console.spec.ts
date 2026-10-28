import { expect, test } from '@playwright/test';
import { NOW, REQ_ID, sessionBody } from '../src/test/fixtures';
import { json, mockApi } from './helpers';

const handoff = (status: 'open' | 'released') => ({
  id: 'ho_01J9ZZZZZZZZZZZZZZZZZZZZZ1',
  request_id: REQ_ID,
  call_id: 'call_1',
  run_id: '7d1e0c2a-2222-4333-8444-555566667777',
  customer_id: 'cus_saksham',
  action: 'transfer.new_payee',
  summary: 'Send ₹45,000 to a new payee, account ending 4471',
  reasons: ['P_TIER3_STEP_UP', 'S_COACHING', 'H_SPECIALIST'],
  reason: 'S_COACHING',
  status,
  note: null,
  checkin: { at: '2026-10-29T05:30:00.000Z', why: 'coaching', status: 'scheduled' },
  created_at: NOW,
  resolved_at: status === 'open' ? null : NOW,
});

test('Console Handoffs: a coaching hold is released by a specialist', async ({ page }) => {
  let status: 'open' | 'released' = 'open';
  await mockApi(page, {
    'POST /web/session': (route) => json(route, sessionBody('console')),
    'GET /web/handoffs': (route) => json(route, { handoffs: [handoff(status)] }),
    'POST /web/handoffs/ho_01J9ZZZZZZZZZZZZZZZZZZZZZ1/resolve': (route, body) => {
      expect(body).toEqual({ action: 'release' });
      status = 'released';
      return json(route, { ok: true, status: 'released' });
    },
  });
  await page.goto('/console/handoffs');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Handoffs');
  const item = page.getByTestId('handoff');
  await expect(item).toContainText('OPEN');
  await expect(item).toContainText('Check-in call');
  await item.getByRole('button', { name: 'Release' }).click();
  await expect(item).toContainText('RELEASED');
});
