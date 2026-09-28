// Phase 8: colour contrast of text and of data marks against the grounds they
// are drawn on (WCAG 2.2 AA: 1.4.3 text 4.5:1, 1.4.11 non-text 3:1), computed
// from tokens.css, and the separation of the edge colours under simulated
// colour-vision deficiencies. The figures are printed for docs/design-audit.md.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CVD, contrast, deltaE00, hex, mixLab, over, simulate, type Rgb } from './colour';

const css = readFileSync(
  join(import.meta.dirname, '..', '..', 'src', 'styles', 'tokens.css'),
  'utf8',
);
const token = (name: string): Rgb => {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!m?.[1]) throw new Error(`No colour token --${name}`);
  return hex(m[1]);
};
const fade = Number(/--map-fade:\s*([\d.]+)/.exec(css)?.[1]);

const ink = token('ink');
const graphite = token('graphite');
const stone = token('stone');
const field = token('field');
const paper = token('paper');
const accent = token('accent');
const valence = ['val-n3', 'val-n2', 'val-n1', 'val-0', 'val-p1', 'val-p2', 'val-p3'].map(token);
const categorical = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => token(`cat-${String(i)}`));

const rows: string[] = [];
function check(label: string, fg: Rgb, bg: Rgb, min: number) {
  const ratio = contrast(fg, bg);
  rows.push(`${label}: ${ratio.toFixed(2)} (needs ${String(min)})`);
  expect(ratio, label).toBeGreaterThanOrEqual(min);
}

describe('contrast of text', () => {
  it('body, secondary and link text on both grounds', () => {
    for (const [name, bg] of [
      ['field', field],
      ['paper', paper],
    ] as const) {
      check(`ink on ${name}`, ink, bg, 4.5);
      check(`graphite on ${name}`, graphite, bg, 4.5);
      check(`accent (links, active tab) on ${name}`, accent, bg, 4.5);
    }
    check('paper on accent (primary button)', paper, accent, 4.5);
    check('paper on ink (selected segment)', paper, ink, 4.5);
  });

  it('matrix cell values on every shade', () => {
    [0.12, 0.24, 0.36, 0.48, 0.6].forEach((p, k) => {
      check(`ink on shade-${String(k + 1)}`, ink, mixLab(token('val-p3'), p, paper), 4.5);
    });
    valence.forEach((v, k) => {
      check(`ink on signed shade ${String(k - 3)}`, ink, mixLab(v, 0.6, paper), 4.5);
    });
  });

  it('map labels on their paper halo', () => {
    check('map label (ink on paper halo)', ink, paper, 4.5);
    // Names of members outside a highlight are faded on purpose: they are part
    // of a picture, and every member stays named in the table beside the map.
    rows.push(
      `faded map label (ink at ${String(fade)} on paper): ${contrast(over(ink, fade, paper), paper).toFixed(2)} (part of a picture, exempt)`,
    );
  });
});

describe('contrast of data marks and control boundaries', () => {
  it('control boundaries and the focus ring', () => {
    check('stone boundary on field', stone, field, 3);
    check('stone boundary on paper', stone, paper, 3);
    check('accent focus ring on field', accent, field, 3);
    check('accent focus ring on paper', accent, paper, 3);
  });

  it('edges on the map ground', () => {
    valence.forEach((v, k) => {
      check(`valence ${String(k - 3)} edge on paper`, v, paper, 3);
    });
    check('valence not rated edge (graphite, D113) on paper', graphite, paper, 3);
    check('edge with valence hidden (stone) on paper', stone, paper, 3);
    check('shortest path (ink) on paper', ink, paper, 3);
  });

  it('nodes: the ink outline carries the boundary; the fills are listed', () => {
    check('node outline and selection ring (ink) on paper', ink, paper, 3);
    check('selection ring (ink) against its paper halo', ink, paper, 3);
    check('not-rated hatch (stone) on paper', stone, paper, 3);
    categorical.forEach((c, k) => {
      rows.push(
        `cat-${String(k + 1)} fill on paper: ${contrast(c, paper).toFixed(2)}; against its ink outline ${contrast(c, ink).toFixed(2)}`,
      );
    });
  });

  it('edge colours stay apart under colour-vision simulation', () => {
    // A tie with no valence rating must never read as a rated one, the neutral grey included.
    const conditions = ['normal', ...Object.keys(CVD)] as const;
    let min = Infinity;
    for (const c of conditions) {
      const f = (x: Rgb) => (c === 'normal' ? x : simulate(x, c as keyof typeof CVD));
      for (const v of valence) min = Math.min(min, deltaE00(f(graphite), f(v)));
    }
    rows.push(
      `valence not rated vs every valence step, worst ΔE00 over all conditions: ${min.toFixed(1)}`,
    );
    expect(min).toBeGreaterThan(9);
  });

  it('prints the table', () => {
    console.log(rows.join('\n'));
  });
});
