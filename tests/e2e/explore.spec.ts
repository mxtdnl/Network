import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serialiseProject } from '../../src/data/projectFile';
import { syntheticProject } from '../fixtures/synthetic';

// Phase 5: composite weighting, layouts, linked views, ego view, shortest
// path, resilience, multi-select, rank stability and the formal–informal
// comparison. Screenshots go to test-results/screenshots, or to SCREENSHOT_DIR
// when set (SCREENSHOT_DIR=docs/screenshots/phase-5).
const screenshotDir = process.env.SCREENSHOT_DIR ?? join('test-results', 'screenshots');

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes[0]?.target.join(' ') ?? ''})`),
  ).toEqual([]);
}

async function start(page: Page, width = 1440, height = 900) {
  mkdirSync(screenshotDir, { recursive: true });
  await page.setViewportSize({ width, height });
  await page.goto('./');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.evaluate(() => document.fonts.ready);
}

const nodes = (page: Page) =>
  page.getByRole('group', { name: 'Members on the map' }).getByRole('button');
const node = (page: Page, name: string) => nodes(page).filter({ hasText: name });

async function loadDemo(page: Page) {
  await page.getByRole('button', { name: 'Load demo' }).first().click();
  await expect(nodes(page)).toHaveCount(40);
}

async function openSynthetic(page: Page) {
  await page.getByRole('button', { name: 'Project' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Open project…' }).click();
  await (
    await chooser
  ).setFiles({
    name: 'synthetic.ona.json',
    mimeType: 'application/json',
    buffer: Buffer.from(serialiseProject(syntheticProject())),
  });
  await expect(nodes(page)).toHaveCount(250, { timeout: 60_000 });
}

/** Waits for the map to finish drawing and for any transition to end. */
async function settled(page: Page) {
  await page.waitForFunction(
    () =>
      document.querySelector('canvas.map__canvas')?.getAttribute('data-transition') !== 'running',
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let n = 0;
        const step = () => {
          n += 1;
          if (n > 20) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
  );
  await page.waitForTimeout(300);
}

const shot = async (page: Page, name: string) => {
  await page.screenshot({ path: join(screenshotDir, `${name}.png`) });
};

/** Selects a member on the map with the keyboard (focus the member, Enter). */
async function selectOnMap(page: Page, name: string, shift = false) {
  await page.getByRole('tab', { name: 'Map' }).click();
  const button = node(page, name);
  await button.focus();
  await page.keyboard.press(shift ? 'Shift+Enter' : 'Enter');
}

const leftColumn = (page: Page) => page.getByRole('complementary', { name: 'Layers and filters' });
const rightColumn = (page: Page) =>
  page.getByRole('complementary', { name: 'Member, insights and coverage' });
const formula = (page: Page) => page.getByTestId('composite-formula');

test('weights: presets, sliders, signed treatment, live formula and animated layout', async ({
  page,
}) => {
  await start(page);
  await loadDemo(page);
  await settled(page);

  // Custom with default weights: four equal shares, valence as positive ratings.
  await expect(page.getByLabel('Preset')).toHaveValue('custom');
  await expect(formula(page).getByRole('listitem')).toHaveCount(5);
  await expect(formula(page)).toContainText('0.25×Connection strength');
  await expect(formula(page)).toContainText('Valence, positive ratings');
  await expectNoAxeViolations(page);

  // A preset re-weights the composite; the shares by the sliders and the formula follow the engine.
  const canvas = page.locator('canvas.map__canvas');
  await page.getByLabel('Preset').selectOption({ label: 'Formal structure' });
  await expect(canvas).toHaveAttribute('data-transition', 'running');
  await expect(formula(page)).toContainText('1.00×Formal collaboration');
  await expect(formula(page)).not.toContainText('Connection strength');
  await expect(formula(page)).not.toContainText('Informal collaboration');
  await expect(leftColumn(page).locator('output', { hasText: 'Not used' })).toHaveCount(3);
  await settled(page);
  await shot(page, 'weights-formal-structure');

  // Moving a slider starts a Custom weighting from the preset's values.
  const informal = page.getByRole('slider', { name: 'Informal collaboration' });
  await informal.focus();
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight');
  await expect(page.getByLabel('Preset')).toHaveValue('custom');
  await expect(formula(page)).toContainText('Informal collaboration');

  // A signed layer as a multiplier, then as a filter.
  const valence = page.getByRole('slider', { name: 'Valence' });
  await valence.focus();
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight');
  await page.getByLabel('Use Valence as').selectOption({ label: 'A multiplier on the composite' });
  await expect(formula(page)).toContainText('× (1 + 0.5 × Valence)');
  await expect(leftColumn(page).locator('output', { hasText: 'Multiplier' })).toHaveCount(1);
  await settled(page);
  await shot(page, 'weights-multiplier');
  await page.getByLabel('Use Valence as').selectOption({
    label: 'A filter: negative ratings remove the tie',
  });
  await expect(formula(page)).toContainText('set to 0 where Valence is negative');
  await expectNoAxeViolations(page);

  // Under reduced motion the members move at once.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await settled(page);
  await page.evaluate(() => {
    const c = document.querySelector('canvas.map__canvas');
    const w = window as unknown as { __moved: boolean };
    w.__moved = false;
    new MutationObserver(() => {
      if (c?.getAttribute('data-transition') === 'running') w.__moved = true;
    }).observe(c as Element, { attributes: true });
  });
  await page.getByLabel('Preset').selectOption({ label: 'Relationship health' });
  await expect(formula(page)).toContainText('× (1 + 0.5 × Valence)');
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => (window as unknown as { __moved: boolean }).__moved)).toBe(
    false,
  );
});

test('layouts: grouped, circular and formal hierarchy, with animated transitions', async ({
  page,
}) => {
  await start(page);
  await loadDemo(page);
  await settled(page);
  const canvas = page.locator('canvas.map__canvas');
  const legend = page.getByRole('region', { name: 'Legend' });

  await page.getByRole('radio', { name: 'Grouped' }).check();
  await expect(canvas).toHaveAttribute('data-transition', 'running');
  await expect(page.getByLabel('Group by')).toHaveValue('team');
  await expect(legend.getByText('Grouped by Team or function')).toBeVisible();
  await settled(page);
  await shot(page, 'layout-grouped');

  await page.getByRole('radio', { name: 'Circular' }).check();
  await expect(canvas).toHaveAttribute('data-transition', 'running');
  await settled(page);
  await expect(legend.getByText('On a circle by Team or function')).toBeVisible();
  await shot(page, 'layout-circular');

  const hierarchy = page.getByRole('radio', { name: 'Formal hierarchy' });
  await expect(hierarchy).toBeEnabled();
  await hierarchy.check();
  await settled(page);
  await expect(legend.getByText('Reporting line, manager above')).toBeVisible();
  // Over the hierarchy the ties drawn are informal collaboration.
  await expect(legend.getByText('Informal collaboration', { exact: true })).toBeVisible();
  await expectNoAxeViolations(page);
  await shot(page, 'layout-hierarchy');

  await page.getByRole('radio', { name: 'Force-directed' }).check();
  await settled(page);
  await expect(legend.getByText('Position', { exact: true })).toHaveCount(0);
});

test('selection stays in sync across the map, the matrix and the table', async ({ page }) => {
  await start(page);
  await loadDemo(page);
  await settled(page);

  // Select on the map: the panel opens, and the matrix and table follow.
  await selectOnMap(page, 'Lior Theodolite');
  await expect(rightColumn(page).getByRole('heading', { name: 'Lior Theodolite' })).toBeVisible();
  await expect(node(page, 'Lior Theodolite')).toHaveAttribute('aria-pressed', 'true');
  await settled(page);
  await shot(page, 'selection-map');

  await page.getByRole('tab', { name: 'Matrix' }).click();
  const grid = page.getByRole('grid', { name: /Tie strength between members/ });
  await expect(grid).toBeVisible();
  await expect(grid.getByRole('row', { selected: true })).toHaveCount(1);
  await expect(grid.getByRole('row', { selected: true }).getByRole('rowheader')).toHaveText(
    'Lior Theodolite',
  );
  await expectNoAxeViolations(page);
  await shot(page, 'selection-matrix');

  await page.getByRole('tab', { name: 'Table' }).click();
  const table = page.getByRole('table', { name: /Network position of 40 members/ });
  await expect(table.getByRole('button', { name: 'Lior Theodolite' })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expectNoAxeViolations(page);
  await shot(page, 'selection-table');

  // Select in the table: the map and the matrix follow.
  await table.getByRole('button', { name: 'Farah Easting' }).click();
  await expect(rightColumn(page).getByRole('heading', { name: 'Farah Easting' })).toBeVisible();
  await page.getByRole('tab', { name: 'Matrix' }).click();
  await expect(grid.getByRole('row', { selected: true }).getByRole('rowheader')).toHaveText(
    'Farah Easting',
  );
  await page.getByRole('tab', { name: 'Map' }).click();
  await expect(node(page, 'Farah Easting')).toHaveAttribute('aria-pressed', 'true');
  await expect(node(page, 'Lior Theodolite')).toHaveAttribute('aria-pressed', 'false');

  // Select in the matrix (keyboard: Enter on the active row): the table and the map follow.
  await page.getByRole('tab', { name: 'Matrix' }).click();
  await grid.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const chosen =
    (await grid.getByRole('row', { selected: true }).getByRole('rowheader').textContent()) ?? '';
  expect(chosen).not.toBe('Farah Easting');
  await page.getByRole('tab', { name: 'Table' }).click();
  await expect(table.getByRole('button', { name: chosen })).toHaveAttribute('aria-current', 'true');
  await page.getByRole('tab', { name: 'Map' }).click();
  await expect(node(page, chosen)).toHaveAttribute('aria-pressed', 'true');

  // The subgroup is shared too: ticked in the table, marked on the map and in the matrix.
  await page.getByRole('tab', { name: 'Table' }).click();
  await table.getByRole('checkbox', { name: 'Hana Isobar in the subgroup' }).check();
  await page.getByRole('tab', { name: 'Map' }).click();
  await expect(node(page, 'Hana Isobar')).toContainText('in the subgroup');
  await page.getByRole('tab', { name: 'Matrix' }).click();
  await expect(grid.getByRole('rowheader', { name: /Hana Isobar/ })).toContainText(
    'in the subgroup',
  );

  // Sorting the matrix by community or a metric keeps the selection.
  await page.getByLabel('Order by').selectOption({ label: 'Community' });
  await expect(grid.getByRole('row', { selected: true })).toHaveCount(1);
  await page.getByLabel('Order by').selectOption({ label: 'Bridging' });
  await expect(grid.getByRole('rowheader').first()).toContainText('Lior Theodolite');
  await shot(page, 'matrix-by-bridging');
});

test('ego view at one and two steps, shared by every view', async ({ page }) => {
  await start(page);
  await loadDemo(page);
  await settled(page);
  await selectOnMap(page, 'Hana Isobar');
  await rightColumn(page).getByRole('button', { name: 'Show ego network' }).click();
  const map = page.getByRole('tabpanel', { name: 'Map' });
  await expect(map.getByText('Ego view: Hana Isobar and members within one step.')).toBeVisible();
  const one = await nodes(page).count();
  expect(one).toBeLessThan(40);
  expect(one).toBeGreaterThan(1);
  await settled(page);
  await shot(page, 'ego-one-step');

  // Two steps from the Explore tab; the table shows the same members.
  await rightColumn(page).getByRole('tab', { name: 'Explore' }).click();
  await rightColumn(page).getByRole('radio', { name: '2 steps' }).check();
  await expect(map.getByText('members within two steps')).toBeVisible();
  const two = await nodes(page).count();
  expect(two).toBeGreaterThanOrEqual(one);
  await expect(
    rightColumn(page).getByText(`Showing Hana Isobar and ${String(two - 1)} other members.`),
  ).toBeVisible();
  await settled(page);
  await expectNoAxeViolations(page);
  await shot(page, 'ego-two-steps');
  await page.getByRole('tab', { name: 'Table' }).click();
  await expect(
    page.getByRole('table', { name: new RegExp(`Network position of ${String(two)} members`) }),
  ).toBeVisible();

  await page.getByRole('tab', { name: 'Map' }).click();
  await map.getByRole('button', { name: 'Show everyone' }).click();
  await expect(nodes(page)).toHaveCount(40);
});

test('shortest path between two chosen members, highlighted with its distance', async ({
  page,
}) => {
  await start(page);
  await loadDemo(page);
  await settled(page);
  const right = rightColumn(page);
  await right.getByRole('tab', { name: 'Explore' }).click();
  await right.getByLabel('From', { exact: true }).selectOption({ label: 'Hana Isobar' });
  await right.getByLabel('To', { exact: true }).selectOption({ label: 'Zara Alidade' });
  await right.getByRole('button', { name: 'Find path' }).click();

  const distance = right.getByTestId('path-distance');
  await expect(distance).toHaveText(/^\d+(\.\d+)?$/);
  expect(Number(await distance.textContent())).toBeGreaterThan(0);
  const route = right
    .getByRole('list')
    .filter({ has: page.getByRole('button', { name: 'Show Hana Isobar' }) });
  const stops = await route.getByRole('listitem').count();
  expect(stops).toBeGreaterThanOrEqual(2);
  await expect(route.getByRole('listitem').first()).toHaveText('Hana Isobar');
  await expect(route.getByRole('listitem').last()).toHaveText('Zara Alidade');
  await expect(right.getByText('Steps', { exact: true })).toBeVisible();

  const map = page.getByRole('tabpanel', { name: 'Map' });
  await expect(map.getByText('Shortest path from Hana Isobar to Zara Alidade.')).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Legend' }).getByText('Shortest path'),
  ).toBeVisible();
  await settled(page);
  await expectNoAxeViolations(page);
  await shot(page, 'path');

  // A weight change recomputes the path on the new composite.
  await page.getByLabel('Preset').selectOption({ label: 'Informal network' });
  await expect(distance).toHaveText(/^\d+(\.\d+)?$/);
  await map.getByRole('button', { name: 'Clear path' }).click();
  await expect(map.getByText(/Shortest path from/)).toHaveCount(0);
});

test('resilience: remove members and compare before and after', async ({ page }) => {
  await start(page);
  await loadDemo(page);
  await settled(page);
  const right = rightColumn(page);
  await right.getByRole('tab', { name: 'Explore' }).click();
  await right.getByLabel('Members to remove').selectOption({ label: 'Lior Theodolite' });
  await right.getByRole('button', { name: 'Add', exact: true }).click();
  await right.getByLabel('Members to remove').selectOption({ label: 'Farah Easting' });
  await right.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(right.getByRole('button', { name: 'Keep Lior Theodolite' })).toBeVisible();
  await right.getByRole('button', { name: 'Run simulation' }).click();

  const table = right.getByTestId('resilience-table');
  await expect(table).toBeVisible();
  for (const row of [
    'Separate parts',
    'Members in the largest part',
    'Pairs that can reach each other',
    'Average distance, reachable pairs',
  ]) {
    await expect(table.getByRole('rowheader', { name: row })).toBeVisible();
  }
  // Largest part: 40 before, 38 after.
  const largest = table.getByRole('row', { name: /Members in the largest part/ });
  await expect(largest.getByRole('cell').nth(0)).toHaveText('40');
  await expect(largest.getByRole('cell').nth(1)).toHaveText('38');
  await expect(largest.getByRole('cell').nth(2)).toHaveText('−2');

  // The map hides the removed members, and can show them again.
  const map = page.getByRole('tabpanel', { name: 'Map' });
  await expect(nodes(page)).toHaveCount(38);
  await expect(
    map.getByText('Simulating the removal of 2 members; they are hidden.'),
  ).toBeVisible();
  await settled(page);
  await expectNoAxeViolations(page);
  await shot(page, 'resilience');
  await map.getByRole('button', { name: 'Show them' }).click();
  await expect(nodes(page)).toHaveCount(40);
  await map.getByRole('button', { name: 'End simulation' }).click();
  await expect(table).toHaveCount(0);

  // From the member panel: "Remove in simulation".
  await selectOnMap(page, 'Ivo Hachure');
  await right.getByRole('button', { name: 'Remove in simulation' }).click();
  await expect(right.getByTestId('resilience-table')).toBeVisible();
});

test('multi-select and lasso define a subgroup with internal and external tie density', async ({
  page,
}) => {
  await start(page);
  await loadDemo(page);
  await settled(page);

  // Shift and Enter adds members from the keyboard (Shift-click does the same with a pointer).
  await selectOnMap(page, 'Chiara Azimuth', true);
  await selectOnMap(page, 'Farah Easting', true);
  await selectOnMap(page, 'Elif Datum', true);
  await expect(node(page, 'Farah Easting')).toContainText('in the subgroup');
  const map = page.getByRole('tabpanel', { name: 'Map' });
  await expect(map.getByRole('button', { name: 'Clear subgroup (3)' })).toBeVisible();

  const right = rightColumn(page);
  await right.getByRole('tab', { name: 'Explore' }).click();
  await expect(right.getByText('3 members')).toBeVisible();
  const density = right.getByTestId('subgroup-density');
  await expect(density.getByRole('rowheader', { name: 'Inside the subgroup' })).toBeVisible();
  await expect(density.getByRole('rowheader', { name: 'With everyone else' })).toBeVisible();
  await expect(density.getByText('of 6 possible')).toBeVisible();
  await expect(density.getByText('of 222 possible')).toBeVisible();
  await settled(page);
  await expectNoAxeViolations(page);
  await shot(page, 'subgroup-keyboard');

  // Lasso: draw round part of the map.
  await map.getByRole('button', { name: 'Lasso select' }).click();
  await expect(map.getByRole('button', { name: 'Lasso select' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const box = await page.locator('canvas.map__canvas').boundingBox();
  if (!box) throw new Error('No canvas');
  const x0 = box.x + box.width * 0.05;
  const y0 = box.y + box.height * 0.05;
  const x1 = box.x + box.width * 0.55;
  const y1 = box.y + box.height * 0.55;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (const [x, y] of [
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0 + 2],
  ] as const) {
    await page.mouse.move(x, y, { steps: 8 });
  }
  await page.mouse.up();
  const clear = map.getByRole('button', { name: /Clear subgroup \(\d+\)/ });
  await expect(clear).toBeVisible();
  const size = Number(/\((\d+)\)/.exec((await clear.textContent()) ?? '')?.[1]);
  expect(size).toBeGreaterThan(0);
  await expect(
    right.getByText(`${String(size)} member${size === 1 ? '' : 's'}`, { exact: true }),
  ).toBeVisible();
  await settled(page);
  await shot(page, 'subgroup-lasso');

  await clear.click();
  await expect(right.getByText('No subgroup yet.')).toBeVisible();
  await map.getByRole('button', { name: 'Lasso select' }).click();
  await expect(map.getByRole('button', { name: 'Lasso select' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

test('rank stability: run the bootstrap and see rank ranges in the table and panel', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await start(page);
  await loadDemo(page);
  await page.getByRole('tab', { name: 'Table' }).click();
  await page.getByRole('button', { name: 'Run resampling' }).click();
  await expect(page.getByText('Rank ranges for Bridging from 200 resamples.')).toBeVisible({
    timeout: 60_000,
  });
  const table = page.getByRole('table', { name: /Network position of 40 members/ });
  await expect(table.getByRole('columnheader', { name: 'Sort by Rank range' })).toBeVisible();
  await expect(
    table
      .getByRole('cell')
      .filter({ hasText: /^\d+–\d+$/ })
      .first(),
  ).toBeVisible();
  await expectNoAxeViolations(page);
  await shot(page, 'stability-ranges');

  // The member panel shows the resampled range for that metric.
  await table.getByRole('button', { name: 'Lior Theodolite' }).click();
  await expect(
    rightColumn(page).getByText(/range from resampling \(95 %, 200 resamples\)/),
  ).toBeVisible();
});

test('rank stability on 250 members: progress, cancel; the hierarchy needs manager ids', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await start(page);
  // A 250-member network takes long enough to show progress and cancel.
  await openSynthetic(page);
  await page.getByRole('tab', { name: 'Table' }).click();
  await page.getByRole('button', { name: 'Run resampling' }).click();
  const progress = page.getByRole('progressbar', { name: 'Resampling progress' });
  await expect(progress).toBeVisible();
  await expect(page.getByText(/Resampling… \d+% done\./)).toBeVisible();
  await shot(page, 'stability-running');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(
    page.getByText('Resampling cancelled. Run it again to see rank ranges.'),
  ).toBeVisible();
  await expect(progress).toHaveCount(0);

  // The synthetic project has no manager ids: the hierarchy is offered but disabled, with a reason.
  await page.getByRole('tab', { name: 'Map' }).click();
  const hierarchy = page.getByRole('radio', { name: 'Formal hierarchy' });
  await expect(hierarchy).toBeDisabled();
  await expect(
    leftColumn(page).getByText(/Formal hierarchy needs formal manager ids/),
  ).toBeVisible();
  await hierarchy.scrollIntoViewIfNeeded();
  await shot(page, 'layout-hierarchy-unavailable');
});

test('table export: sortable, and the CSV holds the rows and columns shown', async ({ page }) => {
  await start(page);
  await loadDemo(page);
  await page.getByRole('tab', { name: 'Table' }).click();
  const table = page.getByRole('table', { name: /Network position of 40 members/ });
  await table.getByRole('button', { name: 'Sort by Member' }).click();
  await expect(table.getByRole('row').nth(1).getByRole('rowheader')).toHaveText('Ada Meridian');
  await expect(table.getByRole('columnheader', { name: 'Sort by Member' })).toHaveAttribute(
    'aria-sort',
    'ascending',
  );
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export table' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('graticule-metrics-composite-directed.csv');
  const text = await (await file.createReadStream()).toArray();
  const csv = Buffer.concat(text as Buffer[])
    .toString('utf8')
    .replace(/^\uFEFF/, '');
  const lines = csv.trim().split('\r\n');
  expect(lines).toHaveLength(41);
  expect(lines[0]?.split(',').slice(0, 3)).toEqual(['Member', 'Team or function', 'Community']);
  expect(lines[1]?.startsWith('Ada Meridian,')).toBe(true);
  await expect(page.getByRole('status').filter({ hasText: 'Table exported as' })).toBeVisible();

  // A filter narrows the table, and the export with it.
  await page.getByRole('tab', { name: 'Map' }).click();
  await page.getByRole('button', { name: 'Add filter' }).click();
  await page.getByRole('tab', { name: 'Table' }).click();
  await expect(page.getByRole('table', { name: /Network position of 8 members/ })).toBeVisible();
});

test('comparison views: two layers side by side, and formal against informal ties', async ({
  page,
}) => {
  await start(page);
  await loadDemo(page);
  await page.getByRole('tab', { name: 'Compare' }).click();
  await expect(page.getByLabel('Left')).toHaveValue('formal_collaboration');
  await expect(page.getByLabel('Right')).toHaveValue('informal_collaboration');
  const overlap = page.getByTestId('layer-overlap');
  await expect(overlap.getByRole('rowheader', { name: 'Tied on both layers' })).toBeVisible();
  await page.waitForTimeout(300);
  await expectNoAxeViolations(page);
  await shot(page, 'compare-layers');

  // Per-member counts are the keyboard route to members here; selecting one syncs everywhere.
  await page.getByRole('button', { name: 'Show ties per member' }).click();
  await page.getByRole('button', { name: 'Lior Theodolite' }).click();
  await expect(rightColumn(page).getByRole('heading', { name: 'Lior Theodolite' })).toBeVisible();
  await page.getByLabel('Right').selectOption({ label: 'Valence, negative ties' });
  await expect(overlap).toContainText('Only on Valence, negative ties');

  await page.getByRole('radio', { name: 'Formal and informal' }).check();
  const counts = page.getByTestId('formal-informal-counts');
  for (const label of ['Formal only', 'Informal only', 'Both', 'Neither']) {
    await expect(counts.getByRole('rowheader', { name: label, exact: true })).toBeVisible();
  }
  const shares = await counts
    .getByRole('row')
    .evaluateAll((rows) =>
      rows
        .slice(1, 4)
        .map((r) => Number((r.querySelectorAll('td')[1]?.textContent ?? '').replace('%', ''))),
    );
  expect(shares.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(99);
  expect(shares.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(101);
  await expect(page.getByText(/^Formal only: \d+$/)).toBeVisible();
  await page.waitForTimeout(300);
  await expectNoAxeViolations(page);
  await shot(page, 'compare-formal-informal');
});

test('member panel actions and the explore panel pass axe', async ({ page }) => {
  await start(page);
  await loadDemo(page);
  await settled(page);
  await selectOnMap(page, 'Lior Theodolite');
  const right = rightColumn(page);
  for (const name of ['Show ego network', 'Add to subgroup', 'Remove in simulation']) {
    await expect(right.getByRole('button', { name })).toBeVisible();
  }
  await right.getByRole('button', { name: 'Add to subgroup' }).click();
  await expect(right.getByRole('button', { name: 'Take out of subgroup' })).toBeVisible();
  await shot(page, 'member-panel-actions');
  await right.getByRole('tab', { name: 'Explore' }).click();
  await expectNoAxeViolations(page);
  await shot(page, 'explore-panel');
});
