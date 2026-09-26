import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serialiseProject } from '../../src/data/projectFile';
import { syntheticProject } from '../fixtures/synthetic';

// Phase 4: the network map. Screenshots go to test-results/screenshots, or to
// SCREENSHOT_DIR when set (SCREENSHOT_DIR=docs/screenshots/phase-4).
const screenshotDir = process.env.SCREENSHOT_DIR ?? join('test-results', 'screenshots');

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
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

async function loadDemo(page: Page) {
  await page.getByRole('button', { name: 'Load demo' }).first().click();
  await expect(nodes(page)).toHaveCount(40);
}

/** Waits until the map has drawn and the interaction cache has settled. */
async function settled(page: Page) {
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

/** Share of canvas pixels that differ from the paper ground: the map is drawn. */
async function inkShare(page: Page): Promise<number> {
  return page.locator('canvas.map__canvas').evaluate((c: HTMLCanvasElement) => {
    const ctx = c.getContext('2d');
    if (!ctx) return 0;
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let ink = 0;
    for (let i = 0; i < data.length; i += 16) {
      if ((data[i] ?? 0) < 240 || (data[i + 2] ?? 0) < 240) ink += 1;
    }
    return ink / (data.length / 16);
  });
}

/** Moves the pointer across the canvas until it is over a member (the cursor class changes). */
async function findMemberOnCanvas(page: Page): Promise<{ x: number; y: number }> {
  const canvas = page.locator('canvas.map__canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('No canvas');
  for (let y = box.y + 40; y < box.y + box.height * 0.6; y += 10) {
    for (let x = box.x + box.width * 0.3; x < box.x + box.width - 60; x += 10) {
      await page.mouse.move(x, y);
      if (await canvas.evaluate((c) => c.classList.contains('map__canvas--member')))
        return { x, y };
    }
  }
  throw new Error('No member found under the pointer');
}

const shot = (page: Page, name: string) =>
  page.screenshot({ path: join(screenshotDir, `${name}.png`) });

test('load demo, map renders, filter, select a member, open the panel, traverse by keyboard', async ({
  page,
}) => {
  await start(page);
  await loadDemo(page);
  const map = page.getByRole('tabpanel', { name: 'Map' });

  // The map renders: canvas drawn, legend for every encoding, hidden table of the same members.
  await settled(page);
  expect(await inkShare(page)).toBeGreaterThan(0.02);
  const legend = page.getByRole('region', { name: 'Legend' });
  for (const title of [
    'Node size',
    'Node fill',
    'Edge width',
    'Edge colour',
    'Edge style',
    'Arrowheads',
  ]) {
    await expect(legend.getByText(title, { exact: true })).toBeVisible();
  }
  await expect(legend.getByText('Bridging', { exact: true })).toBeVisible();
  await expect(map.getByRole('table')).toHaveCount(1);
  await expect(map.getByRole('table').getByRole('row')).toHaveCount(41);
  // Demo coverage (95 %) is above the threshold: no warning on the map.
  await expect(map.getByRole('note')).toHaveCount(0);
  await expectNoAxeViolations(page);

  // The legend follows the encodings: mutual view drops arrowheads, a metric renames node size.
  await page.getByRole('radio', { name: 'Mutual' }).check();
  await expect(legend.getByText('Arrowheads', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Combine the two directions by')).toBeVisible();
  await page.getByLabel('Node size').selectOption({ label: 'Local clustering' });
  await expect(legend.getByText('Local clustering', { exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'Directed', exact: true }).check();
  await expect(legend.getByText('Arrowheads', { exact: true })).toBeVisible();
  await page.getByRole('switch', { name: 'Valence on the map' }).click();
  await expect(legend.getByText('Not used: valence is hidden')).toBeVisible();
  await page.getByRole('switch', { name: 'Valence on the map' }).click();

  // Layer toggles can also hide a layer's ties.
  await page.getByRole('radio', { name: 'Hide its ties' }).check();
  await page.getByRole('switch', { name: 'Formal collaboration on the map', exact: true }).click();
  await expect(legend.getByText('Ties on Formal collaboration hidden')).toBeVisible();
  await page.getByRole('switch', { name: 'Formal collaboration on the map', exact: true }).click();
  await page.getByRole('radio', { name: 'Keep its ties' }).check();
  await expect(legend.getByText(/Ties on .* hidden/)).toHaveCount(0);

  // Threshold: the legend states it; fewer ties are shown.
  const tiesOf = async (name: RegExp) =>
    Number(
      /(\d+) ties? shown/.exec(
        (await nodes(page).filter({ hasText: name }).textContent()) ?? '',
      )?.[1],
    );
  const before = await tiesOf(/^Lior Theodolite/);
  await page.getByLabel('Tie strength at least').fill('0.5');
  await expect(legend.getByText('Ties below 0.50 hidden')).toBeVisible();
  expect(await tiesOf(/^Lior Theodolite/)).toBeLessThan(before);
  await page.getByLabel('Tie strength at least').fill('0');

  // Filter: only Finance members remain on the map and in the table.
  await page.getByLabel('Attribute', { exact: true }).selectOption({ label: 'Team or function' });
  await page.getByLabel('Value', { exact: true }).selectOption('Finance');
  await page.getByRole('button', { name: 'Add filter' }).click();
  const chip = page.getByRole('button', { name: 'Remove filter Team or function: Finance' });
  await expect(chip).toBeVisible();
  await expect(nodes(page)).toHaveCount(8);
  await expect(map.getByRole('table').getByRole('row')).toHaveCount(9);
  await chip.click();
  await expect(nodes(page)).toHaveCount(40);

  // Search lists matches; choosing one opens the member panel.
  await page.getByLabel('Search').fill('ivo');
  await expect(page.getByText('1 member matches.')).toBeVisible();
  await page.getByRole('button', { name: 'Ivo Hachure', exact: true }).click();
  const panel = page.getByRole('article', { name: 'Ivo Hachure' });
  await expect(panel).toBeVisible();
  await page.getByLabel('Search').fill('');

  // Select a member with the pointer on the canvas: the panel opens with metrics, ranks and ties.
  await settled(page);
  const at = await findMemberOnCanvas(page);
  await page.mouse.click(at.x, at.y);
  const member = page.getByRole('tabpanel', { name: 'Member' }).getByRole('article');
  await expect(member).toBeVisible();
  await expect(member.getByRole('columnheader', { name: 'Rank' })).toBeVisible();
  await expect(member.getByRole('rowheader', { name: /Bridging/ })).toBeVisible();
  await expect(member.getByRole('heading', { name: 'Ties by layer' })).toBeVisible();
  await expect(member.getByText('– means not rated, which is different from 0.')).toBeVisible();
  // Plain-English explanation from the method notes.
  await member.getByRole('button', { name: 'About Bridging' }).hover();
  await expect(page.getByRole('tooltip')).toContainText(
    'How often a member lies on the shortest routes between other members.',
  );
  await expectNoAxeViolations(page);
  await shot(page, 'map-member-1440');

  // Keyboard: nodes are focusable, arrows move between neighbours, Enter opens, Escape closes.
  await page.getByRole('button', { name: /^Lior Theodolite/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('article', { name: 'Lior Theodolite' })).toBeVisible();
  const visited = new Set<string>();
  for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
    await page.keyboard.press(key);
    const name = await page.evaluate(() => document.activeElement?.textContent ?? '');
    expect(name).toMatch(/ties? shown$/);
    visited.add(name);
  }
  expect(visited.size).toBeGreaterThan(1);
  const focusedName = (await page.evaluate(() => document.activeElement?.textContent ?? '')).split(
    ',',
  )[0];
  await page.keyboard.press('Enter');
  await expect(page.getByRole('article', { name: focusedName })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(page.getByText('Select a member on the map')).toBeVisible();
  // Focus stays on the member's node, and is drawn on the map.
  expect(await page.evaluate(() => document.activeElement?.textContent ?? '')).toContain(
    focusedName,
  );

  // Escape inside the panel closes it and returns focus to the node.
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Close member panel' }).focus();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('article')).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.textContent ?? '')).toContain(
    focusedName,
  );

  // Zoom and fit.
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Fit to view' }).click();
  await expectNoAxeViolations(page);
});

test('250 members and 10,000 ties: pan and zoom frame time, filter, coverage warning', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  await start(page);
  const project = syntheticProject();
  const edges = project.ties.filter((t) => t.variable === 'connection_strength').length;
  expect(edges).toBeGreaterThan(9_000);
  expect(edges).toBeLessThan(11_000);

  await page.getByRole('button', { name: 'Project' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Open project…' }).click();
  await (
    await chooser
  ).setFiles({
    name: 'synthetic.ona.json',
    mimeType: 'application/json',
    buffer: Buffer.from(serialiseProject(project)),
  });
  await expect(nodes(page)).toHaveCount(250, { timeout: 60_000 });
  await page.getByLabel('Ties from').selectOption({ label: 'Connection strength' });
  await settled(page);

  // Coverage is far below the threshold: the warning is on the map.
  const map = page.getByRole('tabpanel', { name: 'Map' });
  await expect(map.getByRole('note')).toContainText('below the 80% threshold');

  // Frame intervals while panning (drag) and zooming (wheel) continuously.
  const canvas = page.locator('canvas.map__canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('No canvas');
  // Start the drag on empty ground so it pans rather than moving a member.
  const cx = box.x + box.width - 80;
  const cy = box.y + 60;
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __recording: boolean };
    w.__frames = [];
    w.__recording = true;
    let last = performance.now();
    const tick = (now: number) => {
      w.__frames.push(now - last);
      last = now;
      if (w.__recording) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const t0 = Date.now();
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 0; i < 60; i++) await page.mouse.move(cx - i * 6, cy + i * 4);
  await page.mouse.up();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 40; i++) await page.mouse.wheel(0, i < 20 ? -60 : 60);
  const elapsed = Date.now() - t0;
  const frames = await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __recording: boolean };
    w.__recording = false;
    return w.__frames.slice(1);
  });
  const sorted = [...frames].sort((a, b) => a - b);
  const q = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? NaN;
  const report = {
    members: 250,
    ties: edges,
    frames: frames.length,
    elapsedMs: elapsed,
    meanMs: frames.reduce((s, x) => s + x, 0) / frames.length,
    medianMs: q(0.5),
    p95Ms: q(0.95),
    maxMs: sorted[sorted.length - 1] ?? NaN,
  };

  // Filter latency: from the change to the next drawn frame.
  const tf = Date.now();
  await page.getByLabel('Attribute', { exact: true }).selectOption({ label: 'Team or function' });
  await page.getByLabel('Value', { exact: true }).selectOption('North');
  await page.getByRole('button', { name: 'Add filter' }).click();
  await expect(nodes(page)).toHaveCount(50);
  const filterReport = { filterToFiftyMembersMs: Date.now() - tf };

  const out = { ...report, ...filterReport };
  console.log(`Map frame times, 250 members: ${JSON.stringify(out)}`);
  mkdirSync('test-results', { recursive: true });
  writeFileSync(join('test-results', 'map-frame-times.json'), JSON.stringify(out, null, 2));
  await info.attach('map-frame-times', {
    body: JSON.stringify(out, null, 2),
    contentType: 'application/json',
  });

  expect(report.frames).toBeGreaterThan(30);
  // No visible lag: frames keep coming at interactive rates while the view moves.
  expect(report.medianMs).toBeLessThan(50);
  await page.getByRole('button', { name: /Remove filter/ }).click();
  await expect(nodes(page)).toHaveCount(250);
  await page.getByRole('button', { name: 'Fit to view' }).click();
  await settled(page);
  await shot(page, 'map-synthetic-250');
});

/** Simulates a washed-out projector: lower contrast, raised black level. */
async function projectorShot(page: Page, name: string) {
  const png = await page.screenshot();
  const sim = await page.context().newPage();
  await sim.setViewportSize(page.viewportSize() ?? { width: 1440, height: 900 });
  await sim.setContent('<canvas id="c"></canvas>');
  const out = await sim.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.getElementById('c') as HTMLCanvasElement;
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    if (!ctx) return '';
    ctx.filter = 'contrast(55%) brightness(115%) saturate(80%)';
    ctx.drawImage(img, 0, 0);
    return c.toDataURL('image/png').split(',')[1] ?? '';
  }, png.toString('base64'));
  writeFileSync(join(screenshotDir, `${name}.png`), Buffer.from(out, 'base64'));
  await sim.close();
}

test('screenshots of the demo map at 1440 and 2560 px, and on a simulated projector', async ({
  page,
}) => {
  await start(page, 1440, 900);
  await loadDemo(page);
  await settled(page);
  await shot(page, 'map-1440');
  await projectorShot(page, 'map-1440-projector');

  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.getByRole('button', { name: 'Fit to view' }).click();
  await settled(page);
  await shot(page, 'map-2560');
});
