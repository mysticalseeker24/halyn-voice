import { expect, type Page, test, type WebSocketRoute } from '@playwright/test';
import {
  callLine,
  confirmRequest,
  confirmResolved,
  decisionMessage,
  HASH_A,
  HASH_B,
  ledgerAppend,
  sessionBody,
} from '../src/test/fixtures';
import { API, json, mockApi, mockHub, screenshotPath } from './helpers';

test.use({ viewport: { width: 1920, height: 1080 } });

const push = (ws: WebSocketRoute, ...messages: unknown[]) => {
  for (const m of messages) ws.send(JSON.stringify(m));
};

async function expectNoScroll(page: Page) {
  const dims = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    sh: document.documentElement.scrollHeight,
    bw: document.body.scrollWidth,
    bh: document.body.scrollHeight,
    iw: window.innerWidth,
    ih: window.innerHeight,
  }));
  expect(dims.iw).toBe(1920);
  expect(dims.ih).toBe(1080);
  expect(dims.sw).toBeLessThanOrEqual(1920);
  expect(dims.sh).toBeLessThanOrEqual(1080);
  expect(dims.bw).toBeLessThanOrEqual(1920);
  expect(dims.bh).toBeLessThanOrEqual(1080);
}

test('Stage runs scenario 3 with a mocked API: step-up, declined, denied, chain verified', async ({
  page,
}) => {
  let ran = false;
  await mockApi(page, {
    'POST /web/session': (route) => json(route, sessionBody('console')),
    'GET /web/ledger': (route) => json(route, { entries: [], head_hash: null }),
    'GET /web/ledger/verify': (route) => json(route, { ok: true, entries: 3, head_hash: HASH_B }),
    'POST /web/stage/run/3': (route, body) => {
      expect(body).toEqual({ mode: 'text' });
      ran = true;
      return json(route, { test_run_id: 'run_3', scenario: '3', mode: 'text' });
    },
  });
  const hub = await mockHub(page);
  await page.goto('/stage');
  const ws = await hub.next();

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Halyn Stage');
  await expect(page.getByText('Hub: live')).toBeVisible();
  await expectNoScroll(page);

  // Empty state before any scenario.
  await expect(page.getByText('No call yet. Pick a scenario above.')).toBeVisible();
  await page.screenshot({ path: screenshotPath('stage-v1-empty') });

  await page.getByRole('button', { name: '3 · Clone attack' }).click();
  await expect.poll(() => ran).toBe(true);

  push(
    ws,
    callLine('caller', 'Send forty-five thousand rupees to a new account ending 4471.'),
    callLine('agent', 'I have asked Halyn. It needs the account holder to confirm first.'),
    decisionMessage('step_up', ['P_TIER3_STEP_UP', 'S_UNREGISTERED_NUMBER']),
    { ...confirmRequest() },
    { ...ledgerAppend(1, 'proposed'), prev_hash: '0'.repeat(64), hash: HASH_A },
    ledgerAppend(2, 'decided'),
    ledgerAppend(3, 'confirm_requested'),
  );
  const decision = page.getByRole('region', { name: 'Halyn decision' });
  await expect(decision.getByText('STEP-UP')).toBeVisible();
  await expect(page.getByTestId('aero-prompt')).toContainText('₹45,000');

  push(
    ws,
    confirmResolved('declined'),
    decisionMessage('deny', ['P_TIER3_STEP_UP', 'S_UNREGISTERED_NUMBER', 'C_DECLINED']),
    ledgerAppend(4, 'confirmed'),
    {
      type: 'test_progress',
      at: '2026-10-28T10:00:09.000Z',
      test_run_id: 'run_3',
      scenario_id: '3',
      status: 'passed',
      completed: 1,
      total: 1,
    },
  );
  await expect(decision.getByText('DENIED')).toBeVisible();
  await expect(page.getByTestId('confirm-status')).toContainText('DECLINED via passkey');
  await expect(page.getByText(/Chain verified/)).toBeVisible();
  await expect(page.getByRole('list', { name: 'Ledger' }).getByRole('listitem')).toHaveCount(4);
  await expect(page.getByRole('list', { name: 'Event timeline' })).toBeVisible();

  await expectNoScroll(page);
  await page.screenshot({ path: screenshotPath('stage-v1') });
});

