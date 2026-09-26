// The formula shown beneath the weight sliders (spec §7: "the displayed
// formula matches the computed values", Phase 5 acceptance). The weight
// panel's formula is rendered to markup, read back as text, and evaluated
// independently of the engine on the demo's raw ratings; the result must
// equal the composite the engine computed, pair by pair.
//
// The three weight configurations are chosen so that the normalised weights
// have exactly two decimals (for example 3 : 4 : 1 : 2 → 0.30, 0.40, 0.10,
// 0.20), the precision the panel shows. The displayed numbers are then the
// engine's numbers exactly, and the comparison can be exact (1e-12) instead of
// allowing for rounding.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parseProject } from '../../src/data/projectFile';
import type { Project } from '../../src/data/schema';
import { analyse } from '../../src/engine/analyse';
import { buildAnalysisInput } from '../../src/engine/input';
import type { SignedTreatment } from '../../src/engine/types';
import { FormulaView } from '../../src/ui/views/WeightPanel';

const demo = parseProject(
  readFileSync(join(import.meta.dirname, '..', '..', 'src', 'demo', 'demo.ona.json'), 'utf8'),
);

interface Displayed {
  terms: { weight: number; label: string; positiveOnly: boolean }[];
  multipliers: { alpha: number; label: string }[];
  filters: string[];
  cap: number;
}

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .trim();

/** Reads the formula back from the rendered markup, as a reader would see it. */
function readFormula(html: string): Displayed {
  const out: Displayed = { terms: [], multipliers: [], filters: [], cap: NaN };
  for (const m of html.matchAll(/<li class="formula__line formula__line--(\w+)">(.*?)<\/li>/g)) {
    const kind = m[1];
    const body = m[2] ?? '';
    if (kind === 'term') {
      const weight = /<span class="formula__weight num">([^<]*)<\/span>/.exec(body)?.[1];
      const label = /<span class="formula__label">(.*)<\/span>$/.exec(body)?.[1] ?? '';
      const qualifier = /<span class="formula__qualifier">/.test(label);
      out.terms.push({
        weight: Number(weight),
        label: text(label.replace(/<span class="formula__qualifier">.*<\/span>/, '')),
        positiveOnly: qualifier,
      });
    } else if (kind === 'multiplier') {
      const t = /^× \(1 \+ ([\d.]+) × (.+)\)$/.exec(text(body));
      if (!t) throw new Error(`Unreadable multiplier: ${text(body)}`);
      out.multipliers.push({ alpha: Number(t[1]), label: t[2] ?? '' });
    } else if (kind === 'filter') {
      const t = /^set to 0 where (.+) is negative$/.exec(text(body));
      if (!t) throw new Error(`Unreadable filter: ${text(body)}`);
      out.filters.push(t[1] ?? '');
    } else if (kind === 'cap') {
      out.cap = Number(/capped at ([\d.]+)/.exec(text(body))?.[1]);
    }
  }
  return out;
}

/** Evaluates the displayed formula on raw ratings (method notes §1.2 and §6), without the engine. */
function evaluate(project: Project, f: Displayed): Float64Array {
  const n = project.members.length;
  const index = new Map(project.members.map((m, i) => [m.id, i]));
  const byLabel = new Map(project.layers.map((l) => [l.label, l]));
  const raw = (label: string) => {
    const layer = byLabel.get(label);
    if (!layer) throw new Error(`The formula names an unknown layer: ${label}`);
    const r = new Float64Array(n * n).fill(NaN);
    for (const t of project.ties) {
      if (t.variable !== layer.key || t.wave !== 1 || typeof t.value !== 'number') continue;
      r[(index.get(t.rater_id) as number) * n + (index.get(t.ratee_id) as number)] = t.value;
    }
    return { layer, r };
  };
  const terms = f.terms.map((t) => ({ ...t, ...raw(t.label) }));
  const multipliers = f.multipliers.map((m) => ({ ...m, ...raw(m.label) }));
  const filters = f.filters.map((label) => raw(label));
  const signedScale = (v: number, min: number, max: number) => (v >= 0 ? v / max : v / -min);
  const out = new Float64Array(n * n).fill(NaN);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const k = i * n + j;
      let num = 0;
      let den = 0;
      for (const t of terms) {
        const v = t.r[k] as number;
        if (Number.isNaN(v)) continue;
        const x = t.positiveOnly
          ? Math.max(signedScale(v, t.layer.min, t.layer.max), 0)
          : (v - t.layer.min) / (t.layer.max - t.layer.min);
        num += t.weight * x;
        den += t.weight;
      }
      if (den === 0) continue;
      let c = num / den;
      for (const fl of filters) if ((fl.r[k] as number) < 0) c = 0;
      for (const m of multipliers) {
        const v = m.r[k] as number;
        if (!Number.isNaN(v)) c *= 1 + m.alpha * signedScale(v, m.layer.min, m.layer.max);
      }
      out[k] = Math.min(c, f.cap);
    }
  }
  return out;
}

