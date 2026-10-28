import { expect, test } from '@playwright/test';
import { NOW, sessionBody } from '../src/test/fixtures';
import { json, mockApi, mockHub, screenshotPath } from './helpers';

// Saksham's Assistant (Step 10): the Pass card, the task box, and the call it starts (number B → A).

const RUN = '7d1e0c2a-2222-4333-8444-555566667777';
const pass = {
  id: 'pass_demo',
  assistant_name: "Saksham's Assistant",
  assistant_numbers: ['+918065356379'],
  scopes: [{ action: 'statement.view' }, { action: 'card.freeze' }, { action: 'emi.move_date', max_uses: 1 }],
  status: 'active',
  issued_at: NOW,
  expires_at: '2026-11-27T10:00:00.000Z',
};

test('Assistant: Pass card, task, call started on the Pass', async ({ page }) => {
  let task: unknown = null;
  await mockApi(page, {
    'POST /web/session': (route) => json(route, sessionBody()),
    'GET /web/passes': (route) => json(route, { passes: [pass] }),
    'POST /web/assistant/tasks': (route, body) => {
      task = body;
      return json(route, { ok: true, execution_id: RUN }, 201);
    },
  });
  await mockHub(page);
  await page.goto('/assistant');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("Saksham's Assistant");
  await expect(page.getByTestId('pass-card')).toContainText('HALYN PASS');
  await expect(page.getByTestId('pass-card')).toContainText('Move EMI date ×1');
  await page.getByRole('button', { name: 'Call Aero for me' }).click();
  await expect(page.getByText(RUN)).toBeVisible();
  expect(task).toMatchObject({ pass_id: 'pass_demo' });
  await page.screenshot({ path: screenshotPath('assistant'), fullPage: true });
});
