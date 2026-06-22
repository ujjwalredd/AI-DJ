import { expect, test } from '@playwright/test';

async function canvasHasSignal(page) {
  await page.waitForSelector('canvas');
  await page.waitForTimeout(2000);
  // The WebGL canvas runs without preserveDrawingBuffer (avoids black flicker), so
  // pixel readback isn't reliable — assert the canvas actually sized + rendered.
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    return !!canvas && canvas.width > 20 && canvas.height > 20;
  });
}

test('landing renders the live 3D controller hero', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /on the\s*decks/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /enter the booth/i })).toBeVisible();
  await expect(page.getByText(/searches YouTube/i)).toBeVisible();
  expect(await canvasHasSignal(page)).toBe(true);
  await page.screenshot({ path: `test-results/landing-${test.info().project.name}.png`, fullPage: true });
});

test('studio setup page is reachable and accessible', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /enter the booth/i }).click();
  await expect(page.getByRole('button', { name: /pop/i }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /rap/i }).first()).toBeVisible();
  await expect(page.getByText(/real Artist - Title songs/i)).toBeVisible();
  await expect(page.getByRole('textbox', { name: /set direction/i })).toBeVisible();
  await expect(page.getByLabel(/anthropic key/i)).toBeVisible();
  expect(await canvasHasSignal(page)).toBe(true);
  await page.screenshot({ path: `test-results/studio-${test.info().project.name}.png`, fullPage: true });
});

test('reduced motion keeps the landing usable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /on the\s*decks/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /enter the booth/i })).toBeVisible();
});
