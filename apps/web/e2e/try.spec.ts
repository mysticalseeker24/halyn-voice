import { expect, test } from '@playwright/test';
import { json, mockApi, mockHub, screenshotPath } from './helpers';
import { aeroHome, sessionBody } from '../src/test/fixtures';

// Judges (pitch deck slide 13, docs/JUDGES.md): the landing page's "Try Halyn" opens /try; the sign-up sends the
// code, name and an E.164 number, and the Aero app then signs in as the judge's own customer.

test.use({ viewport: { width: 390, height: 844 } });

const JUDGE_ID = 'cus_judge_01M69G82SRK7XCRGZE2JT44HSS';

test('"Try Halyn" on the landing page leads to the sign-up, even on a phone', async ({ page }) => {
  await page.goto('/');
  const cta = page.getByRole('link', { name: 'Try Halyn' }).first();
  await expect(cta).toBeVisible();
  await expect(cta).toHaveAttribute('href', '/try');
  await cta.click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Try Halyn on your own phone');
});

test('a judge signs up and lands in the Aero app as their own customer', async ({ page }) => {
  let signup: unknown = null;
  let sessionFor: unknown = null;
  await mockApi(page, {
    'POST /web/judges/signup': (route, body) => {
      signup = body;
      return json(route, { ...sessionBody(), customer_id: JUDGE_ID });
    },
    'POST /web/session': (route, body) => {
      sessionFor = body;
      return json(route, { ...sessionBody(), customer_id: JUDGE_ID });
    },
    'GET /web/aero/home': (route) => json(route, aeroHome()),
  });
  await mockHub(page);
  await page.goto('/try');
  await page.getByLabel('Access code').fill('HALYN-JUDGE-TEST');
  await page.getByLabel(/Your name/).fill('Asha Rao');
  await page.getByLabel(/Your mobile number/).fill(['90000', '00077'].join(' '));
  await page.screenshot({ path: screenshotPath('try'), fullPage: true });
  await page.getByRole('button', { name: 'Create my Aero Bank account' }).click();
  await expect(page).toHaveURL(/\/aero$/);
  await expect(page.getByTestId('balance')).toBeVisible();
  expect(signup).toEqual({ code: 'HALYN-JUDGE-TEST', name: 'Asha Rao', phone: `+91${'90000' + '00077'}` });
  // The cached judge session is used; a fresh sign-in (if any) asks for the judge's own customer.
  if (sessionFor !== null) expect(sessionFor).toEqual({ kind: 'customer', customer_id: JUDGE_ID });
});

test('a wrong code says so and stays on the form', async ({ page }) => {
  await mockApi(page, {
    'POST /web/judges/signup': (route) =>
      json(
        route,
        { error: { code: 'E_UNAUTHORIZED', message: 'That judge access code was not accepted' } },
        401,
      ),
  });
  await page.goto('/try');
  await page.getByLabel('Access code').fill('not-the-code');
  await page.getByLabel(/Your name/).fill('Asha Rao');
  await page.getByLabel(/Your mobile number/).fill(['90000', '00077'].join(''));
  await page.getByRole('button', { name: 'Create my Aero Bank account' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'access code' })).toHaveText(
    'That access code was not accepted.',
  );
  await expect(page).toHaveURL(/\/try$/);
});
