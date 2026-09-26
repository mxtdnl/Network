import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Screenshots go to test-results/screenshots (uploaded by CI), or to
// SCREENSHOT_DIR when set, e.g. SCREENSHOT_DIR=docs/screenshots/phase-1.
const screenshotDir = process.env.SCREENSHOT_DIR ?? join('test-results', 'screenshots');

const viewports = [
  { width: 1440, height: 900 },
  { width: 2560, height: 1440 },
] as const;

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

test('the shell loads under the base path, shows the first-run notice and passes axe', async ({
  page,
}) => {
  mkdirSync(screenshotDir, { recursive: true });

  const cspViolations: string[] = [];
  const failedRequests: string[] = [];
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  page.on('console', (msg) => {
    if (/content security policy|csp violation/i.test(msg.text())) cspViolations.push(msg.text());
  });
  page.on('requestfailed', (request) => failedRequests.push(request.url()));
  page.on('response', (response) => {
    if (response.status() >= 400)
      failedRequests.push(`${String(response.status())} ${response.url()}`);
  });

  const first = viewports[0];
  await page.setViewportSize(first);
  await page.goto('./');
  await expect(page).toHaveTitle('Graticule');

  // First run: the notice is open, modal and focused on its only control.
  const notice = page.getByRole('dialog', { name: 'Before you start' });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('Your data stays in this browser.');
  await expect(notice).toContainText('Ask for informed consent.');
  await expect(notice).toContainText('Do not use the results to evaluate individuals.');
  await expect(notice).toContainText('Seek data protection advice.');
  await expect(notice.getByRole('button', { name: 'Continue' })).toBeFocused();
  await page.evaluate(() => document.fonts.ready);
  await expectNoAxeViolations(page);

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.screenshot({
      path: join(screenshotDir, `shell-${String(viewport.width)}-notice.png`),
    });
  }

  // Dismiss; the workspace and its empty state are then available.
  await page.setViewportSize(first);
  await notice.getByRole('button', { name: 'Continue' }).click();
  await expect(notice).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Import data or load the demo' })).toBeVisible();
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Layers and filters' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Member and insights' })).toBeVisible();
  await expectNoAxeViolations(page);

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.screenshot({ path: join(screenshotDir, `shell-${String(viewport.width)}.png`) });
  }

  // Not a first run any more: the notice stays closed after a reload...
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Graticule', level: 1 })).toBeVisible();
  await expect(notice).toBeHidden();

  // ...and the Help menu reopens it.
  await page.getByRole('button', { name: 'Help' }).click();
  await expectNoAxeViolations(page);
  await page.getByRole('menuitem', { name: 'Data and consent notice' }).click();
  await expect(notice).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(notice).toBeHidden();
  await expect(page.getByRole('button', { name: 'Help' })).toBeFocused();

  expect(cspViolations).toEqual([]);
  expect(failedRequests).toEqual([]);
});
