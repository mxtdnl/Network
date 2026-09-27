import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { seededMembersCsv, seededTiesCsv } from '../fixtures/validation/seeded-errors';

// Screenshots go to test-results/screenshots (uploaded by CI), or to
// SCREENSHOT_DIR when set, e.g. SCREENSHOT_DIR=docs/screenshots/phase-2.
const screenshotDir = process.env.SCREENSHOT_DIR ?? join('test-results', 'screenshots');
const templates = join(import.meta.dirname, '..', '..', 'public', 'templates');

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

async function start(page: Page) {
  mkdirSync(screenshotDir, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.evaluate(() => document.fonts.ready);
}

const shot = (page: Page, name: string) =>
  page.screenshot({ path: join(screenshotDir, `${name}.png`) });

test('import the templates, read the validation report and open the matrix', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Import survey data' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import data' });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel('Members file').setInputFiles(join(templates, 'members.csv'));
  await dialog.getByLabel('Ties file').setInputFiles(join(templates, 'ties.csv'));
  await expect(dialog.getByText('members.csv')).toBeVisible();
  await expectNoAxeViolations(page);
  await shot(page, 'import');

  await dialog.getByRole('button', { name: 'Check files' }).click();
  await expect(dialog.getByRole('heading', { name: 'Validation report' })).toBeVisible();
  await expect(dialog.getByText('3 rows of 3 can be imported.')).toBeVisible();
  await expect(dialog.getByText('6 rows of 6 can be imported.')).toBeVisible();
  await expect(dialog.getByText('No rows will be skipped.')).toHaveCount(2);
  await expect(
    dialog.getByText('1 row has an empty value. It is stored as not rated, not as 0.'),
  ).toBeVisible();
  await expectNoAxeViolations(page);
  await shot(page, 'validation-report-templates');

  await dialog.getByRole('button', { name: 'Import 9 valid rows' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: 'Imported 9 rows.' })).toBeVisible();

  await page.getByRole('tab', { name: 'Matrix' }).click();
  // Phase 5: the Matrix tab opens on the adjacency matrix; rating entry is the second mode.
  await page.getByRole('radio', { name: 'Enter ratings' }).check();
  const grid = page.getByRole('grid', { name: 'Connection strength ratings, raters in rows' });
  await expect(grid).toBeVisible();
  await expect(grid.getByRole('row')).toHaveCount(4);
  // M01 rates M02 4; M02 rates M01 3; M01 → M03 is not rated; M01 → M01 is a self-pair.
  const cell = (r: number, c: number) =>
    grid
      .getByRole('row')
      .nth(r + 1)
      .getByRole('gridcell')
      .nth(c);
  await expect(cell(0, 1)).toHaveText('4');
  await expect(cell(1, 0)).toHaveText('3');
  await expect(cell(0, 2)).toHaveText('not rated');
  await expect(cell(0, 0)).toHaveAttribute('aria-disabled', 'true');

  // Keyboard entry: the active cell starts at M01 → M02. Move right to M01 → M03, type 0.
  await grid.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('0');
  await page.keyboard.press('Enter');
  await expect(cell(0, 2)).toHaveText('0');
  await expect(cell(0, 2)).toHaveClass(/matrix__cell--zero/);

  // Delete clears back to "not rated", which differs from 0.
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Delete');
  await expect(cell(0, 2)).toHaveText('not rated');

  // Invalid input is refused with an explanation, not coerced.
  await page.keyboard.type('9');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: '“9” was not entered' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(cell(0, 2)).toHaveText('not rated');

  // Paste a block from a spreadsheet at M02 → M01: the diagonal cell is skipped.
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowDown');
  await grid.evaluate((el) => {
    const data = new DataTransfer();
    data.setData('text/plain', '5\t1\t2\n');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  });
  await expect(cell(1, 0)).toHaveText('5');
  await expect(cell(1, 2)).toHaveText('2');
  await expect(
    page.getByRole('status').filter({ hasText: 'Pasted 2 values. 1 cell was skipped' }),
  ).toBeVisible();
  await expectNoAxeViolations(page);
});