const CONFIGS: {
  name: string;
  weights: Record<string, number>;
  treatment: Record<string, SignedTreatment>;
  shown: string[];
}[] = [
  {
    name: 'four summed layers, valence positive only',
    weights: {
      connection_strength: 3,
      valence: 4,
      informal_collaboration: 1,
      formal_collaboration: 2,
    },
    treatment: { valence: 'positive' },
    shown: ['0.30', '0.40', '0.10', '0.20'],
  },
  {
    name: 'valence as a multiplier',
    weights: {
      connection_strength: 1,
      valence: 1,
      informal_collaboration: 1,
      formal_collaboration: 2,
    },
    treatment: { valence: 'multiplier' },
    shown: ['0.25', '0.25', '0.50'],
  },
  {
    name: 'valence as a filter, formal collaboration left out',
    weights: {
      connection_strength: 1,
      valence: 1,
      informal_collaboration: 3,
      formal_collaboration: 0,
    },
    treatment: { valence: 'filterNegative' },
    shown: ['0.25', '0.75'],
  },
];

describe('the displayed composite formula', () => {
  it.each(CONFIGS)('matches the engine’s composite: $name', async (config) => {
    const input = buildAnalysisInput(
      demo,
      {
        view: 'directed',
        symmetrise: 'mean',
        weights: config.weights,
        signedTreatment: config.treatment,
      },
      config.name,
    );
    const result = await analyse(input);
    const formula = result.composite;
    const composite = result.refs.composite?.weights;
    if (!formula || !composite) throw new Error('No composite');

    const html = renderToStaticMarkup(createElement(FormulaView, { formula }));
    const shown = readFormula(html);

    // The numbers shown are the engine's normalised weights, in slider order.
    expect(shown.terms.map((t) => t.weight.toFixed(2))).toEqual(config.shown);
    expect(shown.terms.map((t) => t.weight)).toEqual(formula.terms.map((t) => t.weight));
    expect(shown.multipliers.map((m) => m.label)).toEqual(formula.multipliers.map((m) => m.label));
    expect(shown.filters).toEqual(formula.filters.map((f) => f.label));
    expect(shown.cap).toBe(formula.cap);

    // Evaluating what is shown gives the engine's composite for every pair.
    const displayed = evaluate(demo, shown);
    let compared = 0;
    for (let k = 0; k < composite.length; k++) {
      const a = displayed[k] as number;
      const b = composite[k] as number;
      if (Number.isNaN(b)) {
        expect(a).toBeNaN();
        continue;
      }
      expect(Math.abs(a - b)).toBeLessThanOrEqual(1e-12);
      compared += 1;
    }
    // Most of the 1,560 ordered pairs carry a composite value.
    expect(compared).toBeGreaterThan(1400);
  });

  it('distinguishes the three configurations', async () => {
    const values = await Promise.all(
      CONFIGS.map(async (c) => {
        const r = await analyse(
          buildAnalysisInput(
            demo,
            {
              view: 'directed',
              symmetrise: 'mean',
              weights: c.weights,
              signedTreatment: c.treatment,
            },
            c.name,
          ),
        );
        return r.refs.composite?.weights;
      }),
    );
    const [a, b, c] = values as Float64Array[];
    const differs = (x: Float64Array, y: Float64Array) =>
      x.some((v, k) => Number.isFinite(v) && Math.abs(v - (y[k] as number)) > 1e-6);
    expect(differs(a as Float64Array, b as Float64Array)).toBe(true);
    expect(differs(b as Float64Array, c as Float64Array)).toBe(true);
  });
});
