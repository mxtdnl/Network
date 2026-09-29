import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { memberCodes } from '../../src/data/anonymise';
import { parseProject, serialiseProject } from '../../src/data/projectFile';
import type { Project } from '../../src/data/schema';
import { seededMembersCsv, seededTiesCsv } from '../fixtures/validation/seeded-errors';

// Phase 9: the in-app help, and the screenshots in docs/user-guide.md.
// Every screenshot is anonymised: the analyst's screens are taken with Hide
// names on, and the survey screens use a copy of the demo whose names are
// replaced by the same codes, because respondents always see names. The
// seeded validation files have their placeholder names replaced too.
//
//   GUIDE_DIR=docs/user-guide npx playwright test tests/e2e/guide.spec.ts
//
// Without GUIDE_DIR the screenshots go to test-results/guide.

const guideDir = process.env.GUIDE_DIR ?? join('test-results', 'guide');
const work = join('test-results', 'guide-files');
const PASSPHRASE = 'quiet harbour lantern moss';

const demo = parseProject(
  readFileSync(join(import.meta.dirname, '..', '..', 'src', 'demo', 'demo.ona.json'), 'utf8'),
);
const NAMES = demo.members.map((m) => m.display_name);

/** The demo with every name replaced by its code, for screens that always show names. */
function codedProject(): Project {
  const p: Project = structuredClone(demo);
  const { codes } = memberCodes(p.members);
  for (const [i, m] of p.members.entries()) m.display_name = codes[i] ?? m.display_name;
  p.meta.title = 'Meridian Works survey';
  p.ties = [];
  p.saved_views = [];
  return p;
}

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
  await page.waitForTimeout(700);
}

async function shot(page: Page, name: string, target?: ReturnType<Page['locator']>) {
  await page.evaluate(() => document.fonts.ready);
  const options = { path: join(guideDir, `${name}.jpg`), type: 'jpeg' as const, quality: 88 };
  if (target) await target.screenshot(options);
  else await page.screenshot(options);
}

async function expectNoAxeViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    results.violations.map(
      (v) => `${label}: ${v.id}: ${v.help} (${v.nodes[0]?.target.join(' ') ?? ''})`,
    ),
  ).toEqual([]);
}

/** No member's real name anywhere in the page's text or form values. */
async function expectNoNames(page: Page) {
  const text = await page.evaluate(
    () =>
      document.body.innerText +
      [...document.querySelectorAll('input, select, textarea')]
        .map((e) => (e as HTMLInputElement).value)
        .join(' '),
  );
  expect(NAMES.filter((n) => text.includes(n))).toEqual([]);
}

async function start(page: Page) {
  const problems: string[] = [];
  mkdirSync(guideDir, { recursive: true });
  mkdirSync(work, { recursive: true });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(String(e)));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  return problems;
}

