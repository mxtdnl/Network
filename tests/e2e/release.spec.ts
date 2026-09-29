import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Phase 9 release check (spec §14): a fresh load of the built site, the
// first-run notice, the demo, every view and every export, with no console
// error, no page error, no CSP violation and no request to another origin.
//
// By default it runs against `vite preview` of the production build, like the
// other specs. RELEASE_URL points it at a deployed site instead:
//
//   RELEASE_URL=https://mxtdnl.github.io/network/ npx playwright test tests/e2e/release.spec.ts

const releaseUrl = process.env.RELEASE_URL;
if (releaseUrl) test.use({ baseURL: releaseUrl.endsWith('/') ? releaseUrl : `${releaseUrl}/` });

const nodes = (page: Page) =>
  page.getByRole('group', { name: 'Members on the map' }).getByRole('button');
const right = (page: Page) =>
  page.getByRole('complementary', { name: 'Member, insights and coverage' });
const centreTab = (page: Page, name: string) =>
  page.getByRole('main').getByRole('tab', { name, exact: true });
const rightTab = (page: Page, name: string) => right(page).getByRole('tab', { name });

async function settled(page: Page) {
  await page.waitForFunction(
    () =>
      document.querySelector('canvas.map__canvas')?.getAttribute('data-transition') !== 'running',
    undefined,
    { timeout: 60_000 },
  );
  await page.waitForTimeout(500);
}

/** Records console errors, page errors, CSP violations and requests to other origins. */
async function watch(page: Page, origin: string) {
  const problems: string[] = [];
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`page error: ${String(e)}`));
  page.on('request', (r) => {
    const url = r.url();
    if (/^(blob|data):/.test(url)) return;
    if (new URL(url).origin !== origin) problems.push(`request to another origin: ${url}`);
  });
  return problems;
}

test.use({ actionTimeout: 20_000 });

