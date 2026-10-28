import { expect, test } from '@playwright/test';

test('home links to the four apps', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Halyn');
  const nav = page.getByRole('navigation', { name: 'Apps' });
  await expect(nav.getByRole('link')).toHaveCount(4);
});

// /stage, /console, /aero and /assistant have their own specs (they need the mocked API).
