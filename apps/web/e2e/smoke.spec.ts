import { expect, test } from '@playwright/test';
import { screenshotPath } from './helpers';

test('home says what Halyn is and maps the four apps, in light and dark', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText("Don't trust the voice");
  const apps = page.locator('#apps');
  for (const href of ['/stage', '/console', '/aero', '/assistant'])
    await expect(apps.locator(`a[href="${href}"]`)).toHaveCount(1);
  await expect(page.getByRole('link', { name: /Call Aero Bank/ })).toHaveAttribute(
    'href',
    'tel:+918065356344',
  );
  await page.screenshot({ path: screenshotPath('landing'), fullPage: true });
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.screenshot({ path: screenshotPath('landing-dark'), fullPage: true });
});

// /stage, /console, /aero and /assistant have their own specs (they need the mocked API).
