import { expect, test } from '@playwright/test';
import { NOW, REQ_ID, sessionBody } from '../src/test/fixtures';
import { json, mockApi, screenshotPath } from './helpers';

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
  await page.screenshot({ path: screenshotPath('console-handoffs'), fullPage: true });
});

const ledgerEntry = {
  seq: 1,
  tenant_id: 'ten_aero',
  type: 'proposed',
  ref_id: REQ_ID,
  payload: {},
  prev_hash: '0'.repeat(64),
  hash: 'a'.repeat(64),
  created_at: NOW,
};

test('Console Ledger: the chain lists and verifies', async ({ page }) => {
  await mockApi(page, {
    'POST /web/session': (route) => json(route, sessionBody('console')),
    'GET /web/ledger': (route) => json(route, { entries: [ledgerEntry], head_hash: 'a'.repeat(64) }),
    'GET /web/ledger/verify': (route) => json(route, { ok: true, entries: 1, head_hash: 'a'.repeat(64) }),
  });
  await page.goto('/console/ledger');
  await expect(page.getByRole('table', { name: 'Ledger' })).toContainText('proposed');
  await page.getByRole('button', { name: 'Verify chain' }).click();
  await expect(page.getByText('Chain verified · 1 entries')).toBeVisible();
});

test('Console Passes: a specialist revokes an active Pass', async ({ page }) => {
  let status: 'active' | 'revoked' = 'active';
  const pass = () => ({
    id: 'pass_demo',
    customer_id: 'cus_saksham',
    assistant_name: "Saksham's Assistant",
    assistant_numbers: ['+919000000002'],
    scopes: [{ action: 'statement.view' }],
    status,
    issued_at: NOW,
    expires_at: NOW,
  });
  await mockApi(page, {
    'POST /web/session': (route) => json(route, sessionBody('console')),
    'GET /web/console/passes': (route) => json(route, { passes: [pass()] }),
    'DELETE /web/console/passes/pass_demo': (route) => {
      status = 'revoked';
      return json(route, { pass: pass() });
    },
  });
  await page.goto('/console/passes');
  const row = page.getByTestId('pass-row');
  await expect(row).toContainText('ACTIVE');
  await row.getByRole('button', { name: 'Revoke' }).click();
  await expect(row).toContainText('REVOKED');
});

test('Halyn Test: running the US pack fills the scorecard', async ({ page }) => {
  const run = (results: unknown[]) => ({
    id: 'trun_01J9ZZZZZZZZZZZZZZZZZZZZZ2',
    region: 'US',
    mode: 'text',
    started_at: NOW,
    scenarios: ['10'],
    results,
  });
  const card = (done: boolean) => ({
    ungranted_writes: 0,
    attacks_stopped: 0,
    attacks_total: 0,
    tasks_completed: 0,
    tasks_total: 0,
    median_propose_ms: done ? 38 : null,
    passed: done ? 1 : 0,
    failed: 0,
    skipped: 0,
    pending: done ? 0 : 1,
  });
  let done = false;
  const response = () => ({
    run: run(
      done
        ? [
            {
              scenario_id: '10',
              title: 'US wire above limit (browser call)',
              status: 'passed',
              failures: [],
              skipped: [],
              ungranted_writes: 0,
              propose_ms: [38],
              finished_at: NOW,
            },
          ]
        : [],
    ),
    scorecard: card(done),
    previous: null,
  });
  await mockApi(page, {
    'POST /web/session': (route) => json(route, sessionBody('console')),
    'GET /web/tests/runs/latest': (route) =>
      json(route, { error: { code: 'E_NOT_FOUND', message: 'No such test run' } }, 404),
    'POST /web/tests/runs': (route, body) => {
      expect(body).toEqual({ region: 'US' });
      return json(route, response(), 201);
    },
    'POST /web/stage/run/10': (route, body) => {
      expect(body).toEqual({ mode: 'text', suite_run_id: 'trun_01J9ZZZZZZZZZZZZZZZZZZZZZ2' });
      done = true;
      return json(route, { test_run_id: 'trun_01J9ZZZZZZZZZZZZZZZZZZZZZ2', scenario: '10', mode: 'text' });
    },
    'GET /web/tests/runs/trun_01J9ZZZZZZZZZZZZZZZZZZZZZ2': (route) => json(route, response()),
    'GET /web/tests/permission-map': (route) => json(route, { graphs: [] }),
    'GET /web/tests/voice': (route) => json(route, { personas: [], calling_window: false, bolna: true }),
  });
  await page.goto('/console/test?region=US');
  await expect(page.getByText('No test run yet')).toBeVisible();
  await page.getByRole('button', { name: 'Test the US pack' }).click();
  const row = page.getByTestId('scenario-row');
  await expect(row).toContainText('PASSED');
  const scorecard = page.getByRole('group', { name: 'Scorecard' });
  await expect(scorecard).toContainText('0PASS');
  await expect(scorecard).toContainText('38 ms');
  await page.screenshot({ path: screenshotPath('console-test'), fullPage: true });
});
