import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Download, type Page } from '@playwright/test';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { parseProject } from '../../src/data/projectFile';

// Phase 7: exports from the built site, served by `vite preview` under the
// GitHub Pages base path with the Content Security Policy in force (D23).
// Every download must arrive, be the right kind of file, and trigger no CSP
// violation or console error. With SAMPLES_DIR set, the anonymised exports of
// the demo are copied there (SAMPLES_DIR=docs/samples).
const samplesDir = process.env.SAMPLES_DIR ?? null;
const screenshotDir = process.env.SCREENSHOT_DIR ?? join('test-results', 'screenshots');

const demo = parseProject(
  readFileSync(join(import.meta.dirname, '..', '..', 'src', 'demo', 'demo.ona.json'), 'utf8'),
);
const NAMES = demo.members.map((m) => m.display_name);

async function start(page: Page) {
  const problems: string[] = [];
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
  expect(new URL(page.url()).pathname).toBe('/network/');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Load demo' }).first().click();
  await expect(
    page.getByRole('group', { name: 'Members on the map' }).getByRole('button'),
  ).toHaveCount(40);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);
  return problems;
}

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Export' });

async function openExport(page: Page) {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(dialog(page)).toBeVisible();
}

async function download(
  page: Page,
  button: string,
  sample = false,
): Promise<{ file: Download; bytes: Buffer }> {
  const pending = page.waitForEvent('download');
  await dialog(page).getByRole('button', { name: button, exact: true }).click();
  const file = await pending;
  // Downloads are blob: URLs created by the page itself, never a network fetch.
  expect(file.url()).toMatch(/^blob:http:\/\/localhost:4173\//);
  const bytes = readFileSync(await file.path());
  expect(bytes.length).toBeGreaterThan(0);
  // Only the anonymised exports are kept as samples.
  if (samplesDir && sample)
    copyFileSync(await file.path(), join(samplesDir, file.suggestedFilename()));
  return { file, bytes };
}

async function pdfText(bytes: Buffer): Promise<string> {
  const doc = await getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }).promise;
  let text = JSON.stringify((await doc.getMetadata()).info);
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    text += content.items.map((x) => ('str' in x ? x.str : '')).join(' ');
  }
  return text;
}

const noNames = (text: string) => NAMES.filter((n) => text.includes(n));
const noSigned = (text: string) => ['Valence', 'valence'].filter((w) => text.includes(w));

test('every export downloads from the built site within the CSP, with names hidden', async ({
  page,
}) => {
  if (samplesDir) mkdirSync(samplesDir, { recursive: true });
  mkdirSync(screenshotDir, { recursive: true });
  const problems = await start(page);
  await page.getByRole('switch', { name: 'Hide names' }).first().click();
  await openExport(page);
  await page.screenshot({ path: join(screenshotDir, 'export-dialog.png') });
  const axe = await new AxeBuilder({ page })
    .include('dialog')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);

  // Map: PNG at each resolution, then SVG.
  const d = dialog(page);
  await d.getByLabel('Caption (optional)').fill(`Drawn for ${NAMES[0] ?? ''}.`);
  const sizes: number[] = [];
  for (const resolution of ['Screen (1×)', 'High (2×)', 'Print (300 dpi)']) {
    await d.getByLabel(resolution).check();
    const { file, bytes } = await download(page, 'Export map', true);
    expect(file.suggestedFilename()).toBe('graticule-map-directed-codes.png');
    expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
    sizes.push(bytes.readUInt32BE(16));
    await expect(page.getByText('Map exported as graticule-map-directed-codes.png.')).toBeVisible();
  }
  expect(sizes[1]).toBe((sizes[0] ?? 0) * 2);
  expect(sizes[2]).toBe(Math.round((277 / 25.4) * 300));

  await d.getByLabel('SVG drawing').check();
  const svg = await download(page, 'Export map', true);
  expect(svg.file.suggestedFilename()).toBe('graticule-map-directed-codes.svg');
  const svgText = svg.bytes.toString('utf8');
  expect(svgText.startsWith('<?xml')).toBe(true);
  expect(svgText).toContain('FIN-L4-01');
  expect(noNames(svgText)).toEqual([]);

  for (const [button, name] of [
    ['Export member metrics', 'graticule-member-metrics-directed-codes.csv'],
    ['Export network metrics', 'graticule-network-metrics-directed-codes.csv'],
    ['Export formal and informal ties', 'graticule-formal-informal-directed-codes.csv'],
  ] as const) {
    const csv = await download(page, button, true);
    expect(csv.file.suggestedFilename()).toBe(name);
    // UTF-8 with a byte-order mark.
    expect([...csv.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(noNames(csv.bytes.toString('utf8'))).toEqual([]);
  }

  const pdf = await download(page, 'Export report', true);
  expect(pdf.file.suggestedFilename()).toMatch(/^graticule-report-\d{4}-\d{2}-\d{2}-codes\.pdf$/);
  expect(pdf.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  const text = await pdfText(pdf.bytes);
  expect(noNames(text)).toEqual([]);
  expect(text).toContain('Drawn for FIN-L4-01.');

  expect(problems).toEqual([]);
});

test('with signed layers left out, the exports and the table export hold no valence', async ({
  page,
}) => {
  const problems = await start(page);
  await openExport(page);
  const d = dialog(page);
  await d.getByRole('switch', { name: 'Leave out valence, energy and conflict' }).click();
  await d.getByLabel('SVG drawing').check();
  const svg = await download(page, 'Export map');
  expect(svg.file.suggestedFilename()).toBe('graticule-map-directed-no-signed.svg');
  expect(noSigned(svg.bytes.toString('utf8').replace(/<style>[\s\S]*?<\/style>/, ''))).toEqual([]);
  // Names are shown here, so the check above is not passing for want of text.
  expect(svg.bytes.toString('utf8')).toContain(NAMES[0] ?? '');
  for (const button of ['Export member metrics', 'Export network metrics']) {
    const csv = await download(page, button);
    expect(noSigned(csv.bytes.toString('utf8'))).toEqual([]);
  }
  const pdf = await download(page, 'Export report');
  expect(noSigned(await pdfText(pdf.bytes))).toEqual([]);
  await d.getByRole('button', { name: 'Close' }).click();

  // The metrics table's own export follows the same setting (Q28).
  await page.getByRole('main').getByRole('tab', { name: 'Table', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export table' }).click();
  const table = await pending;
  expect(table.suggestedFilename()).toBe('graticule-metrics-composite-directed-no-signed.csv');
  await expect(
    page.getByText('Table exported as graticule-metrics-composite-directed-no-signed.csv.'),
  ).toBeVisible();

  // The setting is saved with the project.
  const save = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Project' }).click();
  await page.getByRole('menuitem', { name: 'Save project' }).click();
  const saved = JSON.parse(readFileSync(await (await save).path(), 'utf8')) as {
    settings: { exclude_signed_from_exports: boolean };
  };
  expect(saved.settings.exclude_signed_from_exports).toBe(true);
  expect(problems).toEqual([]);
});
