import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    keystorm: typeof import('../src/state/store').useGame;
  }
}

const firstWord = (page: Page) =>
  page.waitForFunction(() => window.keystorm.getState().engine?.words[0]?.text, null, { timeout: 10_000 }).then((h) => h.jsonValue() as Promise<string>);

test('play a level, pause, pass, shop and persist', async ({ page }) => {
  await page.goto('/?e2e');
  await page.getByRole('button', { name: 'Play level 1' }).click();
  await expect(page.locator('canvas')).toBeVisible();

  // Type the first falling word.
  const word = await firstWord(page);
  await page.keyboard.type(word);
  await expect(page.getByTestId('buffer')).toHaveText(new RegExp(word));
  await page.keyboard.press('Space');
  await expect(page.getByTestId('score')).not.toHaveText('0');

  // Esc pauses and hides the field; Esc resumes.
  await page.keyboard.press('Escape');
  await expect(page.getByText('PAUSED')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('PAUSED')).toBeHidden();

  // Jump close to the quota and clear one more word.
  await page.evaluate(() => {
    const e = window.keystorm.getState().engine!;
    e.score = e.params.quota - 1;
  });
  const next = await firstWord(page);
  await page.keyboard.type(next + ' ');
  await expect(page.getByText('Level 1 complete!')).toBeVisible({ timeout: 5_000 });

  await page.getByRole('button', { name: 'Continue to shop' }).click();
  await expect(page.getByRole('heading', { name: /Shop/ })).toBeVisible();
  await page.getByTestId('skill-FIRE').getByRole('button').click();
  await expect(page.getByTestId('skill-FIRE')).toContainText('Tier I');

  await page.reload();
  await expect(page.getByRole('button', { name: 'Play level 2' })).toBeVisible();
  const saved = await page.evaluate(() => window.keystorm.getState().progress.skills.FIRE);
  expect(saved).toBe(1);
});

test('failing keeps the player on the same level', async ({ page }) => {
  await page.goto('/?e2e');
  await page.getByRole('button', { name: 'Play level 1' }).click();
  await firstWord(page);
  await page.evaluate(() => {
    const e = window.keystorm.getState().engine!;
    for (let i = 0; i < e.dangerRows - 1; i++) e.pile.push({ text: 'x', kind: 'normal' });
  });
  await expect(page.getByText(/Level 1 failed/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Retry level 1' })).toBeVisible();
});
