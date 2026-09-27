import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeCoverage } from '../../src/data/coverage';
import { parseProject, serialiseProject } from '../../src/data/projectFile';
import type { Project } from '../../src/data/schema';

// Respondent mode (spec §15): the whole cycle from setup to import, the
// survey package, resume and clearing, keyboard-only completion and axe scans.
// Screenshots go to test-results/screenshots, or to SCREENSHOT_DIR when set
// (SCREENSHOT_DIR=docs/screenshots/respondent-mode).
const screenshotDir = process.env.SCREENSHOT_DIR ?? join('test-results', 'screenshots');
const work = join('test-results', 'survey-files');
const PASSPHRASE = 'quiet harbour lantern moss';

const demo = parseProject(
  readFileSync(join(import.meta.dirname, '..', '..', 'src', 'demo', 'demo.ona.json'), 'utf8'),
);

/** The demo's 40 members with no ratings, and email addresses for two of them. */
function rosterProject(): Project {
  const p: Project = structuredClone(demo);
  p.meta.title = 'Northfield teams';
  p.ties = [];
  p.saved_views = [];
  p.attribute_definitions.push({ key: 'email', label: 'Email', type: 'email', builtin: false });
  for (const [i, m] of p.members.entries())
    m.attributes.email = i < 2 ? `person${String(i)}@example.org` : null;
  return p;
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

async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  // The Survey tab scrolls inside its panel; show it from the top.
  await page.evaluate(() => {
    document.querySelector('.survey')?.scrollTo(0, 0);
  });
  await page.screenshot({ path: join(screenshotDir, `${name}.png`), fullPage: true });
}

