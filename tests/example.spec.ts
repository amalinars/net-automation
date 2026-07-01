import { test, expect } from '@playwright/test';

test('basic page open', async ({ page }) => {
  await page.goto('https://example.com');
  await expect(page).toHaveTitle(/Example/);
});
