// Phase 8 changes that do not need a browser: large layouts settled in a
// worker give exactly the positions the main thread gives (D111), cached
// number formatters format as before, and every action keeps its name
// across its button, confirmation and status line (docs/design-audit.md).

import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/engine/rng';
import { exportCopy } from '../../src/ui/copy/export';
import { projectCopy } from '../../src/ui/copy/data';
import { exploreCopy } from '../../src/ui/copy/explore';
import { importCopy } from '../../src/ui/copy/import';
import { formatScale, formatValue, mapCopy } from '../../src/ui/copy/map';
import { shellCopy } from '../../src/ui/copy/shell';
import { ForceLayout, settleJob, type LayoutSpec } from '../../src/ui/map/layout';

function randomWeights(n: number, p: number, seed: number): Float64Array {
  const rng = mulberry32(seed);
  const w = new Float64Array(n * n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) if (i !== j && rng() < p) w[i * n + j] = rng();
  return w;
}

describe('layouts settled in a worker', () => {
  const n = 120;
  const radii = Array.from({ length: n }, (_, i) => 4 + (i % 5));
  const cases: [string, LayoutSpec][] = [
    ['force', { kind: 'force' }],
    [
      'grouped',
      {
        kind: 'grouped',
        group: Array.from({ length: n }, (_, i) => i % 4),
        groups: ['A', 'B', 'C', 'D'],
        names: Array.from({ length: n }, (_, i) => `M${String(i)}`),
      },
    ],
  ];

  for (const [name, spec] of cases) {
    it(`gives the main thread's positions exactly (${name})`, () => {
      const first = randomWeights(n, 0.2, 1);
      const second = randomWeights(n, 0.2, 2);

      // Main thread: settle once, pin a member, then settle again for new weights.
      const main = new ForceLayout();
      main.update('a', n, first, radii, spec);
      if (spec.kind === 'force') main.pin(3, 10, -20);
      main.update('b', n, second, radii, spec);

      // Worker path: the same first layout, then the second as a job.
      const viaWorker = new ForceLayout();
      viaWorker.update('a', n, first, radii, spec);
      if (spec.kind === 'force') viaWorker.pin(3, 10, -20);
      const { changed, job } = viaWorker.prepare('b', n, second, radii, spec, 1);
      expect(changed).toBe(false);
      expect(job).not.toBeNull();
      if (!job) return;
      // Until the result arrives, the layout keeps its previous key and positions.
      expect(viaWorker.currentKey).toBe('a');
      expect(viaWorker.prepare('b', n, second, radii, spec, 1)).toEqual({
        changed: false,
        job: null,
      });
      const result = settleJob(structuredClone(job));
      expect(viaWorker.accept(job, result)).toBe(true);
      expect(viaWorker.currentKey).toBe('b');
      expect(viaWorker.snapshot()).toEqual(main.snapshot());
    });
  }

  it('ignores a result the layout has moved on from', () => {
    const layout = new ForceLayout();
    const w = randomWeights(n, 0.2, 3);
    layout.update('a', n, w, radii);
    const { job } = layout.prepare('b', n, randomWeights(n, 0.2, 4), radii, { kind: 'force' }, 1);
    if (!job) throw new Error('expected a job');
    // Another layout was built synchronously meanwhile (e.g. by the comparison view).
    layout.update('c', n, w, radii);
    expect(layout.accept(job, settleJob(job))).toBe(false);
    expect(layout.currentKey).toBe('c');
  });

  it('settles small layouts on the main thread', () => {
    const layout = new ForceLayout();
    const w = randomWeights(n, 0.01, 5);
    const { changed, job } = layout.prepare('a', n, w, radii, { kind: 'force' }, 1500);
    expect(changed).toBe(true);
    expect(job).toBeNull();
  });
});

describe('cached number formatters', () => {
  it('format as toLocaleString did', () => {
    for (const v of [0, 1, -2, 1234567, 0.1234, 1.2345, 12.345, 123.45, -0.5, NaN]) {
      const abs = Math.abs(v);
      const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : abs >= 1 ? 2 : 3;
      const expected = !Number.isFinite(v)
        ? 'Not defined'
        : Number.isInteger(v)
          ? v.toLocaleString('en-GB')
          : v.toLocaleString('en-GB', {
              minimumFractionDigits: digits,
              maximumFractionDigits: digits,
            });
      expect(formatValue(v)).toBe(expected);
    }
    expect(formatScale([0, 0.218, 0.437, NaN])).toEqual(['0.000', '0.218', '0.437', 'Not defined']);
  });
});

describe('action names', () => {
  it('confirmations repeat the verb of the action that asked for them', () => {
    expect(projectCopy.open.replace('…', '')).toBe(projectCopy.replaceConfirm.open);
    expect(projectCopy.loadDemo).toBe(projectCopy.replaceConfirm.demo);
  });

  it('import has one name in the menu, the empty state and the dialog', () => {
    expect(projectCopy.importData.replace('…', '')).toBe(shellCopy.empty.importData);
    expect(importCopy.title).toBe(shellCopy.empty.importData);
  });

  it('the ego view and the removal simulation have one name wherever they start', () => {
    expect(mapCopy.panel.showEgo).toBe(exploreCopy.ego.show);
    expect(mapCopy.panel.simulateRemoval).toBe(exploreCopy.resilience.run);
    expect(exploreCopy.group.simulate).toBe(exploreCopy.resilience.run);
    expect(mapCopy.modes.endSimulation).toBe(exploreCopy.resilience.end);
    expect(mapCopy.modes.clearPath).toBe(exploreCopy.path.clear);
    expect(mapCopy.modes.exitEgo).toBe(exploreCopy.ego.clear);
  });

  it('each export status names what its button exported', () => {
    const pairs = [
      [exportCopy.tables.members, exportCopy.tables.exported('members', 'f.csv')],
      [exportCopy.tables.network, exportCopy.tables.exported('network', 'f.csv')],
      [exportCopy.tables.formalInformal, exportCopy.tables.exported('formalInformal', 'f.csv')],
      [exportCopy.map.export, exportCopy.map.exported('f.png')],
      [exportCopy.report.export, exportCopy.report.exported('f.pdf')],
    ] as const;
    for (const [button, status] of pairs) {
      const noun = button.replace(/^Export /, '');
      expect(status.toLowerCase()).toContain(`${noun.toLowerCase()} exported`);
    }
  });
});
