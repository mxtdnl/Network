import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serialiseProject } from '../../src/data/projectFile';
import { syntheticProject } from '../fixtures/synthetic';
import { seededMembersCsv, seededTiesCsv } from '../fixtures/validation/seeded-errors';

// Phase 8 design and accessibility audit (docs/design-audit.md). Every view
// and state of the analyst workspace is drawn at each desktop width and at
// tablet widths, screenshotted, and scanned with axe-core. Screenshots go to
// SCREENSHOT_DIR (docs/screenshots/phase-8) or test-results/screenshots; the
// axe results are written to AUDIT_OUT or test-results/axe-<width>.json.
//
//   SCREENSHOT_DIR=docs/screenshots/phase-8 npx playwright test tests/e2e/audit.spec.ts

const screenshotDir = process.env.SCREENSHOT_DIR ?? join('test-results', 'screenshots');
const auditDir = process.env.AUDIT_OUT ?? 'test-results';

const SIZES = [
  { name: '1280', width: 1280, height: 800 },
  { name: '1440', width: 1440, height: 900 },
  { name: '1920', width: 1920, height: 1080 },
  { name: '2560', width: 2560, height: 1440 },
  { name: 'tablet-landscape-1024', width: 1024, height: 768 },
  { name: 'tablet-portrait-768', width: 768, height: 1024 },
] as const;

interface Finding {
  state: string;
  id: string;
  impact: string | null | undefined;
  help: string;
  targets: string[];
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
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let n = 0;
        const step = () => {
          n += 1;
          if (n > 10) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
  );
  await page.waitForTimeout(400);
}

/** Loads a project file through Project → Open project…, confirming when one is open. */
async function openFile(page: Page, name: string, text: string, confirm: boolean) {
  await page.getByRole('banner').getByRole('button', { name: 'Project' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Open project…' }).click();
  if (confirm)
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Open project', exact: true })
      .click();
  await (await chooser).setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) });
}

test.use({ actionTimeout: 20_000 });

