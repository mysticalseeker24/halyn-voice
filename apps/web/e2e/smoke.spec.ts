import { expect, test } from '@playwright/test';

const apps = [
  { path: '/stage', heading: 'Halyn Stage' },
  { path: '/console', heading: 'Halyn Console' },
  { path: '/aero', heading: 'Aero Bank' },
  { path: '/assistant', heading: "Saksham's Assistant" },
];

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
