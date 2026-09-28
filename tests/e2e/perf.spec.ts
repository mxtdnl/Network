import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serialiseProject } from '../../src/data/projectFile';
import { syntheticProject } from '../fixtures/synthetic';

// Phase 8 performance measurements (spec §8: 250 members, about 10,000 ties).
// Frame time is the interval between animation frames recorded in the page;
// worker time is from posting an `analyse` request to the worker's `analysis`
// response, recorded by wrapping the page's Worker; initial load uses the
// Navigation Timing and Paint Timing entries. The results are printed and
// written to test-results/perf.json, or to PERF_OUT when set.

const out = process.env.PERF_OUT ?? join('test-results', 'perf.json');

const nodes = (page: Page) =>
  page.getByRole('group', { name: 'Members on the map' }).getByRole('button');

/** Records the time of every analyse request and its answer. */
function instrumentWorker() {
  const w = window as unknown as {
    __analyses: { posted: number; answered?: number; stale?: boolean }[];
  };
  w.__analyses = [];
  const Native = window.Worker;
  class Timed extends Native {
    private readonly open = new Map<number, number>();
    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options);
      this.addEventListener('message', (e: MessageEvent) => {
        const m = e.data as { id: number; kind: string };
        const i = this.open.get(m.id);
        if (i === undefined) return;
        const entry = w.__analyses[i];
        if (!entry) return;
        if (m.kind === 'analysis') entry.answered = performance.now();
        if (m.kind === 'cancelled' || m.kind === 'error') entry.stale = true;
        if (m.kind !== 'progress') this.open.delete(m.id);
      });
    }
    override postMessage(message: unknown, transfer?: Transferable[] | StructuredSerializeOptions) {
      const m = message as { id: number; kind: string };
      if (m.kind === 'analyse') {
        this.open.set(m.id, w.__analyses.length);
        w.__analyses.push({ posted: performance.now() });
      }
      super.postMessage(message, transfer as Transferable[]);
    }
  }
  window.Worker = Timed;
}

async function analysisTimes(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    (
      window as unknown as {
        __analyses: { posted: number; answered?: number }[];
      }
    ).__analyses
      .filter((a) => a.answered !== undefined)
      .map((a) => (a.answered as number) - a.posted),
  );
}

async function startRecording(page: Page) {
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
}

async function stopRecording(page: Page) {
  const frames = await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __recording: boolean };
    w.__recording = false;
    return w.__frames.slice(1);
  });
  const sorted = [...frames].sort((a, b) => a - b);
  const q = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? NaN;
  return {
    frames: frames.length,
    meanMs: round(frames.reduce((s, x) => s + x, 0) / frames.length),
    medianMs: round(q(0.5)),
    p95Ms: round(q(0.95)),
    maxMs: round(sorted[sorted.length - 1] ?? NaN),
    over50Ms: frames.filter((f) => f > 50).length,
  };
}

const round = (x: number) => Math.round(x * 10) / 10;

async function settled(page: Page) {
  await page.waitForFunction(
    () =>
      document.querySelector('canvas.map__canvas')?.getAttribute('data-transition') !== 'running',
    undefined,
    { timeout: 60_000 },
  );
  await page.waitForTimeout(800);
}

test('performance at 250 members and about 10,000 ties', async ({ page }, info) => {
  test.setTimeout(300_000);
  await page.addInitScript(instrumentWorker);
  await page.setViewportSize({ width: 1440, height: 900 });

  // Initial load: an empty workspace, then the demo.
  const t0 = Date.now();
  await page.goto('./');
  await page.getByRole('button', { name: 'Continue' }).waitFor();
  const shellMs = Date.now() - t0;
  const navigation = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    return {
      domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd),
      loadMs: Math.round(nav.loadEventEnd),
      scriptBytes: resources
        .filter((r) => r.initiatorType === 'script' || r.name.endsWith('.js'))
        .reduce((s, r) => s + r.encodedBodySize, 0),
      scripts: resources.filter((r) => r.name.endsWith('.js')).map((r) => r.name.split('/').pop()),
    };
  });
  await page.getByRole('button', { name: 'Continue' }).click();
  const td = Date.now();
  await page.getByRole('button', { name: 'Load demo' }).first().click();
  await expect(nodes(page)).toHaveCount(40);
  const demoToMapMs = Date.now() - td;

  // The synthetic project: open to map drawn.
  const project = syntheticProject();
  const edges = project.ties.filter((t) => t.variable === 'connection_strength').length;
  await page.getByRole('button', { name: 'Project' }).click();
  await page.getByRole('menuitem', { name: 'Open project…' }).click();
  // A project is open, so the replacement is confirmed first.
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('dialog').getByRole('button').last().click();
  const ts = Date.now();
  await (
    await chooser
  ).setFiles({
    name: 'synthetic.ona.json',
    mimeType: 'application/json',
    buffer: Buffer.from(serialiseProject(project)),
  });
  await expect(nodes(page)).toHaveCount(250, { timeout: 120_000 });
  const syntheticToMapMs = Date.now() - ts;
  await page.getByLabel('Ties from').selectOption({ label: 'Connection strength' });
  await settled(page);
  const firstAnalyses = await analysisTimes(page);

  const canvas = page.locator('canvas.map__canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('No canvas');

  // Pan: a 60-step drag starting on empty ground.
  const cx = box.x + box.width - 80;
  const cy = box.y + 60;
  await startRecording(page);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 0; i < 60; i++) await page.mouse.move(cx - i * 6, cy + i * 4);
  await page.mouse.up();
  const pan = await stopRecording(page);
  await settled(page);

  // Zoom: 40 wheel steps in, then out.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await startRecording(page);
  for (let i = 0; i < 40; i++) await page.mouse.wheel(0, i < 20 ? -60 : 60);
  const zoom = await stopRecording(page);
  await settled(page);

  // Weight changes: the composite drives the map; 12 slider steps, then the
  // re-analysis and the layout transition that follow, until the map is still.
  await page.getByLabel('Ties from').selectOption({ index: 0 });
  await settled(page);
  const before = (await analysisTimes(page)).length;
  const slider = page.getByRole('slider', { name: 'Informal collaboration' });
  await slider.focus();
  await startRecording(page);
  const tw = Date.now();
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(
    (n) =>
      (window as unknown as { __analyses: { answered?: number }[] }).__analyses.filter(
        (a) => a.answered !== undefined,
      ).length > n,
    before,
    { timeout: 60_000 },
  );
  await settled(page);
  const weights = { ...(await stopRecording(page)), wallMs: Date.now() - tw };
  const weightAnalyses = (await analysisTimes(page)).slice(before);

  const report = {
    measuredOn: 'headless Chromium, software rendering, 1440 × 900, DPR 1',
    members: 250,
    ties: edges,
    initialLoad: { shellVisibleMs: shellMs, ...navigation, demoToMapMs, syntheticToMapMs },
    worker: {
      fullAnalysisMs: firstAnalyses.map(Math.round),
      weightsOnlyAnalysisMs: weightAnalyses.map(Math.round),
    },
    frames: { pan, zoom, weights },
  };
  console.log(`Phase 8 performance: ${JSON.stringify(report, null, 2)}`);
  mkdirSync(join(out, '..'), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  await info.attach('perf', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });

  expect(pan.medianMs).toBeLessThan(50);
  expect(zoom.medianMs).toBeLessThan(50);
  expect(weights.medianMs).toBeLessThan(50);
});