test('import the XLSX templates under the production CSP', async ({ page }) => {
  const cspViolations: string[] = [];
  page.on('console', (msg) => {
    if (/content security policy/i.test(msg.text())) cspViolations.push(msg.text());
  });
  await start(page);
  await page.getByRole('button', { name: 'Import survey data' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import data' });
  await dialog.getByLabel('Members file').setInputFiles(join(templates, 'members.xlsx'));
  await dialog.getByLabel('Ties file').setInputFiles(join(templates, 'ties.xlsx'));
  await dialog.getByRole('button', { name: 'Check files' }).click();
  await expect(dialog.getByText('3 rows of 3 can be imported.')).toBeVisible();
  await expect(dialog.getByText('6 rows of 6 can be imported.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Import 9 valid rows' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Imported 9 rows.' })).toBeVisible();
  expect(cspViolations).toEqual([]);
});

test('the validation report lists every seeded error with its row', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Import survey data' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import data' });
  await dialog.getByLabel('Members file').setInputFiles({
    name: 'members-with-errors.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(seededMembersCsv),
  });
  await dialog.getByLabel('Ties file').setInputFiles({
    name: 'ties-with-errors.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(seededTiesCsv),
  });
  await dialog.getByRole('button', { name: 'Check files' }).click();

  await expect(dialog.getByText('3 rows of 10 can be imported.')).toBeVisible();
  await expect(dialog.getByText('7 rows will be skipped.')).toBeVisible();
  await expect(dialog.getByText('7 rows of 23 can be imported.')).toBeVisible();
  await expect(dialog.getByText('16 rows will be skipped.')).toBeVisible();
  const tiesTable = dialog.getByRole('table').nth(1);
  await expect(
    tiesTable.getByRole('row', { name: /^7 ratee_id The rater and the person rated/ }),
  ).toBeVisible();
  await expect(
    tiesTable.getByRole('row', { name: /^10 value “three” is not a number/ }),
  ).toBeVisible();
  await expect(
    tiesTable.getByRole('row', { name: /^17 variable .*Did you mean connection_strength/ }),
  ).toBeVisible();
  await expectNoAxeViolations(page);
  await shot(page, 'validation-report');

  await dialog.getByRole('button', { name: 'Import 10 valid rows' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Imported 10 rows. 23 rows were skipped.' }),
  ).toBeVisible();
});

test('demo, layer manager, coverage, project files and local persistence', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Load demo' }).click();
  // The map tab now shows the network (Phase 4) rather than a project summary.
  await expect(page.getByText('Demo: Meridian Works', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('group', { name: 'Members on the map' }).getByRole('button'),
  ).toHaveCount(40);
  await expect(page.getByText(/^Coverage \d+%$/)).toBeVisible();

  // Layer manager: core layers can be turned off but not deleted.
  const layers = page.getByRole('complementary', { name: 'Layers and filters' });
  await expect(layers.getByRole('switch', { name: 'Connection strength' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(
    layers.getByRole('switch', { name: 'Advice and information seeking' }),
  ).toHaveAttribute('aria-checked', 'false');
  await layers.getByRole('switch', { name: 'Advice and information seeking' }).click();
  await expect(
    layers.getByRole('switch', { name: 'Advice and information seeking' }),
  ).toHaveAttribute('aria-checked', 'true');
  await expectNoAxeViolations(page);
  await shot(page, 'layer-manager');
  // An enabled layer with no ratings lowers coverage below the threshold.
  await expect(page.getByRole('note').first()).toContainText('below the 80% threshold');
  await layers.getByRole('switch', { name: 'Advice and information seeking' }).click();
  await expect(page.getByRole('note')).toHaveCount(0);

  await layers.getByRole('button', { name: 'Edit Valence' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit layer' });
  await expect(edit.getByRole('button', { name: 'Delete layer' })).toHaveCount(0);
  await expect(edit.getByText('Core layers can be turned off but not deleted.')).toBeVisible();
  await edit
    .getByLabel('Question wording')
    .fill('Overall, how positive or negative is your relationship with this person?');
  await expectNoAxeViolations(page);
  await shot(page, 'layer-edit');
  await edit.getByRole('button', { name: 'Save layer' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Layer saved: Valence.' })).toBeVisible();

  // Optional layers can be deleted and added back.
  await layers.getByRole('button', { name: 'Edit Idea sharing' }).click();
  await edit.getByRole('button', { name: 'Delete layer' }).click();
  await page
    .getByRole('dialog', { name: 'Delete Idea sharing?' })
    .getByRole('button', { name: 'Delete layer' })
    .click();
  await expect(layers.getByRole('switch', { name: 'Idea sharing' })).toHaveCount(0);
  await layers.getByRole('button', { name: 'Add Idea sharing' }).click();
  await expect(layers.getByRole('switch', { name: 'Idea sharing' })).toBeVisible();

  // Matrix on a signed layer.
  await page.getByRole('tab', { name: 'Matrix' }).click();
  await page.getByRole('radio', { name: 'Enter ratings' }).check();
  await page.getByLabel('Layer', { exact: true }).selectOption('valence');
  await expect(page.getByRole('grid', { name: 'Valence ratings, raters in rows' })).toBeVisible();
  await expect(
    page.getByText('Overall, how positive or negative is your relationship with this person?'),
  ).toBeVisible();
  await expectNoAxeViolations(page);
  await shot(page, 'matrix-valence');
  await page.getByLabel('Layer', { exact: true }).selectOption('connection_strength');
  await shot(page, 'matrix');

  // Coverage panel.
  await page.getByRole('tab', { name: 'Coverage' }).click();
  const right = page.getByRole('complementary', { name: 'Member, insights and coverage' });
  await expect(right.getByText('Overall response rate')).toBeVisible();
  await expectNoAxeViolations(page);
  await shot(page, 'coverage');
  await right.getByLabel('Warn below').fill('99');
  await expect(page.getByRole('note').first()).toContainText('below the 99% threshold');
  await shot(page, 'coverage-warning');
  await right.getByLabel('Warn below').fill('80');
  await expect(page.getByRole('note')).toHaveCount(0);

  // Save the project, then open the saved file: nothing is lost.
  await page.getByRole('button', { name: 'Project' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Save project' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('demo-meridian-works.ona.json');
  const saved = readFileSync(await download.path(), 'utf8');
  expect(JSON.parse(saved)).toMatchObject({ schema_version: 3 });

  await page.getByRole('button', { name: 'Project' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Open project…' }).click();
  await page
    .getByRole('dialog', { name: 'Replace the open project?' })
    .getByRole('button', { name: 'Replace project' })
    .click();
  await (
    await chooser
  ).setFiles({ name: 'demo.ona.json', mimeType: 'application/json', buffer: Buffer.from(saved) });
  await expect(
    page.getByRole('status').filter({ hasText: 'Opened Demo: Meridian Works.' }),
  ).toBeVisible();

  // Local persistence is off until turned on, then shows an indicator and survives a reload.
  await expect(page.getByText('Kept in this browser', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Project' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Keep a copy in this browser' }).click();
  await expect(page.getByText('Kept in this browser', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Reopened Demo: Meridian Works from this browser.')).toBeVisible();
  await expect(page.getByText('Kept in this browser', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Project' }).click();
  await page.getByRole('menuitem', { name: 'Clear local data…' }).click();
  await page
    .getByRole('dialog', { name: 'Clear local data?' })
    .getByRole('button', { name: 'Clear local data' })
    .click();
  await expect(page.getByRole('status').filter({ hasText: 'Local data cleared.' })).toBeVisible();
  await expect(page.getByText('Kept in this browser', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('dialog', { name: 'Before you start' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Import data or load the demo' })).toBeVisible();
});