test('release check: fresh load, notice, demo, every view and every export, with no errors', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(300_000);
  const base = new URL(baseURL ?? '');
  const problems = await watch(page, base.origin);
  await page.setViewportSize({ width: 1440, height: 900 });

  // Fresh load: a new browser context has no stored notice flag or project.
  const response = await page.goto('./');
  expect(response?.status()).toBe(200);
  expect(new URL(page.url()).pathname).toBe(base.pathname);
  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(csp).toContain("connect-src 'self'");
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);

  // First-run notice.
  const notice = page.getByRole('dialog', { name: 'Before you start' });
  await expect(notice).toBeVisible();
  for (const text of [
    'Your data stays in this browser.',
    'Ask for informed consent.',
    'Do not use the results to evaluate individuals.',
    'Seek data protection advice.',
  ])
    await expect(notice.getByText(text)).toBeVisible();
  await notice.getByRole('button', { name: 'Continue' }).click();

  // Demo.
  await page.getByRole('button', { name: 'Load demo' }).first().click();
  await expect(nodes(page)).toHaveCount(40, { timeout: 60_000 });
  await settled(page);

  // Every view: centre tabs, matrix modes, comparisons, layouts.
  await centreTab(page, 'Matrix').click();
  await expect(page.getByRole('grid').first()).toBeVisible();
  await page.getByRole('radio', { name: 'Enter ratings' }).check();
  await expect(page.getByRole('grid').first()).toBeVisible();
  await page.getByRole('radio', { name: 'Tie strength' }).check();
  await centreTab(page, 'Table').click();
  await expect(page.getByRole('button', { name: 'Export table' })).toBeVisible();
  await centreTab(page, 'Compare').click();
  await expect(page.getByRole('radio', { name: 'Two layers' })).toBeVisible();
  await page.getByRole('radio', { name: 'Formal and informal' }).check();
  await centreTab(page, 'Survey').click();
  await expect(page.getByRole('heading', { name: 'Run a survey' })).toBeVisible();
  await centreTab(page, 'Map').click();
  await settled(page);
  for (const layout of ['Grouped', 'Circular', 'Formal hierarchy', 'Force-directed']) {
    await page.getByRole('radio', { name: layout }).check();
    await settled(page);
  }

  // Right column: member, explore, insights, views, coverage.
  await nodes(page).first().focus();
  await page.keyboard.press('Enter');
  await expect(right(page).getByText('Position in the network')).toBeVisible();
  await rightTab(page, 'Explore').click();
  await expect(right(page).getByRole('heading', { name: 'Shortest path' })).toBeVisible();
  await rightTab(page, 'Insights').click();
  await expect(right(page).getByText('Potential brokers').first()).toBeVisible();
  await right(page)
    .getByRole('button', { name: /^Show on the map/ })
    .first()
    .click();
  await settled(page);
  await page.getByRole('button', { name: 'Clear highlight' }).first().click();
  await rightTab(page, 'Coverage').click();
  await expect(right(page).getByText('Overall response rate')).toBeVisible();
  await rightTab(page, 'Views').click();
  await page.getByLabel('Name of the new view').fill('Release check');
  await page.getByRole('button', { name: 'Save view' }).click();

  // Presentation, and names hidden.
  await page.getByRole('banner').getByRole('button', { name: 'Present' }).click();
  await expect(page.locator('.presentation')).toBeVisible();
  await settled(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('.presentation')).toHaveCount(0);
  await page.getByRole('banner').getByRole('switch', { name: 'Hide names' }).click();
  await settled(page);

  // Help: user guide, method notes, respondent help, the notice.
  await page.getByRole('banner').getByRole('button', { name: 'Help' }).click();
  await page.getByRole('menuitem', { name: 'User guide' }).click();
  const help = page.getByRole('dialog', { name: 'Help' });
  await expect(help.getByRole('heading', { name: 'Reading each metric' })).toBeVisible();
  await help.getByRole('tab', { name: 'Method notes' }).click();
  await expect(help.getByRole('heading', { name: 'Betweenness' })).toBeVisible();
  await help.getByRole('tab', { name: 'Help for respondents' }).click();
  await expect(help.getByRole('heading', { name: 'Who will see your answers' })).toBeVisible();
  await help.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('banner').getByRole('button', { name: 'Help' }).click();
  await page.getByRole('menuitem', { name: 'Data and consent notice' }).click();
  await notice.getByRole('button', { name: 'Continue' }).click();

  // Every export, from the Export dialog.
  const dialog = page.getByRole('dialog', { name: 'Export' });
  const download = async (button: string) => {
    const pending = page.waitForEvent('download');
    await dialog.getByRole('button', { name: button, exact: true }).click();
    const file = await pending;
    expect(file.url().startsWith(`blob:${base.origin}/`)).toBe(true);
    const bytes = readFileSync(await file.path());
    expect(bytes.length).toBeGreaterThan(0);
    return { name: file.suggestedFilename(), bytes };
  };
  await page.getByRole('banner').getByRole('button', { name: 'Export' }).click();
  await expect(dialog).toBeVisible();
  for (const resolution of ['Screen (1×)', 'High (2×)', 'Print (300 dpi)']) {
    await dialog.getByLabel(resolution).check();
    const png = await download('Export map');
    expect(png.name).toBe('graticule-map-directed-codes.png');
    expect(png.bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
  }
  await dialog.getByLabel('SVG drawing').check();
  const svg = await download('Export map');
  expect(svg.name).toBe('graticule-map-directed-codes.svg');
  expect(svg.bytes.toString('utf8').startsWith('<?xml')).toBe(true);
  for (const button of [
    'Export member metrics',
    'Export network metrics',
    'Export formal and informal ties',
  ]) {
    const csv = await download(button);
    expect(csv.name).toMatch(/\.csv$/);
    expect([...csv.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  }
  const pdf = await download('Export report');
  expect(pdf.name).toMatch(/^graticule-report-\d{4}-\d{2}-\d{2}-codes\.pdf$/);
  expect(pdf.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  // Leaving out the signed layers recalculates the exports.
  await dialog.getByRole('switch', { name: 'Leave out valence, energy and conflict' }).click();
  const excluded = await download('Export member metrics');
  expect(excluded.name).toBe('graticule-member-metrics-directed-codes-no-signed.csv');
  await dialog.getByRole('button', { name: 'Close' }).click();

  // The table's own export, and saving the project.
  await centreTab(page, 'Table').click();
  const table = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export table' }).click();
  expect((await table).suggestedFilename()).toMatch(/^graticule-metrics-.*\.csv$/);
  const save = page.waitForEvent('download');
  await page.getByRole('banner').getByRole('button', { name: 'Project' }).click();
  await page.getByRole('menuitem', { name: 'Save project' }).click();
  expect((await save).suggestedFilename()).toMatch(/\.ona\.json$/);

  // The respondent route loads on its own and explains a damaged link.
  await page.goto('./#/respond/not-a-survey');
  await expect(page.getByRole('heading', { name: 'This link cannot be opened' })).toBeVisible();

  expect(problems).toEqual([]);
});
