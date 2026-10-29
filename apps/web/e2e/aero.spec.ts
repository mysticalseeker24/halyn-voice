import { expect, test } from '@playwright/test';
import {
  aeroHome,
  approvalOptionsBody,
  confirmRequest,
  registerOptionsBody,
  REQ_ID,
  sessionBody,
} from '../src/test/fixtures';
import { addVirtualAuthenticator, json, mockApi, mockHub, screenshotPath } from './helpers';

test.use({ viewport: { width: 390, height: 844 } });

test('Aero home: balance, card, loan, activity, Hindi toggle, no horizontal scroll', async ({ page }) => {
  await mockApi(page, {
    'POST /web/session': (route) => json(route, sessionBody()),
    'GET /web/aero/home': (route) => json(route, aeroHome()),
  });
  await mockHub(page);
  await page.goto('/aero');
  await expect(page.getByTestId('balance')).toHaveText('₹4,82,500.75');
  await expect(page.getByTestId('card-status')).toHaveText('Active');
  await expect(page.getByText('EMI ₹12,500')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: screenshotPath('aero-home'), fullPage: true });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.screenshot({ path: screenshotPath('aero-home-dark'), fullPage: true });
  await page.evaluate(() => document.documentElement.classList.remove('dark'));

  await page.getByRole('button', { name: 'हिन्दी' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('नमस्ते');
  await page.screenshot({ path: screenshotPath('aero-home-hindi'), fullPage: true });
  await page.getByRole('link', { name: /अलर्ट/ }).click();
  await expect(page.getByText('Transfer blocked')).toBeVisible();
});

test('registers a passkey, then approves a request with it (virtual authenticator)', async ({ page }) => {
  await addVirtualAuthenticator(page);

  let registered = false;
  let credentialId = '';
  let registrationBody: { response?: { id?: string; type?: string; response?: Record<string, unknown> } } =
    {};
  let approvalBody: { response?: { id?: string; response?: Record<string, unknown> } } = {};

  await mockApi(page, {
    'POST /web/session': (route) => json(route, sessionBody()),
    'GET /web/aero/home': (route) => json(route, aeroHome({ passkey_registered: registered })),
    'POST /web/passkeys/register/options': (route) => json(route, registerOptionsBody()),
    'POST /web/passkeys/register/verify': (route, body) => {
      registrationBody = body as typeof registrationBody;
      credentialId = registrationBody.response?.id ?? '';
      registered = true;
      return json(route, { ok: true });
    },
    [`POST /web/approvals/${REQ_ID}/options`]: (route) => json(route, approvalOptionsBody(credentialId)),
    [`POST /web/approvals/${REQ_ID}/verify`]: (route, body) => {
      approvalBody = body as typeof approvalBody;
      return json(route, { ok: true, status: 'approved' });
    },
  });
  const hub = await mockHub(page);

  // One-time registration.
  await page.goto('/aero/passkey');
  await hub.next(); // the socket of this page; the next one belongs to /aero
  await page.getByRole('button', { name: 'Create passkey' }).click();
  await expect(page.getByTestId('passkey-ready')).toContainText('Passkey ready');
  expect(registrationBody.response?.type).toBe('public-key');
  expect(credentialId).not.toBe('');
  expect(registrationBody.response?.response).toHaveProperty('attestationObject');
  await page.screenshot({ path: screenshotPath('aero-passkey'), fullPage: true });

  // A step-up arrives over the Hub: the sheet shows the exact action.
  await page.goto('/aero');
  const ws = await hub.next();
  await expect(page.getByTestId('balance')).toBeVisible();
  ws.send(JSON.stringify({ ...confirmRequest(), expires_at: new Date(Date.now() + 60_000).toISOString() }));
  const sheet = page.getByRole('dialog', { name: 'Approve this request?' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId('approval-amount')).toHaveText('₹45,000');
  await expect(sheet.getByTestId('safe-account-warning')).toContainText(
    'never ask you to move money to a safe account',
  );
  for (const name of ['Approve with passkey', 'Decline']) {
    const box = await sheet.getByRole('button', { name }).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({ path: screenshotPath('aero-approval') });

  await sheet.getByRole('button', { name: 'Approve with passkey' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText('Approved. Aero will go ahead.')).toBeVisible();
  expect(approvalBody.response?.id).toBe(credentialId);
  expect(approvalBody.response?.response).toHaveProperty('signature');
  expect(approvalBody.response?.response).toHaveProperty('authenticatorData');
});

test('declining from the sheet sends the decline and closes it', async ({ page }) => {
  let declined = false;
  await mockApi(page, {
    'POST /web/session': (route) => json(route, sessionBody()),
    'GET /web/aero/home': (route) => json(route, aeroHome()),
    [`POST /web/approvals/${REQ_ID}/decline`]: (route) => {
      declined = true;
      return json(route, { ok: true, status: 'declined' });
    },
  });
  const hub = await mockHub(page);
  await page.goto('/aero');
  const ws = await hub.next();
  await expect(page.getByTestId('balance')).toBeVisible();
  ws.send(JSON.stringify({ ...confirmRequest(), expires_at: new Date(Date.now() + 60_000).toISOString() }));
  await page.getByRole('button', { name: 'Decline' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText('Declined. Nothing was done.')).toBeVisible();
  expect(declined).toBe(true);
});

test('shows an error state with retry when the API is down', async ({ page }) => {
  let healthy = false;
  await mockApi(page, {
    'POST /web/session': (route) => json(route, sessionBody()),
    'GET /web/aero/home': (route) =>
      healthy
        ? json(route, aeroHome())
        : json(route, { error: { code: 'E_FAIL_CLOSED', message: 'Halyn is unavailable' } }, 500),
  });
  await mockHub(page);
  await page.goto('/aero');
  await expect(page.getByRole('alert').filter({ hasText: 'Halyn is unavailable' })).toBeVisible();
  healthy = true;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByTestId('balance')).toBeVisible();
});

test('Aero asks for the demo access code and signs in with it', async ({ page }) => {
  let seen: string | undefined;
  await mockApi(page, { 'GET /web/aero/home': (route) => json(route, aeroHome()) });
  await page.route('http://localhost:8787/web/session', async (route) => {
    const request = route.request();
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization, content-type, x-demo-code',
      'access-control-allow-methods': 'POST, OPTIONS',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    seen = request.headers()['x-demo-code'];
    const ok = seen === 'open-sesame';
    return route.fulfill({
      status: ok ? 200 : 401,
      headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify(
        ok
          ? sessionBody()
          : { error: { code: 'E_UNAUTHORIZED', message: 'A valid demo access code is required' } },
      ),
    });
  });
  await mockHub(page);
  await page.goto('/aero');
  const field = page.getByLabel('Demo access code');
  await expect(field).toBeVisible();
  const box = await page.getByRole('button', { name: 'Continue' }).boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: screenshotPath('aero-demo-code') });
  await field.fill('open-sesame');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('balance')).toBeVisible();
  expect(seen).toBe('open-sesame');
});