async function openAnalyst(page: Page, project: Project) {
  mkdirSync(screenshotDir, { recursive: true });
  mkdirSync(work, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('./');
  await page.getByRole('button', { name: 'Continue' }).click();
  const file = join(work, `${project.meta.title.replace(/\W+/g, '-')}.ona.json`);
  writeFileSync(file, serialiseProject(project));
  await page.getByRole('button', { name: 'Project' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Open project…' }).click();
  await (await chooser).setFiles(file);
  await expect(page.getByText(project.meta.title).first()).toBeVisible();
  await page.getByRole('tab', { name: 'Survey' }).click();
}

async function saveDownload(
  page: Page,
  action: () => Promise<void>,
  name?: string,
): Promise<string> {
  const download = page.waitForEvent('download');
  await action();
  const d = await download;
  const path = join(work, name ?? d.suggestedFilename());
  await d.saveAs(path);
  return path;
}

async function setUpSurvey(
  page: Page,
  opts: { alwaysPackage?: boolean; screenshots?: boolean; required?: string[] } = {},
) {
  await page.getByRole('button', { name: 'Set up a survey' }).click();
  // Colleagues everyone is asked about (D103).
  for (const name of opts.required ?? []) {
    await page.getByPlaceholder('Search by name').fill(name.split(' ')[0] ?? name);
    await page.getByRole('checkbox', { name }).check();
  }
  if (opts.required?.length) {
    await page.getByPlaceholder('Search by name').fill('');
    await expect(page.getByText(`${String(opts.required.length)} ticked`)).toBeVisible();
    if (opts.screenshots) {
      await page
        .locator('.survey-required')
        .screenshot({ path: join(screenshotDir, 'dashboard-01b-required-colleagues.png') });
    }
  }
  await page
    .getByLabel('Introduction')
    .fill(
      'We are mapping how people across Northfield work together, to improve how teams share information. There are no right or wrong answers.',
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
  // Respondents see short names in their summary: everyday words, not "Valence".
  await page.getByLabel('Short name shown to respondents').nth(1).fill('Relationship quality');
  if (opts.alwaysPackage)
    await page.getByLabel('Always use a survey file with short links').check();
  if (opts.screenshots) {
    await shot(page, 'dashboard-01-setup');
    await expectNoAxeViolations(page, 'setup');
  }
  await page.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE);
  await page.getByLabel('Type the passphrase again').fill(PASSPHRASE);
  await page.getByRole('button', { name: 'Create the key' }).click();
  const backup = await saveDownload(page, () =>
    page.getByRole('button', { name: 'Download key backup' }).click(),
  );
  if (opts.screenshots) await shot(page, 'dashboard-02-key-backup');
  await expect(page.getByRole('button', { name: 'Create the survey' })).toBeDisabled();
  await page.getByLabel('Choose the backup file').setInputFiles(backup);
  await expect(page.getByText('Backup checked')).toBeVisible();
  await page.getByRole('button', { name: 'Create the survey' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Survey created' })).toBeVisible();
}

/** Name → link, from the mail-merge export. */
async function exportLinks(page: Page): Promise<Map<string, string>> {
  const path = await saveDownload(page, () =>
    page.getByRole('button', { name: 'Export links for mail merge' }).click(),
  );
  const rows = readFileSync(path, 'utf8')
    .replace(/^\uFEFF/, '')
    .trim()
    .split('\r\n');
  expect(rows[0]).toBe('name,email,link');
  return new Map(
    rows.slice(1).map((r) => {
      const [name = '', , link = ''] = r.split(',');
      return [name, link];
    }),
  );
}

async function respondent(
  browser: Browser,
  mobile: boolean,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext(
    mobile
      ? {
          viewport: { width: 390, height: 844 },
          isMobile: true,
          hasTouch: true,
          deviceScaleFactor: 2,
          permissions: ['clipboard-read', 'clipboard-write'],
        }
      : {
          viewport: { width: 1280, height: 900 },
          permissions: ['clipboard-read', 'clipboard-write'],
        },
  );
  return { context, page: await context.newPage() };
}

async function throughIdentity(page: Page, name: string, screenshots?: string) {
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Northfield teams');
  if (screenshots) {
    await shot(page, `${screenshots}-01-welcome`);
    await expectNoAxeViolations(page, 'welcome');
  }
  await expect(page.locator('body')).not.toContainText(/anonymous/i);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Start the survey' }).click();
  await expect(page.getByRole('alert')).toContainText('Tick the box');
  if (screenshots) await shot(page, `${screenshots}-02-consent-error`);
  await page
    .getByLabel('I have read the information about this survey and I agree to take part.')
    .check();
  if (screenshots) {
    await shot(page, `${screenshots}-03-consent`);
    await expectNoAxeViolations(page, 'consent');
  }
  await page.getByRole('button', { name: 'Start the survey' }).click();
  await expect(page.getByText(`This link was made for ${name}.`)).toBeVisible();
  if (screenshots) {
    await shot(page, `${screenshots}-04-identity`);
    await expectNoAxeViolations(page, 'identity');
    await page.getByRole('button', { name: 'No, I am someone else' }).click();
    await shot(page, `${screenshots}-05-not-me`);
    await expectNoAxeViolations(page, 'not me');
    await page.getByRole('button', { name: /go back/ }).click();
  }
  await page.getByRole('button', { name: `Yes, I am ${name}` }).click();
}

async function nominate(page: Page, names: string[], screenshots?: string) {
  await expect(page.getByRole('heading', { name: 'Who you work with' })).toBeVisible();
  for (const n of names) {
    await page.getByLabel('Search by name').fill(n.split(' ')[0] ?? n);
    await page.getByRole('checkbox', { name: new RegExp(`^${n}`) }).check();
  }
  await page.getByLabel('Search by name').fill('');
  if (screenshots) {
    await shot(page, `${screenshots}-06-nominate`);
    await expectNoAxeViolations(page, 'nominate');
  }
  await page.getByRole('button', { name: 'Continue' }).click();
}

const LAYERS = [
  'How strong is your working connection with this person?',
  'Overall, how positive or negative is your working relationship with this person?',
  'How often do you collaborate with this person outside formal roles, processes or reporting lines?',
  'How often does your role, a process or a reporting line require you to collaborate with this person?',
];

test.describe.configure({ mode: 'serial' });

/** Desktop table: one question at a time, a row per colleague. */
async function rateTable(page: Page, values: Record<string, string[]>, screenshots?: string) {
  for (const [q, question] of LAYERS.entries()) {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(question);
    if (q === 0) {
      // Every question needs an answer: "Next" says what is missing and stays.
      await page.getByRole('button', { name: 'Next question' }).click();
      await expect(page.getByRole('alert')).toContainText('have no answer yet');
      if (screenshots) await shot(page, `${screenshots}-07-rate-missing`);
    }
    for (const [name, marks] of Object.entries(values)) {
      await page
        .getByRole('radio', { name: new RegExp(`^${name}: ${marks[q] ?? ''}(,|$)`) })
        .check();
    }
    if (screenshots && q === 0) {
      await shot(page, `${screenshots}-07-rate-table`);
      await expectNoAxeViolations(page, 'rate table');
    }
    await page
      .getByRole('button', {
        name: q === LAYERS.length - 1 ? 'Check your answers' : 'Next question',
      })
      .click();
  }
}

/** Phone: one colleague at a time, every question on the screen. */
async function ratePeople(
  page: Page,
  values: Record<string, string[]>,
  opts: { screenshots?: string; reloadAfterFirst?: boolean } = {},
) {
  let first = true;
  const people = Object.entries(values);
  for (const [i, [name, marks]] of people.entries()) {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
    if (first) {
      // Every question needs an answer: "Next" says what is missing and stays.
      await page
        .getByRole('group', { name: LAYERS[0] ?? '' })
        .getByRole('radio')
        .first()
        .check();
      await page.getByRole('button', { name: 'Next person' }).click();
      await expect(page.getByRole('alert')).toContainText('not answered yet');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
      if (opts.screenshots) await shot(page, `${opts.screenshots}-07-rate-missing`);
    }
    for (const [q, question] of LAYERS.entries()) {
      await page
        .getByRole('group', { name: question })
        .getByRole('radio', { name: new RegExp(`^${marks[q] ?? ''}(,|$)`) })
        .check();
    }
    if (opts.screenshots && first) {
      await shot(page, `${opts.screenshots}-07-rate-person`);
      await expectNoAxeViolations(page, 'rate person');
    }
    if (opts.reloadAfterFirst && first) {
      // Resume after reload: the answers and the position survive.
      await page.reload();
      await expect(page.getByRole('status').filter({ hasText: 'Welcome back' })).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
      await expect(
        page
          .getByRole('group', { name: LAYERS[0] ?? '' })
          .getByRole('radio', { name: new RegExp(`^${marks[0] ?? ''}(,|$)`) }),
      ).toBeChecked();
      if (opts.screenshots) await shot(page, `${opts.screenshots}-08-resumed`);
    }
    first = false;
    await page
      .getByRole('button', { name: i === people.length - 1 ? 'Check your answers' : 'Next person' })
      .click();
  }
}

const storedAnswers = (page: Page) =>
  page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('graticule.respond.')));

test('full cycle: set up, three respondents (one on a phone), return by file and text, import, ties and coverage', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  await openAnalyst(page, rosterProject());
  await expect(page.getByRole('heading', { name: 'Run a survey' })).toBeVisible();
  await shot(page, 'dashboard-00-intro');
  await expectNoAxeViolations(page, 'survey intro');
  await setUpSurvey(page, { screenshots: true, required: ['Hana Isobar'] });
  await shot(page, 'dashboard-03-created');
  await expectNoAxeViolations(page, 'dashboard');
  const links = await exportLinks(page);
  expect(links.size).toBe(40);
  const ada = links.get('Ada Meridian') ?? '';
  expect(ada.length).toBeLessThanOrEqual(2000);
  expect(ada).toContain('#/respond/');

  // Respondent 1: desktop, compact table, returns a file.
  const r1 = await respondent(browser, false);
  await r1.page.goto(ada);
  await throughIdentity(r1.page, 'Ada Meridian', 'respond-desktop');
  await nominate(r1.page, ['Bram Contour', 'Chiara Azimuth'], 'respond-desktop');
  await rateTable(
    r1.page,
    {
      'Hana Isobar': ['3', '0', '2', '3'],
      'Bram Contour': ['4', '\\+2', '3', '5'],
      'Chiara Azimuth': ['2', 'Does not apply', '1', '0'],
    },
    'respond-desktop',
  );
  await expect(r1.page.getByRole('heading', { name: 'Check your answers' })).toBeVisible();
  await expect(r1.page.getByText('Every question is answered.')).toBeVisible();
  await shot(r1.page, 'respond-desktop-09-review');
  await expectNoAxeViolations(r1.page, 'review');
  await r1.page.getByRole('button', { name: 'Encrypt my answers' }).click();
  await expect(r1.page.getByRole('heading', { name: 'Send your answers back' })).toBeVisible();
  expect(await storedAnswers(r1.page)).toHaveLength(1);
  const file1 = await saveDownload(r1.page, () =>
    r1.page.getByRole('button', { name: 'Download response file' }).click(),
  );
  expect(file1).toMatch(/graticule-response-[0-9A-Z]{8}\.txt$/);
  await expect(r1.page.getByText('Your answers have been cleared from this device.')).toBeVisible();
  expect(await storedAnswers(r1.page)).toHaveLength(0);
  const receipt1 = (await r1.page.locator('.respond__receipt').textContent()) ?? '';
  await shot(r1.page, 'respond-desktop-10-done');
  await expectNoAxeViolations(r1.page, 'done');
  await r1.context.close();

  // Respondent 2: phone, one colleague at a time, reloads midway, returns text.
  const r2 = await respondent(browser, true);
  await r2.page.goto(links.get('Bram Contour') ?? '');
  await throughIdentity(r2.page, 'Bram Contour', 'respond-mobile');
  await nominate(r2.page, ['Ada Meridian', 'Dev Bearing', 'Elif Datum'], 'respond-mobile');
  await ratePeople(
    r2.page,
    {
      'Hana Isobar': ['2', 'Does not apply', '1', '1'],
      'Ada Meridian': ['5', '\\+3', '4', '4'],
      'Dev Bearing': ['1', '0', '0', '2'],
      'Elif Datum': ['3', '−2', '2', '3'],
    },
    { screenshots: 'respond-mobile', reloadAfterFirst: true },
  );
  await shot(r2.page, 'respond-mobile-09-review');
  await expectNoAxeViolations(r2.page, 'review mobile');
  await r2.page.getByRole('button', { name: 'Encrypt my answers' }).click();
  await r2.page.getByRole('button', { name: 'Copy encrypted text' }).click();
  await expect(
    r2.page.getByRole('status').filter({ hasText: 'Encrypted text copied' }),
  ).toBeVisible();
  const text2 = await r2.page.evaluate(() => navigator.clipboard.readText());
  expect(text2).toContain('-----BEGIN GRATICULE RESPONSE-----');
  expect(await storedAnswers(r2.page)).toHaveLength(0);
  await shot(r2.page, 'respond-mobile-10-done');
  await expectNoAxeViolations(r2.page, 'done mobile');
  await r2.context.close();

  // Respondent 3: keyboard only, desktop.
  const r3 = await respondent(browser, false);
  await r3.page.goto(links.get('Chiara Azimuth') ?? '');
  const file3 = await keyboardOnly(r3.page, 'Chiara Azimuth');
  await r3.context.close();

  // Import: lock and unlock with the passphrase, add two files and pasted text.
  await page.getByRole('button', { name: 'Lock' }).click();
  await page.getByLabel('Passphrase').fill('not the passphrase');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('alert')).toContainText('does not open');
  await page.getByLabel('Passphrase').fill(PASSPHRASE);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByLabel('Choose response files').setInputFiles([file1, file3]);
  await page
    .getByLabel('Or paste response text from emails')
    .fill(`Hi,\n\nMy answers:\n\n${text2}\nBram`);
  await shot(page, 'dashboard-04-import-ready');
  await page.getByRole('button', { name: 'Read responses' }).click();
  await expect(page.getByText('3 responses to import')).toBeVisible();
  await shot(page, 'dashboard-05-import-plan');
  await expectNoAxeViolations(page, 'import plan');
  await page.getByRole('button', { name: 'Import 3 responses' }).click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: /3 responses imported/ })
      .first(),
  ).toBeVisible();
  await expect(page.getByText('Now delete the response files')).toBeVisible();
  await shot(page, 'dashboard-06-imported');
  await expectNoAxeViolations(page, 'imported');
  await expect(page.getByText(receipt1)).toHaveCount(0); // receipts show only where needed

  // The same files again change nothing.
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByLabel('Choose response files').setInputFiles([file1]);
  await page.getByRole('button', { name: 'Read responses' }).click();
  await expect(page.getByText('1 file was already imported')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  // Ties: save the project and read it back.
  const saved = parseProject(
    readFileSync(
      await saveDownload(page, async () => {
        await page.getByRole('button', { name: 'Project' }).click();
        await page.getByRole('menuitem', { name: 'Save project' }).click();
      }),
      'utf8',
    ),
  );
  const tie = (rater: string, ratee: string, layer: string) =>
    saved.ties.find((t) => t.rater_id === rater && t.ratee_id === ratee && t.variable === layer);
  expect(tie('FIN01', 'FIN02', 'connection_strength')).toMatchObject({
    value: 4,
    source: 'self_report',
    wave: 1,
  });
  expect(tie('FIN01', 'FIN02', 'valence')?.value).toBe(2);
  // "Does not apply" is its own state: not 0 (neutral), not missing.
  expect(tie('FIN01', 'FIN03', 'valence')).toMatchObject({ value: null, not_applicable: true });
  // The required colleague was rated by everyone who responded.
  expect(tie('FIN01', 'FIN08', 'connection_strength')?.value).toBe(3);
  expect(tie('FIN01', 'FIN08', 'valence')?.value).toBe(0);
  expect(tie('FIN02', 'FIN08', 'valence')).toMatchObject({ value: null, not_applicable: true });
  expect(tie('FIN03', 'FIN08', 'connection_strength')?.value).toBe(3);
  expect(tie('FIN01', 'FIN03', 'formal_collaboration')?.value).toBe(0);
  expect(tie('FIN02', 'FIN01', 'connection_strength')?.value).toBe(5);
  expect(tie('FIN02', 'FIN05', 'valence')?.value).toBe(-2);
  // Not selected: 0 on unsigned layers, "does not apply" on valence (D88, D102).
  expect(tie('FIN01', 'OPE03', 'connection_strength')?.value).toBe(0);
  expect(tie('FIN01', 'OPE03', 'valence')).toMatchObject({ value: null, not_applicable: true });
  expect(saved.surveys[0]?.log.filter((e) => e.kind === 'accepted')).toHaveLength(3);
  // Coverage updates from the survey: three raters now have ratings.
  const coverage = computeCoverage(saved);
  expect(
    coverage.raters
      .filter((r) => r.rated > 0)
      .map((r) => r.id)
      .sort(),
  ).toStrictEqual(['FIN01', 'FIN02', 'FIN03']);
  await expect(page.locator('.top-bar__coverage')).toContainText(
    String(Math.round(coverage.rate * 100)),
  );
  await expect(page.getByText('Received')).toHaveCount(3);

  // Non-responders export lists the other 37.
  const nonPath = await saveDownload(page, () =>
    page.getByRole('button', { name: 'Export non-responders' }).click(),
  );
  expect(readFileSync(nonPath, 'utf8').trim().split('\r\n')).toHaveLength(38);

  // Close the survey: import stops.
  await page.getByRole('button', { name: 'Close survey' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Close survey' }).click();
  await expect(page.getByText('This survey is closed')).toBeVisible();
  await shot(page, 'dashboard-07-closed');
  await expectNoAxeViolations(page, 'closed');
});

async function keyboardOnly(page: Page, name: string): Promise<string> {
  const press = (key: string, times = 1) =>
    page.keyboard.press(key).then(async () => {
      for (let i = 1; i < times; i++) await page.keyboard.press(key);
    });
  /** Tabs until the focused element's accessible name matches. */
  async function tabTo(label: RegExp, max = 60) {
    for (let i = 0; i < max; i++) {
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return '';
        const labelled = el.getAttribute('aria-label');
        if (labelled) return labelled;
        const label = el instanceof HTMLInputElement ? el.labels?.[0] : undefined;
        if (label) return label.textContent;
        return el.textContent;
      });
      if (label.test(focused.trim())) return;
    }
    throw new Error(`Could not reach ${String(label)} by Tab`);
  }
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Northfield teams');
  await tabTo(/^Continue$/);
  await press('Enter');
  await tabTo(/agree to take part/);
  await press('Space');
  await tabTo(/^Start the survey$/);
  await press('Enter');
  await tabTo(new RegExp(`^Yes, I am ${name}$`));
  await press('Enter');
  await tabTo(/^Search by name$/);
  await page.keyboard.type('Ada');
  await tabTo(/^Ada Meridian/);
  await press('Space');
  await tabTo(/^Continue$/);
  await press('Enter');
  // Each question: Tab into the row's radio group, arrow to the value.
  for (const [q] of LAYERS.entries()) {
    // The required colleague comes first, then the one selected.
    await tabTo(/^Hana Isobar: /);
    await press('ArrowRight', 3);
    await tabTo(/^Ada Meridian: /);
    // The first radio of a group takes focus unchecked; ArrowRight moves and checks.
    await press('ArrowRight', 3);
    await tabTo(q === LAYERS.length - 1 ? /^Check your answers$/ : /^Next question$/);
    await press('Enter');
  }
  await expect(page.getByRole('heading', { name: 'Check your answers' })).toBeVisible();
  await tabTo(/^Encrypt my answers$/);
  await press('Enter');
  await expect(page.getByRole('heading', { name: 'Send your answers back' })).toBeVisible();
  await tabTo(/^Download response file$/);
  return saveDownload(page, () => press('Enter'));
}