test('Stage shows HELD for the coached customer (scenario 4) without scrolling', async ({ page }) => {
  await mockApi(page, {
    'POST /web/session': (route) => json(route, sessionBody('console')),
    'GET /web/ledger': (route) => json(route, { entries: [], head_hash: null }),
    'GET /web/ledger/verify': (route) => json(route, { ok: true, entries: 0, head_hash: null }),
    'POST /web/stage/run/4': (route) => json(route, { test_run_id: 'run_4', scenario: '4', mode: 'text' }),
  });
  const hub = await mockHub(page);
  await page.goto('/stage');
  const ws = await hub.next();
  await page.getByRole('button', { name: '4 · Coached customer' }).click();
  push(
    ws,
    callLine('caller', 'The officer said not to tell anyone. Move four lakh eighty thousand.'),
    decisionMessage('hold', ['S_COACHING', 'H_SPECIALIST']),
    {
      type: 'handoff',
      at: '2026-10-28T10:00:02.000Z',
      handoff_id: 'hnd_1',
      request_id: 'req_01J9ZZZZZZZZZZZZZZZZZZZZZ1',
      reasons: ['S_COACHING'],
      status: 'open',
    },
  );
  const decision = page.getByRole('region', { name: 'Halyn decision' });
  await expect(decision.locator('[data-outcome="hold"]')).toHaveText(/HELD/);
  await expect(decision.getByText(/Specialist handoff: open/)).toBeVisible();
  await expect(page.getByText('No confirmation requested.')).toBeVisible();
  await expectNoScroll(page);
});

test('Stage shows an error state when sign-in fails, and recovers on retry', async ({ page }) => {
  let healthy = false;
  await mockApi(page, {
    'POST /web/session': (route) =>
      healthy
        ? json(route, sessionBody('console'))
        : json(route, { error: { code: 'E_FAIL_CLOSED', message: 'Halyn is unavailable' } }, 503),
    'GET /web/ledger': (route) => json(route, { entries: [], head_hash: null }),
    'GET /web/ledger/verify': (route) => json(route, { ok: true, entries: 0, head_hash: null }),
  });
  await mockHub(page);
  await page.goto('/stage');
  await expect(page.getByRole('alert').filter({ hasText: 'Halyn is unavailable' })).toBeVisible();
  healthy = true;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('group', { name: 'Scenarios' })).toBeVisible();
});

test('Stage asks for the demo access code, remembers it for the tab and signs in', async ({ page }) => {
  const refused = { error: { code: 'E_UNAUTHORIZED', message: 'A valid demo access code is required' } };
  const seen: (string | undefined)[] = [];
  await mockApi(page, {
    'GET /web/ledger': (route) => json(route, { entries: [], head_hash: null }),
    'GET /web/ledger/verify': (route) => json(route, { ok: true, entries: 0, head_hash: null }),
  });
  await page.route(`${API}/web/session`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': 'authorization, content-type, x-demo-code',
          'access-control-allow-methods': 'POST, OPTIONS',
        },
      });
      return;
    }
    const code = request.headers()['x-demo-code'];
    seen.push(code);
    await json(
      route,
      code === 'open-sesame' ? sessionBody('console') : refused,
      code === 'open-sesame' ? 200 : 401,
    );
  });
  await mockHub(page);
  await page.goto('/stage');
  const field = page.getByLabel('Demo access code');
  await expect(field).toBeVisible();
  await field.fill('wrong-code');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'not accepted' })).toBeVisible();
  await page.getByLabel('Demo access code').fill('open-sesame');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('group', { name: 'Scenarios' })).toBeVisible();
  expect(seen).toEqual([undefined, 'wrong-code', 'open-sesame']);
  expect(await page.evaluate(() => window.sessionStorage.getItem('halyn.demo-code'))).toBe('open-sesame');
  await page.screenshot({ path: screenshotPath('stage-v1-demo-code') });
});
