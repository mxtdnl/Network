import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseProject } from '../../src/data/projectFile';

// Phase 6: insights, saved views, presentation mode and anonymisation.
// Screenshots go to test-results/screenshots, or to SCREENSHOT_DIR when set
// (SCREENSHOT_DIR=docs/screenshots/phase-6).
const screenshotDir = process.env.SCREENSHOT_DIR ?? join('test-results', 'screenshots');

const demo = parseProject(
  readFileSync(join(import.meta.dirname, '..', '..', 'src', 'demo', 'demo.ona.json'), 'utf8'),
);
const DISPLAY_NAMES = demo.members.map((m) => m.display_name);

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes[0]?.target.join(' ') ?? ''})`),
  ).toEqual([]);
}

/** Records every string drawn on a 2D canvas, so labels on the map can be checked. */
async function recordCanvasText(page: Page) {
  await page.addInitScript(() => {
    const drawn: string[] = [];
    (window as unknown as { __drawn: string[] }).__drawn = drawn;
    const proto = CanvasRenderingContext2D.prototype;
    const originalFill = Object.getOwnPropertyDescriptor(proto, 'fillText')?.value as (
      this: CanvasRenderingContext2D,
      text: string,
      x: number,
      y: number,
      maxWidth?: number,
    ) => void;
    const originalStroke = Object.getOwnPropertyDescriptor(proto, 'strokeText')
      ?.value as typeof originalFill;
    proto.fillText = function (
      this: CanvasRenderingContext2D,
      text: string,
      x: number,
      y: number,
      maxWidth?: number,
    ) {
      drawn.push(`${this.font}|${text}`);
      originalFill.call(this, text, x, y, maxWidth);
    };
    proto.strokeText = function (
      this: CanvasRenderingContext2D,
      text: string,
      x: number,
      y: number,
      maxWidth?: number,
    ) {
      drawn.push(`${this.font}|${text}`);
      originalStroke.call(this, text, x, y, maxWidth);
    };
  });
}

const drawnText = (page: Page) =>
  page.evaluate(() => (window as unknown as { __drawn: string[] }).__drawn.splice(0));

async function start(page: Page, width = 1440, height = 900) {
  mkdirSync(screenshotDir, { recursive: true });
  await recordCanvasText(page);
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

const right = (page: Page) =>
  page.getByRole('complementary', { name: 'Member, insights and coverage' });
const rightTab = (page: Page, name: string) => right(page).getByRole('tab', { name });
const centreTab = (page: Page, name: string) =>
  page.getByRole('main').getByRole('tab', { name, exact: true });

async function saveView(page: Page, name: string) {
  await rightTab(page, 'Views').click();
  await page.getByLabel('Name of the new view').fill(name);
  await page.getByRole('button', { name: 'Save view' }).click();
  await expect(page.getByText(`View saved: ${name}`)).toBeVisible();
}

async function caption(page: Page, viewName: string, text: string) {
  const item = right(page).getByRole('listitem').filter({ hasText: viewName });
  const field = item.getByLabel('Caption');
  await field.fill(text);
  await field.blur();
}

test('insights: every rule with its rule text, questions, and a link to the view that shows it', async ({
  page,
}) => {
  await start(page);
  await loadDemo(page);
  await rightTab(page, 'Insights').click();
  const panel = right(page);
  for (const title of [
    'Potential brokers',
    'Peripheral members',
    'Possible overload',
    'Silos',
    'Negative clusters',
    'Formal ties with no informal counterpart',
    'Informal ties with no formal counterpart',
  ]) {
    await expect(panel.getByRole('heading', { name: title, exact: true })).toBeVisible();
  }
  // Each rule states its thresholds; one that cannot run says why.
  await expect(panel.getByText(/among the highest 10% of members/)).toBeVisible();
  await expect(panel.getByText(/Not applied: this rule reads the advice/)).toBeVisible();
  // Questions, never verdicts.
  await expect(panel.getByText(/ties involving Finance stay within Finance/)).toBeVisible();
  await expect(panel.getByText(/How does work reach the rest of the organisation\?/)).toBeVisible();

  // The link applies the view: grouped by team, Finance highlighted.
  await panel.getByRole('button', { name: 'Show on the map: Silos' }).click();
  await expect(page.getByText('Shown on the map: Silos')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Grouped' })).toBeChecked();
  await expect(page.getByText('Highlighted members (8); others faded')).toBeVisible();
  await settled(page);

  await expectNoAxeViolations(page);
  await panel.getByRole('heading', { name: 'Potential brokers' }).scrollIntoViewIfNeeded();
  await shot(page, 'insights-panel');

  // The formal–informal gap between Product and Sales filters the map to those teams.
  await panel
    .getByRole('button', { name: 'Show on the map: Formal ties with no informal counterpart' })
    .click();
  await expect(nodes(page)).toHaveCount(16);
  await settled(page);
  await shot(page, 'insights-formal-gap-on-map');
  await panel.getByRole('button', { name: 'Clear highlight' }).click();
  await expect(page.getByText(/Highlighted members/)).toHaveCount(0);
});

test('saved views: name, caption, rename, reorder, restore, update and delete; kept in the project file', async ({
  page,
}) => {
  await start(page);
  await loadDemo(page);

  await saveView(page, 'Whole team');
  await page.getByRole('radio', { name: 'Grouped' }).check();
  await settled(page);
  await saveView(page, 'By team');
  await page.getByRole('radio', { name: 'Circular' }).check();
  await settled(page);
  await saveView(page, 'Circle');

  const list = right(page).getByRole('list', { name: 'Saved views, in presentation order' });
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await caption(page, 'Whole team', 'Everyone, drawn by how strongly they are connected.');

  // Rename, with an empty name refused.
  await right(page).getByRole('button', { name: 'Rename Circle' }).click();
  const field = right(page).getByRole('textbox', { name: 'Name', exact: true });
  await field.fill('');
  await expect(right(page).getByText('Enter a name for the view.')).toBeVisible();
  await field.fill('Teams in a circle');
  await right(page).getByRole('button', { name: 'Save name' }).click();
  await expect(list.getByText('Teams in a circle')).toBeVisible();

  // Reorder: move the circle to the top.
  await right(page).getByRole('button', { name: 'Move Teams in a circle up' }).click();
  await right(page).getByRole('button', { name: 'Move Teams in a circle up' }).click();
  await expect(list.getByRole('listitem').first()).toContainText('Teams in a circle');
  await expect(
    right(page).getByRole('button', { name: 'Move Teams in a circle up' }),
  ).toBeDisabled();

  // Restore puts the layout back.
  await right(page).getByRole('button', { name: 'Show By team on the map' }).click();
  await expect(page.getByRole('radio', { name: 'Grouped' })).toBeChecked();
  await settled(page);
  await expectNoAxeViolations(page);
  await right(page).evaluate((el) => {
    el.scrollTop = 0;
  });
  await shot(page, 'saved-views-manager');

  await saveView(page, 'Force');

  // Delete asks first.
  await right(page).getByRole('button', { name: 'Delete Force' }).click();
  await page
    .getByRole('dialog', { name: 'Delete this view?' })
    .getByRole('button', { name: 'Delete view' })
    .click();
  await expect(list.getByRole('listitem')).toHaveCount(3);

  // Saved in the .ona.json file, in order, with captions.
  await page.getByRole('button', { name: 'Project' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Save project' }).click();
  const file = await (await download).path();
  const saved = parseProject(readFileSync(file, 'utf8'));
  expect(saved.schema_version).toBe(3);
  expect(saved.saved_views.map((v) => v.name)).toEqual([
    'Teams in a circle',
    'Whole team',
    'By team',
  ]);
  expect(saved.saved_views[1]?.caption).toBe('Everyone, drawn by how strongly they are connected.');
  expect(Object.keys(saved.saved_views[0]?.positions ?? {})).toHaveLength(40);

  // …and reopened from it.
  await page.getByRole('button', { name: 'Project' }).click();
  await page.getByRole('menuitem', { name: 'Open project…' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Replace project' }).click();
  await (await chooser).setFiles(file);
  await rightTab(page, 'Views').click();
  await expect(list.getByRole('listitem')).toHaveCount(3);
});

test('presentation: steps through saved views with captions, keys and Escape, legible type', async ({
  page,
}) => {
  await start(page, 1920, 1080);
  await loadDemo(page);
  await rightTab(page, 'Insights').click();
  await right(page).getByRole('button', { name: 'Save as view: Potential brokers' }).click();
  await expect(page.getByText('View saved: Potential brokers')).toBeVisible();
  await right(page).getByRole('button', { name: 'Save as view: Silos' }).click();
  await expect(page.getByText('View saved: Silos')).toBeVisible();
  await right(page).getByRole('button', { name: 'Save as view: Negative clusters' }).click();
  await expect(page.getByText('View saved: Negative clusters')).toBeVisible();
  await rightTab(page, 'Views').click();
  await expect(right(page).getByRole('listitem')).toHaveCount(3);

  await drawnText(page);
  await page.getByRole('banner').getByRole('button', { name: 'Present' }).click();
  const region = page.getByRole('region', { name: 'Potential brokers' });
  await expect(region).toBeVisible();
  await expect(page.getByRole('banner')).toHaveCount(0);
  await expect(page.getByText('1 of 3')).toBeVisible();
  await expect(page.getByText(/lie on many of the shortest routes/)).toBeVisible();
  await settled(page);

  // Type sizes against the scale (design-system §3.3 and §5.3).
  const sizes = await page.evaluate(() => {
    const px = (sel: string) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).fontSize : 'missing';
    };
    return {
      title: px('.presentation__title'),
      caption: px('.presentation__caption'),
      counter: px('.presentation__counter'),
      legend: px('.presentation__legend .legend'),
      root: getComputedStyle(document.documentElement).getPropertyValue('--t-6-size').trim(),
    };
  });
  expect(sizes).toEqual({
    title: '42px',
    caption: '35px',
    counter: '17px',
    legend: '17px',
    root: '42px',
  });
  const labels = (await drawnText(page)).filter((t) => t.includes('Fira Sans Condensed'));
  expect(labels.length).toBeGreaterThan(0);
  for (const l of labels) expect(l).toMatch(/ 17px /);
  // The caption keeps to about 60 characters a line.
  const captionWidth = await page.evaluate(() => {
    const el = document.querySelector('.presentation__caption') as HTMLElement;
    const ch = document.createElement('span');
    ch.textContent = '0';
    el.append(ch);
    const w = ch.getBoundingClientRect().width;
    ch.remove();
    return el.getBoundingClientRect().width / w;
  });
  expect(captionWidth).toBeLessThanOrEqual(61);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(2300);
  await expect(page.locator('.presentation--idle')).toHaveCount(1);
  await shot(page, 'presentation-named');

  await page.keyboard.press('ArrowRight');
  await expect(page.getByText('2 of 3')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Silos' })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByText('3 of 3')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByText('3 of 3')).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByText('2 of 3')).toBeVisible();
  await page.keyboard.press('Home');
  await expect(page.getByText('1 of 3')).toBeVisible();
  await page.keyboard.press('End');
  await expect(page.getByText('3 of 3')).toBeVisible();

  // Anonymised, the same presentation shows codes.
  await page.keyboard.press('Home');
  await page.mouse.move(400, 400);
  await page.getByRole('switch', { name: 'Hide names' }).click();
  await page.mouse.move(5, 5);
  await page.waitForTimeout(2300);
  await settled(page);
  const html = await page.content();
  for (const name of DISPLAY_NAMES) expect(html).not.toContain(name);
  await expectNoAxeViolations(page);
  await shot(page, 'presentation-anonymised');

  await page.keyboard.press('Escape');
  await expect(page.getByRole('banner')).toBeVisible();
  await expect(page.locator('.presentation')).toHaveCount(0);
});

test('anonymisation: no display name in the DOM or on the canvas in any view', async ({ page }) => {
  await start(page);
  await loadDemo(page);
  await rightTab(page, 'Views').click();
  await saveView(page, 'Everyone');
  // A caption that names two people, to check captions are anonymised too.
  await caption(
    page,
    'Everyone',
    `${DISPLAY_NAMES[0] ?? ''} and ${DISPLAY_NAMES[1] ?? ''} link the teams.`,
  );
  await page.getByRole('banner').getByRole('switch', { name: 'Hide names' }).click();
  await expect(page.getByText(/Names hidden/)).toBeVisible();
  await drawnText(page);

  const failures: string[] = [];
  const check = async (where: string) => {
    await page.waitForTimeout(150);
    const text = await page.evaluate(() => {
      const values = [
        ...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
          'input, textarea, select',
        ),
      ].map((el) => el.value);
      const options = [...document.querySelectorAll('option')].map((o) => o.textContent);
      return [document.documentElement.outerHTML, ...values, ...options, document.title].join('\n');
    });
    const drawn = (await drawnText(page)).join('\n');
    for (const name of DISPLAY_NAMES) {
      if (text.includes(name)) failures.push(`${where}: DOM contains ${name}`);
      if (drawn.includes(name)) failures.push(`${where}: canvas draws ${name}`);
    }
  };

  // Map, with the member panel open (selected from the map by keyboard).
  await centreTab(page, 'Map').click();
  await settled(page);
  await nodes(page).first().focus();
  await page.keyboard.press('Enter');
  await expect(right(page).getByRole('article')).toBeVisible();
  await check('map and member panel');
  // Ties by layer in the member panel: open every layer.
  const closed = right(page).locator('.member__disclosure[aria-expanded="false"]');
  while ((await closed.count()) > 0) await closed.first().click();
  await check('member panel ties');
  // Map search: codes are searchable, names are not.
  await page.getByLabel('Search', { exact: true }).fill('FIN');
  await check('map search');
  await page.getByLabel('Search', { exact: true }).fill('');

  // Explore tools: ego view, path, subgroup, resilience.
  await rightTab(page, 'Explore').click();
  await check('explore');
  const selects = right(page).getByRole('combobox');
  for (const s of await selects.all()) {
    const options = await s.locator('option').allTextContents();
    if (options.length > 2) await s.selectOption({ index: 2 });
  }
  await check('explore selections');

  // Matrix: adjacency and rating entry.
  await centreTab(page, 'Matrix').click();
  await check('adjacency matrix');
  await page.getByRole('radio', { name: 'Enter ratings' }).check();
  await check('rating matrix');
  await page.getByRole('radio', { name: 'Tie strength' }).check();

  // Table, comparison views, insights, coverage, saved views.
  await centreTab(page, 'Table').click();
  await check('metrics table');
  await centreTab(page, 'Compare').click();
  await check('compare two layers');
  await page.getByRole('radio', { name: 'Formal and informal' }).check();
  await check('compare formal and informal');
  await centreTab(page, 'Map').click();
  for (const tab of ['Insights', 'Views', 'Coverage']) {
    await rightTab(page, tab).click();
    await check(tab);
  }
  // Every insight view.
  await rightTab(page, 'Insights').click();
  for (const b of await right(page)
    .getByRole('button', { name: /^Show on the map/ })
    .all()) {
    await b.click();
    await settled(page);
    await check(`insight ${(await b.getAttribute('aria-label')) ?? ''}`);
  }
  // Layouts, including the circle and hierarchy with their labels.
  for (const layout of ['Grouped', 'Circular', 'Formal hierarchy', 'Force-directed']) {
    await page.getByRole('radio', { name: layout }).check();
    await settled(page);
    await check(`layout ${layout}`);
  }
  // Presentation.
  await page.getByRole('banner').getByRole('button', { name: 'Present' }).click();
  await settled(page);
  await check('presentation');
  await page.keyboard.press('Escape');

  expect(failures).toEqual([]);

  // Turning names back on shows them again (the layer is live, not a copy).
  await page.getByRole('banner').getByRole('switch', { name: 'Hide names' }).click();
  await rightTab(page, 'Coverage').click();
  await expect(right(page).getByText(DISPLAY_NAMES[0] ?? '', { exact: true })).toBeVisible();
});