test('survey file with short links on a phone, a mismatched file, clearing answers, and links that cannot open', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const project = rosterProject();
  project.meta.title = 'Northfield teams';
  await openAnalyst(page, project);
  await setUpSurvey(page, { alwaysPackage: true });
  await expect(page.getByText(/Send everyone the same survey file/)).toBeVisible();
  await shot(page, 'dashboard-08-package');
  const pkg = await saveDownload(page, () =>
    page.getByRole('button', { name: /Download survey file for version 1/ }).click(),
  );
  expect(pkg).toMatch(/\.graticule-survey$/);
  const links = await exportLinks(page);
  const link = links.get('Dev Bearing') ?? '';
  expect(link).toMatch(/#\/respond\/p\/[A-Za-z0-9_-]+\.3\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  expect(link.length).toBeLessThan(120);

  const r = await respondent(browser, true);
  await r.page.goto(link);
  await expect(r.page.getByRole('heading', { name: 'Choose your survey file' })).toBeVisible();
  await shot(r.page, 'respond-mobile-11-choose-file');
  await expectNoAxeViolations(r.page, 'choose file');
  // A file that is not the survey file is refused with a reason.
  const other = join(work, 'not-a-survey.graticule-survey');
  writeFileSync(other, '{"format":"graticule-survey","v":1,"survey":"abc"}');
  await r.page.getByLabel('Choose the survey file').setInputFiles(other);
  await expect(r.page.getByRole('alert')).toContainText('does not belong with your link');
  await shot(r.page, 'respond-mobile-12-wrong-file');
  await r.page.getByLabel('Choose the survey file').setInputFiles(pkg);
  await throughIdentity(r.page, 'Dev Bearing');
  // Reloading a package link resumes without choosing the file again.
  await r.page.reload();
  await expect(r.page.getByRole('heading', { name: 'Who you work with' })).toBeVisible();
  await nominate(r.page, ['Ada Meridian']);
  await r.page
    .getByRole('group', { name: LAYERS[0] ?? '' })
    .getByRole('radio', { name: /^3(,|$)/ })
    .check();
  expect(await storedAnswers(r.page)).toHaveLength(1);
  // Clear my answers from this device.
  await r.page.getByRole('button', { name: 'Clear my answers from this device' }).click();
  await expect(r.page.getByRole('dialog', { name: 'Clear your answers?' })).toBeVisible();
  await shot(r.page, 'respond-mobile-13-clear');
  await expectNoAxeViolations(r.page, 'clear dialog');
  await r.page.getByRole('button', { name: 'Clear my answers', exact: true }).click();
  await expect(
    r.page.getByRole('status').filter({ hasText: 'cleared from this device' }),
  ).toBeVisible();
  await expect(r.page.getByRole('heading', { level: 1 })).toHaveText('Northfield teams');
  expect(await storedAnswers(r.page)).toHaveLength(0);
  await r.context.close();

  // The same screens on a desktop.
  const w = await respondent(browser, false);
  await w.page.goto(link);
  await expect(w.page.getByRole('heading', { name: 'Choose your survey file' })).toBeVisible();
  await shot(w.page, 'respond-desktop-11-choose-file');
  await w.page.getByLabel('Choose the survey file').setInputFiles(other);
  await shot(w.page, 'respond-desktop-12-wrong-file');
  await w.page.getByLabel('Choose the survey file').setInputFiles(pkg);
  await w.page.getByRole('button', { name: 'Clear my answers from this device' }).click();
  await shot(w.page, 'respond-desktop-13-clear');
  await expectNoAxeViolations(w.page, 'clear dialog desktop');
  await w.context.close();

  // A damaged link, on a phone and on a desktop.
  for (const mobile of [true, false]) {
    const d = await respondent(browser, mobile);
    await d.page.goto(
      `${(links.get('Ada Meridian') ?? '').split('#')[0] ?? ''}#/respond/eJzLSM3JyQcABiwCFQ`,
    );
    await expect(d.page.getByRole('heading', { name: 'This link cannot be opened' })).toBeVisible();
    await shot(d.page, `respond-${mobile ? 'mobile' : 'desktop'}-14-invalid-link`);
    await expectNoAxeViolations(d.page, 'invalid link');
    await d.context.close();
  }

  // A browser without CompressionStream is told so before anything starts.
  const u = await respondent(browser, true);
  await u.page.addInitScript(() => {
    Reflect.deleteProperty(window, 'CompressionStream');
  });
  await u.page.goto(link);
  await expect(
    u.page.getByRole('heading', { name: 'This browser cannot open the survey' }),
  ).toBeVisible();
  await shot(u.page, 'respond-mobile-15-unsupported');
  await u.page.setViewportSize({ width: 1280, height: 900 });
  await shot(u.page, 'respond-desktop-15-unsupported');
  await expectNoAxeViolations(u.page, 'unsupported');
  await u.context.close();

  // Editing what respondents are asked creates version 2.
  await page.getByRole('button', { name: 'Edit survey' }).click();
  await page.getByLabel('Ask about Valence').uncheck();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('dialog', { name: 'Create a new version?' })).toBeVisible();
  await shot(page, 'dashboard-09-new-version');
  await expectNoAxeViolations(page, 'new version');
  await page.getByRole('button', { name: 'Issue new links to everyone' }).click();
  await expect(page.getByText('Open, version 2')).toBeVisible();
  // Hide names: the dashboard shows codes, never a member's name.
  await page.getByRole('switch', { name: 'Hide names' }).click();
  const html = await page.locator('.survey').innerHTML();
  expect(demo.members.filter((m) => html.includes(m.display_name))).toStrictEqual([]);
  await page.getByRole('switch', { name: 'Hide names' }).click();
  await shot(page, 'dashboard-10-version-2');
});