for (const size of SIZES) {
  test(`audit at ${size.name}`, async ({ page }) => {
    test.setTimeout(600_000);
    mkdirSync(screenshotDir, { recursive: true });
    mkdirSync(auditDir, { recursive: true });
    await page.setViewportSize({ width: size.width, height: size.height });
    const findings: Finding[] = [];
    const states: string[] = [];

    const capture = async (state: string) => {
      states.push(state);
      await page.evaluate(() => document.fonts.ready);
      // JPEG keeps some 200 screenshots to a size a repository can carry; the
      // colour-vision simulations stay PNG, where exact colour matters.
      await page.screenshot({
        path: join(screenshotDir, `${size.name}-${state}.jpg`),
        type: 'jpeg',
        quality: 85,
      });
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      for (const v of results.violations)
        findings.push({
          state,
          id: v.id,
          impact: v.impact,
          help: v.help,
          targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
        });
    };

    await page.goto('./');
    await expect(page.getByRole('dialog')).toBeVisible();
    await capture('01-first-run-notice');
    await page.getByRole('button', { name: 'Continue' }).click();
    await capture('02-empty');

    await page.getByRole('banner').getByRole('button', { name: 'Project' }).click();
    await capture('03-project-menu');
    await page.keyboard.press('Escape');

    await centreTab(page, 'Survey').click();
    await expect(
      page.getByRole('heading', { name: 'Add the people you will survey' }),
    ).toBeVisible();
    await capture('04-survey-no-members');
    await centreTab(page, 'Map').click();

    // Import with deliberately seeded errors: the validation report.
    await page.getByRole('button', { name: 'Import survey data' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Import survey data' });
    await capture('05-import-dialog');
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
    await expect(dialog.getByRole('heading', { name: 'Validation report' })).toBeVisible();
    await capture('06-import-errors');
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    // A project file that cannot be opened: the error in the status line.
    await openFile(page, 'broken.ona.json', '{"schema_version": 3, "members": [', false);
    await expect(page.getByRole('status').filter({ hasText: 'was not opened' })).toBeVisible();
    await capture('07-open-error');

    // The 250-member synthetic project: loading, then low coverage.
    await openFile(page, 'synthetic.ona.json', serialiseProject(syntheticProject()), false);
    await expect(page.getByText('Calculating the network…').first()).toBeVisible({
      timeout: 60_000,
    });
    await capture('08-loading');
    await expect(nodes(page)).toHaveCount(250, { timeout: 120_000 });
    await settled(page);
    await capture('09-low-coverage-250');

    // The demo.
    await page.getByRole('banner').getByRole('button', { name: 'Project' }).click();
    await page.getByRole('menuitem', { name: 'Load demo' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Load demo' }).click();
    await expect(nodes(page)).toHaveCount(40, { timeout: 60_000 });
    await settled(page);
    await capture('10-map');

    await nodes(page)
      .filter({ hasText: /^Lior Theodolite/ })
      .focus();
    await page.keyboard.press('Enter');
    await expect(right(page).getByRole('heading', { name: 'Lior Theodolite' })).toBeVisible();
    await settled(page);
    await capture('11-member-panel');

    await rightTab(page, 'Explore').click();
    await capture('12-explore');
    await rightTab(page, 'Insights').click();
    await capture('13-insights');
    await right(page)
      .getByRole('button', { name: /^Show on the map/ })
      .first()
      .click();
    await settled(page);
    await capture('14-insight-on-map');
    await page.getByRole('button', { name: 'Clear highlight' }).first().click();

    await rightTab(page, 'Views').click();
    await capture('15-views-empty');
    await page.getByLabel('Name of the new view').fill('Informal network overview');
    await page.getByRole('button', { name: 'Save view' }).click();
    await page.getByLabel('Name of the new view').fill('Formal structure');
    await page.getByRole('button', { name: 'Save view' }).click();
    await capture('16-views');
    await rightTab(page, 'Coverage').click();
    await capture('17-coverage');

    for (const layout of ['Grouped', 'Circular', 'Formal hierarchy'] as const) {
      await page.getByRole('radio', { name: layout }).check();
      await settled(page);
      await capture(`18-layout-${layout.toLowerCase().replace(' ', '-')}`);
    }
    await page.getByRole('radio', { name: 'Force-directed' }).check();
    await settled(page);

    await centreTab(page, 'Matrix').click();
    await capture('19-matrix');
    await page.getByRole('radio', { name: 'Enter ratings' }).check();
    await capture('20-matrix-entry');
    await page.getByRole('radio', { name: 'Tie strength' }).check();
    await centreTab(page, 'Table').click();
    await capture('21-table');
    await centreTab(page, 'Compare').click();
    await page.waitForTimeout(300);
    await capture('22-compare-layers');
    await page.getByRole('radio', { name: 'Formal and informal' }).check();
    await page.waitForTimeout(300);
    await capture('23-compare-formal-informal');
    await centreTab(page, 'Survey').click();
    await expect(page.getByRole('heading', { name: 'Run a survey' })).toBeVisible();
    await capture('24-survey');
    await centreTab(page, 'Map').click();
    await settled(page);

    await page.getByRole('banner').getByRole('button', { name: 'Export' }).click();
    await capture('25-export-dialog');
    await page.keyboard.press('Escape');

    // Names hidden everywhere.
    await page.getByRole('banner').getByRole('switch', { name: 'Hide names' }).click();
    await rightTab(page, 'Member').click();
    await settled(page);
    await capture('26-anonymised-map');
    await centreTab(page, 'Table').click();
    await capture('27-anonymised-table');
    await centreTab(page, 'Map').click();
    await page.getByRole('banner').getByRole('switch', { name: 'Hide names' }).click();

    // Presentation mode, then its controls bar.
    await page.getByRole('banner').getByRole('button', { name: 'Present' }).click();
    await expect(page.locator('.presentation')).toBeVisible();
    await settled(page);
    await page.mouse.move(size.width - 5, size.height - 5);
    await page.waitForTimeout(2600);
    await capture('28-presentation');
    await page.mouse.move(size.width / 2, size.height / 2);
    await page.mouse.move(size.width / 2 + 10, size.height / 2 + 10);
    await capture('29-presentation-controls');
    await page.keyboard.press('ArrowRight');
    await settled(page);
    // By keyboard: the controls bar hides under a resting pointer.
    await page
      .getByRole('group', { name: 'Presentation controls' })
      .getByRole('switch', { name: 'Hide names' })
      .focus();
    await page.keyboard.press('Space');
    await settled(page);
    await capture('30-presentation-anonymised');
    await page.keyboard.press('Escape');

    await page.getByRole('banner').getByRole('button', { name: 'Help' }).click();
    await page.getByRole('menuitem', { name: 'Data and consent notice' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await capture('31-notice-reopened');

    const serious = findings.filter((f) => f.impact === 'serious' || f.impact === 'critical');
    writeFileSync(
      join(auditDir, `axe-${size.name}.json`),
      JSON.stringify({ size, states, findings }, null, 2) + '\n',
    );
    console.log(
      `axe at ${size.name}: ${String(states.length)} states, ${String(findings.length)} violations, ${String(serious.length)} serious or critical`,
    );
    expect(serious).toEqual([]);
  });
}

test('phone: the workspace is read-only and usable at 390 px', async ({ page }) => {
  test.setTimeout(300_000);
  mkdirSync(screenshotDir, { recursive: true });
  mkdirSync(auditDir, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const findings: Finding[] = [];
  const states: string[] = [];
  const overflow: string[] = [];
  const capture = async (state: string) => {
    states.push(state);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: join(screenshotDir, `phone-390-${state}.jpg`),
      type: 'jpeg',
      quality: 85,
      fullPage: true,
    });
    // No horizontal scrolling of the page (spec §12).
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    if (wide) overflow.push(state);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    for (const v of results.violations)
      findings.push({
        state,
        id: v.id,
        impact: v.impact,
        help: v.help,
        targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
      });
  };

  await page.goto('./');
  await capture('01-first-run-notice');
  await page.getByRole('button', { name: 'Continue' }).click();
  await capture('02-empty');
  // Read-only: nothing that builds or changes a project is offered.
  await expect(page.getByRole('button', { name: 'Import survey data' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Run a survey' })).toHaveCount(0);
  await expect(centreTab(page, 'Survey')).toHaveCount(0);
  await page.getByRole('banner').getByRole('button', { name: 'Project' }).click();
  await expect(page.getByRole('menuitem', { name: 'Import survey data…' })).toHaveCount(0);
  await capture('03-project-menu');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Load demo' }).click();
  await expect(nodes(page)).toHaveCount(40, { timeout: 60_000 });
  await settled(page);
  await capture('04-map');
  await expect(page.getByRole('heading', { name: 'Layers' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Edit / })).toHaveCount(0);

  await page.getByText('Weights and map settings').click();
  await capture('05-settings-open');
  await page.getByText('Weights and map settings').click();

  // The map can be read and explored: a member's panel opens by touch-free keyboard route too.
  await nodes(page)
    .filter({ hasText: /^Lior Theodolite/ })
    .focus();
  await page.keyboard.press('Enter');
  await expect(right(page).getByRole('heading', { name: 'Lior Theodolite' })).toBeVisible();
  await capture('06-member-panel');

  await centreTab(page, 'Matrix').click();
  await expect(page.getByRole('radio', { name: 'Enter ratings' })).toHaveCount(0);
  await capture('07-matrix');
  await centreTab(page, 'Table').click();
  await capture('08-table');
  await centreTab(page, 'Compare').click();
  await capture('09-compare');
  await centreTab(page, 'Map').click();

  await rightTab(page, 'Insights').click();
  await expect(right(page).getByRole('button', { name: /^Save as view/ })).toHaveCount(0);
  await capture('10-insights');
  await rightTab(page, 'Views').click();
  await expect(page.getByRole('button', { name: 'Save view' })).toHaveCount(0);
  await capture('11-views');
  await rightTab(page, 'Coverage').click();
  await expect(page.getByLabel('Warn below')).toHaveAttribute('readonly', '');
  await capture('12-coverage');

  const serious = findings.filter((f) => f.impact === 'serious' || f.impact === 'critical');
  writeFileSync(
    join(auditDir, 'axe-phone-390.json'),
    JSON.stringify(
      { size: { name: 'phone-390', width: 390, height: 844 }, states, findings, overflow },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `axe at phone-390: ${String(states.length)} states, ${String(findings.length)} violations, ${String(serious.length)} serious or critical; horizontal overflow in ${overflow.join(', ') || 'none'}`,
  );
  expect(serious).toEqual([]);
  expect(overflow).toEqual([]);
});

/**
 * Redraws a screenshot as seen with a colour-vision deficiency: Machado,
 * Oliveira & Fernandes (2009) matrices at severity 1.0, applied to linear sRGB
 * (the model design-system.md used). A simulation, not a test with people.
 */
async function simulated(page: Page, png: Buffer, matrix: number[][]): Promise<Buffer> {
  const sim = await page.context().newPage();
  await sim.setContent('<canvas id="c"></canvas>');
  const out = await sim.evaluate(
    async ({ b64, m }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.getElementById('c') as HTMLCanvasElement;
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d');
      if (!ctx) return '';
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height);
      const lin = Array.from({ length: 256 }, (_, i) => {
        const s = i / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      const enc = (l: number) => {
        const v = Math.min(1, Math.max(0, l));
        return Math.round((v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055) * 255);
      };
      const d = data.data;
      for (let i = 0; i < d.length; i += 4) {
        const r = lin[d[i] ?? 0] ?? 0;
        const g = lin[d[i + 1] ?? 0] ?? 0;
        const b = lin[d[i + 2] ?? 0] ?? 0;
        for (let k = 0; k < 3; k++) {
          const row = m[k] ?? [0, 0, 0];
          d[i + k] = enc((row[0] ?? 0) * r + (row[1] ?? 0) * g + (row[2] ?? 0) * b);
        }
      }
      ctx.putImageData(data, 0, 0);
      return c.toDataURL('image/png').split(',')[1] ?? '';
    },
    { b64: png.toString('base64'), m: matrix },
  );
  await sim.close();
  return Buffer.from(out, 'base64');
}

const MACHADO: Record<string, number[][]> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

test('colour-vision simulations of the map', async ({ page }) => {
  test.setTimeout(300_000);
  mkdirSync(screenshotDir, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Load demo' }).click();
  await expect(nodes(page)).toHaveCount(40, { timeout: 60_000 });
  await settled(page);
  const scenes: [string, () => Promise<void>][] = [
    ['map', () => Promise.resolve()],
    [
      'map-relationship-health',
      async () => {
        await page.getByLabel('Preset').selectOption({ label: 'Relationship health' });
        await page.getByRole('radio', { name: 'Circular' }).check();
      },
    ],
  ];
  for (const [name, setUp] of scenes) {
    await setUp();
    await settled(page);
    const png = await page.getByRole('tabpanel', { name: 'Map' }).screenshot();
    writeFileSync(join(screenshotDir, `cvd-${name}-normal.png`), png);
    for (const [condition, matrix] of Object.entries(MACHADO)) {
      writeFileSync(
        join(screenshotDir, `cvd-${name}-${condition}.png`),
        await simulated(page, png, matrix),
      );
    }
  }
});

test('keyboard: every tab stop shows a visible focus indicator', async ({ page }) => {
  test.setTimeout(300_000);
  mkdirSync(auditDir, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Load demo' }).click();
  await expect(nodes(page)).toHaveCount(40, { timeout: 60_000 });
  await settled(page);
  await nodes(page)
    .filter({ hasText: /^Lior Theodolite/ })
    .focus();
  await page.keyboard.press('Enter');
  await page.locator('body').focus();
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });

  const stops: { name: string; visible: boolean; how: string }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < 400; i++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const name =
        `${el.tagName.toLowerCase()}${el.hasAttribute('role') ? `[${el.getAttribute('role') ?? ''}]` : ''} ` +
        (el.getAttribute('aria-label') ?? el.textContent).trim().slice(0, 40);
      const own = getComputedStyle(el);
      const ring = (s: CSSStyleDeclaration) =>
        s.outlineStyle !== 'none' && Number.parseFloat(s.outlineWidth) > 0;
      // Members on the map are visually hidden buttons; their focus is drawn on the canvas.
      if (el.classList.contains('map__node')) return { name, visible: true, how: 'canvas ring' };
      if (ring(own)) return { name, visible: true, how: 'outline' };
      // Visually hidden inputs (segmented controls) show focus on their label.
      const label = el.nextElementSibling;
      if (label && ring(getComputedStyle(label)))
        return { name, visible: true, how: 'outline on label' };
      // The rating grid's editor shows the active cell's ring.
      if (el.classList.contains('matrix__editor')) return { name, visible: true, how: 'cell ring' };
      return { name, visible: false, how: `${own.outlineStyle} ${own.outlineWidth}` };
    });
    if (!stop) continue;
    const key = stop.name;
    if (seen.has(key) && stops.length > 20 && stops[0]?.name === key) break;
    seen.add(key);
    stops.push(stop);
  }
  const hidden = stops.filter((s) => !s.visible);
  writeFileSync(join(auditDir, 'focus-stops.json'), JSON.stringify(stops, null, 2) + '\n');
  console.log(
    `keyboard: ${String(stops.length)} tab stops, ${String(hidden.length)} without a visible indicator`,
  );
  expect(stops.length).toBeGreaterThan(50);
  expect(hidden).toEqual([]);
});

test('reduced motion: no transition or animation runs', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Load demo' }).click();
  await expect(nodes(page)).toHaveCount(40, { timeout: 60_000 });
  const moving = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const s = getComputedStyle(el);
      const longest = (v: string) =>
        Math.max(
          ...v.split(',').map((d) => Number.parseFloat(d) * (d.trim().endsWith('ms') ? 1 : 1000)),
        );
      if (longest(s.transitionDuration) > 0 || longest(s.animationDuration) > 0)
        out.push(`${el.tagName.toLowerCase()}.${String(el.getAttribute('class'))}`);
    }
    return out;
  });
  expect(moving).toEqual([]);
  // A change of layout moves members at once (the canvas never reports a running transition).
  await page.evaluate(() => {
    const c = document.querySelector('canvas.map__canvas');
    const w = window as unknown as { __moved: boolean };
    w.__moved = false;
    new MutationObserver(() => {
      if (c?.getAttribute('data-transition') === 'running') w.__moved = true;
    }).observe(c as Element, { attributes: true });
  });
  await page.getByRole('radio', { name: 'Circular' }).check();
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => (window as unknown as { __moved: boolean }).__moved)).toBe(
    false,
  );
});

test('keyboard walkthrough: every analyst flow by keyboard alone', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  const key = (k: string) => page.keyboard.press(k);
  const focused = () =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return (el?.getAttribute('aria-label') ?? el?.textContent ?? '').trim();
    });

  // First-run notice: focus starts on Continue.
  await expect(page.getByRole('button', { name: 'Continue' })).toBeFocused();
  await key('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Project menu: open with Enter, move with arrows, choose with Enter.
  await page.getByRole('banner').getByRole('button', { name: 'Project' }).focus();
  await key('Enter');
  await expect(page.getByRole('menuitem', { name: 'Open project…' })).toBeFocused();
  await key('Escape');
  await expect(page.getByRole('banner').getByRole('button', { name: 'Project' })).toBeFocused();
  await key('ArrowDown');
  for (let i = 0; i < 3; i++) await key('ArrowDown');
  expect(await focused()).toBe('Load demo');
  await key('Enter');
  await expect(nodes(page)).toHaveCount(40, { timeout: 60_000 });
  await settled(page);

  // Tabs move with the arrow keys.
  await centreTab(page, 'Map').focus();
  await key('ArrowRight');
  await expect(centreTab(page, 'Matrix')).toBeFocused();
  await expect(centreTab(page, 'Matrix')).toHaveAttribute('aria-selected', 'true');
  await key('ArrowLeft');

  // Map: a member by focus, neighbours by arrow keys, the panel by Enter, back by Escape.
  const first = nodes(page).filter({ hasText: /^Lior Theodolite/ });
  await first.focus();
  await key('ArrowRight');
  expect(await focused()).not.toContain('Lior Theodolite');
  await key('Enter');
  await expect(right(page).getByRole('heading', { level: 2 }).first()).toBeVisible();
  await key('Escape');
  await key('+');
  await key('0');

  // Adjacency matrix: arrow keys move, Enter selects the row's member.
  await centreTab(page, 'Matrix').click();
  const grid = page.getByRole('grid');
  await grid.focus();
  await key('ArrowDown');
  await key('ArrowRight');
  await key('Enter');
  await expect(rightTab(page, 'Member')).toHaveAttribute('aria-selected', 'true');

  // Metrics table: sort by a column header button.
  await centreTab(page, 'Table').click();
  await page.getByRole('button', { name: 'Sort by Given strength' }).focus();
  await key('Enter');

  // Saved views: name and save, then present and step, then leave.
  await centreTab(page, 'Map').click();
  await rightTab(page, 'Views').click();
  await page.getByLabel('Name of the new view').focus();
  await page.keyboard.type('Keyboard view');
  await key('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'View saved' })).toBeVisible();
  await page.getByRole('banner').getByRole('button', { name: 'Present' }).focus();
  await key('Enter');
  await expect(page.locator('.presentation')).toBeVisible();
  await key('ArrowRight');
  await key('Escape');
  await expect(page.locator('.presentation')).toHaveCount(0);

  // Dialogs: Export and Import open by Enter and close by Escape, returning focus.
  const exportButton = page.getByRole('banner').getByRole('button', { name: 'Export' });
  await exportButton.focus();
  await key('Enter');
  await expect(page.getByRole('dialog', { name: 'Export' })).toBeVisible();
  await key('Escape');
  await expect(exportButton).toBeFocused();

  // Explore: ego view chosen from a select and started by keyboard.
  await rightTab(page, 'Explore').click();
  await right(page)
    .getByRole('combobox', { name: 'Member' })
    .first()
    .selectOption({ label: 'Lior Theodolite' });
  await right(page).getByRole('button', { name: 'Show ego view' }).focus();
  await key('Enter');
  await expect(page.getByRole('button', { name: 'Show everyone' }).first()).toBeVisible();

  // Help menu reopens the notice.
  await page.getByRole('banner').getByRole('button', { name: 'Help' }).focus();
  await key('Enter');
  await key('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await key('Escape');
});