async function openHelp(page: Page, item: string) {
  await page.getByRole('banner').getByRole('button', { name: 'Help' }).click();
  await page.getByRole('menuitem', { name: item }).click();
  const dialog = page.getByRole('dialog', { name: 'Help' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 20_000 });

test('screenshots of the analyst workspace, names hidden', async ({ page }) => {
  test.setTimeout(300_000);
  const problems = await start(page);
  await expect(page.getByRole('dialog', { name: 'Before you start' })).toBeVisible();
  await shot(page, 'first-run-notice');
  await page.getByRole('button', { name: 'Continue' }).click();
  await shot(page, 'empty-workspace');

  // Import and the validation report, with the seeded errors.
  await page.getByRole('button', { name: 'Import survey data' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Import survey data' });
  await shot(page, 'import-dialog', dialog);
  let k = 0;
  const members = seededMembersCsv.replace(/[A-Z][a-z]+ Example/g, () => {
    k += 1;
    return `Member ${String(k)}`;
  });
  await dialog.getByLabel('Members file').setInputFiles({
    name: 'members.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(members),
  });
  await dialog.getByLabel('Ties file').setInputFiles({
    name: 'ties.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(seededTiesCsv),
  });
  await dialog.getByRole('button', { name: 'Check files' }).click();
  await expect(dialog.getByRole('heading', { name: 'Validation report' })).toBeVisible();
  await shot(page, 'validation-report', dialog);
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  // The demo, names hidden from the start.
  await page.getByRole('button', { name: 'Load demo' }).first().click();
  await expect(nodes(page)).toHaveCount(40, { timeout: 60_000 });
  await page.getByRole('banner').getByRole('switch', { name: 'Hide names' }).click();
  await settled(page);
  await expectNoNames(page);
  await shot(page, 'map');
  await shot(page, 'weights', page.locator('.weights'));
  await shot(page, 'legend', page.getByRole('region', { name: 'Legend' }));

  await nodes(page).first().focus();
  await page.keyboard.press('Enter');
  await settled(page);
  await shot(page, 'member-panel', right(page));

  await page.getByRole('radio', { name: 'Grouped' }).check();
  await settled(page);
  await shot(page, 'layout-grouped');
  await page.getByRole('radio', { name: 'Force-directed' }).check();
  await settled(page);

  await rightTab(page, 'Explore').click();
  await right(page).getByLabel('From', { exact: true }).selectOption({ index: 3 });
  await right(page).getByLabel('To', { exact: true }).selectOption({ index: 30 });
  await right(page).getByRole('button', { name: 'Find path' }).click();
  await expect(page.getByText(/^Shortest path from/).first()).toBeVisible();
  await settled(page);
  await shot(page, 'shortest-path');
  await page.getByRole('main').getByRole('button', { name: 'Clear path' }).click();

  await rightTab(page, 'Insights').click();
  await shot(page, 'insights', right(page));
  await right(page)
    .getByRole('button', { name: /^Show on the map/ })
    .first()
    .click();
  await settled(page);
  await shot(page, 'insight-on-map');
  await page.getByRole('button', { name: 'Clear highlight' }).first().click();
  await settled(page);

  await rightTab(page, 'Coverage').click();
  await shot(page, 'coverage', right(page));

  // Saved views and a presentation.
  await rightTab(page, 'Views').click();
  await page.getByLabel('Preset').selectOption({ label: 'Informal network' });
  await settled(page);
  await page.getByLabel('Name of the new view').fill('Informal network');
  await page.getByRole('button', { name: 'Save view' }).click();
  await page.getByLabel('Preset').selectOption({ label: 'Formal structure' });
  await settled(page);
  await page.getByLabel('Name of the new view').fill('Formal structure');
  await page.getByRole('button', { name: 'Save view' }).click();
  // Captions are edited with names shown; the codes are shown meanwhile.
  await page.getByRole('banner').getByRole('switch', { name: 'Hide names' }).click();
  await right(page)
    .getByLabel('Caption')
    .first()
    .fill('Who works together outside formal roles and processes?');
  await right(page)
    .getByLabel('Caption')
    .nth(1)
    .fill('Collaboration that roles and processes require.');
  await right(page).getByLabel('Caption').nth(1).blur();
  await page.getByRole('banner').getByRole('switch', { name: 'Hide names' }).click();
  await settled(page);
  await shot(page, 'saved-views', right(page));

  await page.getByRole('banner').getByRole('button', { name: 'Present' }).click();
  await expect(page.locator('.presentation')).toBeVisible();
  await settled(page);
  await page.mouse.move(1435, 895);
  await page.waitForTimeout(2600);
  await expectNoNames(page);
  await shot(page, 'presentation');
  await page.keyboard.press('Escape');
  await settled(page);

  await centreTab(page, 'Matrix').click();
  await shot(page, 'adjacency-matrix');
  await page.getByRole('radio', { name: 'Enter ratings' }).check();
  await shot(page, 'matrix-entry');
  await page.getByRole('radio', { name: 'Tie strength' }).check();
  await centreTab(page, 'Table').click();
  await shot(page, 'metrics-table');
  await centreTab(page, 'Compare').click();
  await page.getByRole('radio', { name: 'Formal and informal' }).check();
  await page.waitForTimeout(500);
  await shot(page, 'compare-formal-informal');
  await centreTab(page, 'Map').click();
  await settled(page);

  await page.getByRole('banner').getByRole('button', { name: 'Export' }).click();
  await expect(page.getByRole('dialog', { name: 'Export' })).toBeVisible();
  await shot(page, 'export-dialog', page.getByRole('dialog', { name: 'Export' }));
  await page.keyboard.press('Escape');
  await expectNoNames(page);

  const help = await openHelp(page, 'Method notes');
  await expect(help.getByRole('heading', { name: 'Betweenness' })).toBeVisible();
  await shot(page, 'help');
  expect(problems).toEqual([]);
});

async function openProject(page: Page, project: Project) {
  const file = join(work, 'survey.ona.json');
  writeFileSync(file, serialiseProject(project));
  await page.getByRole('banner').getByRole('button', { name: 'Project' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Open project…' }).click();
  await (await chooser).setFiles(file);
  await expect(page.getByText(project.meta.title).first()).toBeVisible();
}

async function saveDownload(page: Page, action: () => Promise<void>): Promise<string> {
  const download = page.waitForEvent('download');
  await action();
  const d = await download;
  const path = join(work, d.suggestedFilename());
  await d.saveAs(path);
  return path;
}

async function phone(browser: Browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  return { context, page: await context.newPage() };
}

test('screenshots of a survey, from setup to import, with coded names', async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000);
  const problems = await start(page);
  await page.getByRole('button', { name: 'Continue' }).click();
  const project = codedProject();
  await openProject(page, project);
  await centreTab(page, 'Survey').click();
  await page.getByRole('button', { name: 'Set up a survey' }).click();
  await page
    .getByLabel('Introduction')
    .fill(
      'We are mapping how people across Meridian Works collaborate, to improve how teams share information. There are no right or wrong answers.',
    );
  await page
    .getByLabel('Confidentiality statement')
    .fill(
      'Two people in People Analytics will see your ratings. Results are reported for teams, never used to assess any individual, and never shown to the people you rate.',
    );
  await page
    .getByLabel('Return instructions')
    .fill('Email your response to ona-survey@example.org by 14 November.');
  await page.getByLabel('Deadline (optional)').fill('2026-11-14');
  await page.getByLabel('Short name shown to respondents').nth(1).fill('Relationship quality');
  await page.evaluate(() => {
    document.querySelector('.survey')?.scrollTo(0, 0);
  });
  await page.screenshot({
    path: join(guideDir, 'survey-setup.jpg'),
    type: 'jpeg',
    quality: 88,
    fullPage: true,
  });
  await page.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE);
  await page.getByLabel('Type the passphrase again').fill(PASSPHRASE);
  await page.getByRole('button', { name: 'Create the key' }).click();
  const backup = await saveDownload(page, () =>
    page.getByRole('button', { name: 'Download key backup' }).click(),
  );
  await page.getByLabel('Choose the backup file').setInputFiles(backup);
  await expect(page.getByText('Backup checked')).toBeVisible();
  await shot(page, 'survey-key', page.locator('.survey-keys'));
  await page.getByRole('button', { name: 'Create the survey' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Survey created' })).toBeVisible();
  await page.evaluate(() => {
    document.querySelector('.survey')?.scrollTo(0, 0);
  });
  await shot(page, 'survey-dashboard');

  const linksFile = await saveDownload(page, () =>
    page.getByRole('button', { name: 'Export links for mail merge' }).click(),
  );
  const rows = readFileSync(linksFile, 'utf8')
    .replace(/^\uFEFF/, '')
    .trim()
    .split('\r\n');
  const [name = '', , link = ''] = (rows[1] ?? '').split(',');

  // A respondent on a phone.
  const r = await phone(browser);
  await r.page.goto(link);
  await expect(r.page.getByRole('heading', { level: 1 })).toHaveText('Meridian Works survey');
  await r.page.screenshot({
    path: join(guideDir, 'respond-welcome.jpg'),
    type: 'jpeg',
    quality: 88,
  });
  await r.page.getByRole('button', { name: 'Continue' }).click();
  await r.page
    .getByLabel('I have read the information about this survey and I agree to take part.')
    .check();
  await r.page.getByRole('button', { name: 'Start the survey' }).click();
  await r.page.getByRole('button', { name: `Yes, I am ${name}` }).click();
  const colleagues = r.page.getByRole('checkbox');
  await colleagues.nth(1).check();
  await colleagues.nth(4).check();
  await r.page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await r.page.screenshot({
    path: join(guideDir, 'respond-select.jpg'),
    type: 'jpeg',
    quality: 88,
  });
  await r.page.getByRole('button', { name: 'Continue' }).click();
  for (let person = 0; person < 2; person++) {
    const groups = r.page.getByRole('group').filter({ has: r.page.getByRole('radio') });
    const count = await groups.count();
    for (let q = 0; q < count; q++) await groups.nth(q).getByRole('radio').nth(3).check();
    if (person === 0)
      await r.page.evaluate(() => {
        window.scrollTo(0, 0);
      });
    if (person === 0)
      await r.page.screenshot({
        path: join(guideDir, 'respond-rate.jpg'),
        type: 'jpeg',
        quality: 88,
      });
    await r.page
      .getByRole('button', { name: person === 1 ? 'Check your answers' : 'Next person' })
      .click();
  }
  await r.page.getByRole('button', { name: 'Encrypt my answers' }).click();
  await expect(r.page.getByRole('heading', { name: 'Send your answers back' })).toBeVisible();
  const response = await saveDownload(r.page, () =>
    r.page.getByRole('button', { name: 'Download response file' }).click(),
  );
  await r.page.screenshot({ path: join(guideDir, 'respond-done.jpg'), type: 'jpeg', quality: 88 });
  await r.context.close();

  // The analyst imports the response.
  await page.getByLabel('Choose response files').setInputFiles([response]);
  await page.getByRole('button', { name: 'Read responses' }).click();
  await expect(page.getByText('1 response to import')).toBeVisible();
  await page.evaluate(() => {
    document.querySelector('.survey')?.scrollTo(0, 0);
  });
  await shot(page, 'survey-import-plan');
  await page.getByRole('button', { name: 'Import 1 response' }).click();
  await expect(page.getByText('Now delete the response files')).toBeVisible();
  expect(problems).toEqual([]);
});

test('the Help menu opens the user guide, method notes and respondent help, linked to each other', async ({
  page,
}) => {
  const problems = await start(page);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('banner').getByRole('button', { name: 'Help' }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem')).toHaveText([
    'User guide',
    'Method notes',
    'Help for respondents',
    'Data and consent notice',
  ]);
  await page.keyboard.press('Escape');

  const dialog = await openHelp(page, 'User guide');
  await expect(dialog.getByRole('tab', { name: 'User guide' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(dialog.getByRole('navigation', { name: 'Contents' })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Reading each metric' })).toBeVisible();
  // Screenshots are bundled with the site and load under the CSP.
  const image = dialog.locator('img.help__image').first();
  await image.scrollIntoViewIfNeeded();
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBeGreaterThan(0);
  const src = await image.evaluate((img: HTMLImageElement) => img.src);
  expect(src.startsWith('http://localhost:4173/network/')).toBe(true);
  await expectNoAxeViolations(page, 'user guide');

  // A link from the guide to the method notes opens that section in the help.
  await dialog.getByRole('link', { name: 'method notes' }).first().click();
  await expect(dialog.getByRole('tab', { name: 'Method notes' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(dialog.getByRole('heading', { name: 'Method notes' })).toHaveCount(0);
  await expect(dialog.getByRole('heading', { name: 'Betweenness' })).toBeVisible();
  await expectNoAxeViolations(page, 'method notes');

  // And the method notes link back to the user guide.
  await dialog.getByRole('link', { name: 'user guide' }).first().click();
  await expect(dialog.getByRole('tab', { name: 'User guide' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await dialog.getByRole('tab', { name: 'Help for respondents' }).click();
  await expect(dialog.getByRole('heading', { name: 'Who will see your answers' })).toBeVisible();
  await expectNoAxeViolations(page, 'respondent help');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('banner').getByRole('button', { name: 'Help' })).toBeFocused();
  expect(problems).toEqual([]);
});
