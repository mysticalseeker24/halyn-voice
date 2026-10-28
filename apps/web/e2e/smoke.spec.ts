import { expect, test } from '@playwright/test';

const apps = [{ path: '/console', heading: 'Halyn Console' }];

test('home links to the four apps', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Halyn');
  const nav = page.getByRole('navigation', { name: 'Apps' });
  await expect(nav.getByRole('link')).toHaveCount(4);
});

for (const app of apps) {
  test(`${app.path} renders its placeholder`, async ({ page }) => {
    await page.goto(app.path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(app.heading);
  });
}

// /stage, /aero and /assistant have their own specs (they need the mocked API).
