// The map's pure layers: the model (which members and ties are drawn and how
// each is encoded), the legend built from it, the renderer-neutral scene,
// keyboard traversal, ranks and valence colours.

import { describe, expect, it } from 'vitest';
import { parseProject } from '../../src/data/projectFile';
import type { Project } from '../../src/data/schema';
import { analyse } from '../../src/engine/analyse';
import { buildAnalysisInput } from '../../src/engine/input';
import type { AnalysisResult } from '../../src/engine/types';
import { hexToLab, labToHex, valenceColour } from '../../src/ui/map/colour';
import { legendSections } from '../../src/ui/map/legend';
import {
  buildMapModel,
  nextMember,
  NOT_RECORDED,
  valenceMatrix,
  type MapModel,
} from '../../src/ui/map/model';
import { rankOf } from '../../src/ui/map/rank';
import { buildScene, highlightSet, type Point } from '../../src/ui/map/scene';
import type { MapTheme } from '../../src/ui/map/theme';
import { initialMapSettings, type MapSettings } from '../../src/ui/state/store';
import { demoText } from './engineFixtures';

const demo = parseProject(demoText);

const VALENCE = ['#833110', '#9d5524', '#a67b55', '#919191', '#5188a1', '#156d8e', '#004d6e'];
const theme: MapTheme = {
  ink: '#1c2127',
  graphite: '#4e5761',
  stone: '#7a838e',
  paper: '#fbfcfc',
  categorical: [
    '#44aa99',
    '#332288',
    '#999933',
    '#117733',
    '#ddcc77',
    '#cc6677',
    '#88ccee',
    '#882255',
  ],
  other: '#b4b9bf',
  valence: VALENCE,
  nodeMin: 4,
  nodeMax: 16,
  nodeUndefined: 2,
  edgeMin: 0.5,
  edgeMax: 3,
  arrow: 6,
  dash: 4,
  gap: 3,
  dot: 1,
  pairOffset: 1.5,
  line: 1,
  focusWidth: 2,
  fade: 0.3,
  labelFont: '500 12px sans-serif',
  labelSize: 12,
  labelGap: 4,
  swatch: 24,
};

const results = new Map<string, AnalysisResult>();
async function resultFor(project: Project, s: MapSettings): Promise<AnalysisResult> {
  const key = `${project.meta.title}|${s.view}|${s.symmetrise}`;
  let r = results.get(key);
  if (!r) {
    const input = buildAnalysisInput(
      project,
      { view: s.view, symmetrise: s.symmetrise, weights: {}, signedTreatment: {} },
      key,
    );
    r = await analyse(input);
    results.set(key, r);
  }
  return r;
}

async function model(patch: Partial<MapSettings> = {}, project = demo): Promise<MapModel> {
  const s = { ...initialMapSettings(), ...patch };
  return buildMapModel(project, await resultFor(project, s), s, theme);
}

describe('valence colours', () => {
  it('returns the token colour at every whole step', () => {
    for (let v = -3; v <= 3; v++) expect(valenceColour(VALENCE, v)).toBe(VALENCE[v + 3]);
  });

  it('interpolates between steps in CIELAB', () => {
    const mid = hexToLab(valenceColour(VALENCE, -0.5));
    const a = hexToLab(VALENCE[2] ?? '');
    const b = hexToLab(VALENCE[3] ?? '');
    for (let k = 0; k < 3; k++) {
      expect(mid[k]).toBeCloseTo(((a[k] ?? 0) + (b[k] ?? 0)) / 2, 0);
    }
  });

  it('round-trips hex through CIELAB', () => {
    for (const hex of VALENCE) expect(labToHex(hexToLab(hex))).toBe(hex);
  });

  it('clamps values beyond the scale', () => {
    expect(valenceColour(VALENCE, 7)).toBe(VALENCE[6]);
    expect(valenceColour(VALENCE, -9)).toBe(VALENCE[0]);
  });
});

describe('map model', () => {
  it('draws one edge per tie with weight above the threshold on the selected layer', async () => {
    const all = await model({ layer: 'connection_strength' });
    const r = await resultFor(demo, { ...initialMapSettings() });
    const w = r.refs.connection_strength?.weights ?? new Float64Array();
    const n = demo.members.length;
    let expected = 0;
    for (let k = 0; k < n * n; k++) if ((w[k] as number) > 0) expected += 1;
    expect(all.edges.length).toBe(expected);
    const strong = await model({ layer: 'connection_strength', threshold: 0.6 });
    expect(strong.edges.length).toBeLessThan(all.edges.length);
    expect(strong.edges.every((e) => e.weight >= 0.6)).toBe(true);
    for (const e of all.edges) {
      expect(e.width).toBeGreaterThanOrEqual(theme.edgeMin);
      expect(e.width).toBeLessThanOrEqual(theme.edgeMax);
    }
  });

  it('draws arrows and both directions in the directed view, one edge per pair when mutual', async () => {
    const directed = await model({ layer: 'connection_strength' });
    const mutual = await model({ layer: 'connection_strength', view: 'symmetrised' });
    expect(directed.directed).toBe(true);
    expect(mutual.directed).toBe(false);
    expect(mutual.edges.every((e) => e.source < e.target)).toBe(true);
    expect(directed.edges.some((e) => e.source > e.target)).toBe(true);
    expect(directed.edges.some((e) => e.reciprocated)).toBe(true);
    expect(mutual.edges.some((e) => e.reciprocated)).toBe(false);
  });

  it('keeps a valence of 0 distinct from a valence that was not rated', async () => {
    const m = await model({ layer: 'connection_strength' });
    const v = valenceMatrix(demo, { ...initialMapSettings() });
    expect(v).not.toBeNull();
    expect(m.edges.some((e) => e.valence === 0)).toBe(true);
    expect(m.edges.some((e) => Number.isNaN(e.valence))).toBe(true);
    expect(m.anyValenceMissing).toBe(true);
    const off = await model({ layer: 'connection_strength', layerToggles: { valence: false } });
    expect(off.valenceShown).toBe(false);
    expect(off.edges.every((e) => Number.isNaN(e.valence))).toBe(true);
  });

  it('styles ties by formal and informal only when both layers are shown', async () => {
    const both = await model();
    expect(both.styleShown).toBe(true);
    expect(both.stylesPresent).toEqual(expect.arrayContaining(['formal', 'informal', 'both']));
    const one = await model({ layerToggles: { informal_collaboration: false } });
    expect(one.styleShown).toBe(false);
    expect(one.edges.every((e) => e.style === 'plain')).toBe(true);
  });

  it('hides members outside the filters, and their ties', async () => {
    const m = await model({ filters: [{ key: 'team', values: ['Finance'] }] });
    const finance = new Set(
      demo.members.filter((x) => x.attributes.team === 'Finance').map((x) => x.id),
    );
    expect(
      m.nodes
        .filter((x) => x.visible)
        .map((x) => x.id)
        .sort(),
    ).toEqual([...finance].sort());
    for (const e of m.edges) {
      expect(finance.has(m.nodes[e.source]?.id ?? '')).toBe(true);
      expect(finance.has(m.nodes[e.target]?.id ?? '')).toBe(true);
    }
  });

  it('treats a missing attribute as "Not recorded" in fill and filters', async () => {
    const p: Project = {
      ...demo,
      members: demo.members.map((x, i) =>
        i === 0 ? { ...x, attributes: { ...x.attributes, team: null } } : x,
      ),
      meta: { ...demo.meta, title: 'demo-missing-team' },
    };
    const m = await model({}, p);
    const g = m.fill.groups[m.nodes[0]?.group ?? -1];
    expect(g?.kind).toBe('notRecorded');
    expect(g?.hue).toBe(-1);
    const f = await model({ filters: [{ key: 'team', values: [NOT_RECORDED] }] }, p);
    expect(f.nodes.filter((x) => x.visible).map((x) => x.index)).toEqual([0]);
  });

  it('uses at most eight hues and groups the rest as Other', async () => {
    const p: Project = {
      ...demo,
      members: demo.members.map((x, i) => ({
        ...x,
        attributes: { ...x.attributes, team: `T${String(i % 11)}` },
      })),
      meta: { ...demo.meta, title: 'demo-eleven-teams' },
    };
    const m = await model({}, p);
    expect(m.fill.groups.filter((g) => g.hue >= 0)).toHaveLength(8);
    expect(m.fill.groups.find((g) => g.kind === 'other')?.members).toBeGreaterThan(0);
    expect(m.fill.otherGroups).toBe(3);
  });

  it('colours by community on the selected layer', async () => {
    const m = await model({ fill: { kind: 'community' } });
    const r = await resultFor(demo, initialMapSettings());
    expect(m.fill.kind).toBe('community');
    expect(m.fill.groups.filter((g) => g.kind === 'community')).toHaveLength(
      Math.min(8, r.refs.composite?.communities?.count ?? 0),
    );
  });

  it('sizes nodes by area between the smallest and largest value', async () => {
    const m = await model({ sizeMetric: 'inStrength' });
    const defined = m.nodes.filter((x) => Number.isFinite(x.sizeValue));
    const lo = defined.reduce((a, b) => (a.sizeValue < b.sizeValue ? a : b));
    const hi = defined.reduce((a, b) => (a.sizeValue > b.sizeValue ? a : b));
    expect(lo.radius).toBeCloseTo(theme.nodeMin);
    expect(hi.radius).toBeCloseTo(theme.nodeMax);
  });

  it('finds members by part of their name', async () => {
    const name = demo.members[3]?.display_name ?? '';
    const m = await model({ search: name.slice(0, 5).toUpperCase() });
    expect(m.searchMatches?.has(3)).toBe(true);
    const none = await model({ search: 'zzzz-no-one' });
    expect(none.searchMatches?.size).toBe(0);
  });
});

describe('legend', () => {
  it('explains every encoding in use, and only those', async () => {
    const kinds = (m: MapModel) => legendSections(m, theme).map((s) => s.kind);
    expect(kinds(await model())).toEqual(['size', 'fill', 'width', 'colour', 'style', 'arrows']);
    expect(kinds(await model({ view: 'symmetrised' }))).toEqual([
      'size',
      'fill',
      'width',
      'colour',
      'style',
    ]);
    expect(kinds(await model({ layerToggles: { formal_collaboration: false } }))).not.toContain(
      'style',
    );
  });

  it('names the chosen metric, attribute and layer, and states the threshold', async () => {
    const s = legendSections(
      await model({ layer: 'connection_strength', sizeMetric: 'inStrength', threshold: 0.4 }),
      theme,
    );
    expect(s.find((x) => x.kind === 'size')?.variable).toBe('Received strength');
    expect(s.find((x) => x.kind === 'fill')?.variable).toBe('Team or function');
    const width = s.find((x) => x.kind === 'width');
    expect(width?.variable).toBe('Connection strength');
    expect(width?.kind === 'width' && width.note).toBe('Ties below 0.40 hidden');
  });

  it('shows the valence scale, and a separate entry for valence not rated', async () => {
    const colour = legendSections(await model(), theme).find((x) => x.kind === 'colour');
    expect(colour?.kind === 'colour' && colour.steps.map((x) => x.step)).toEqual([
      -3, -2, -1, 0, 1, 2, 3,
    ]);
    expect(colour?.kind === 'colour' && colour.notRated).toBe('Valence not rated');
  });
});

const spiral = (n: number): Point[] =>
  Array.from({ length: n }, (_, i) => ({
    x: 12 * Math.sqrt(i + 0.5) * Math.cos(i * 2.4),
    y: 12 * Math.sqrt(i + 0.5) * Math.sin(i * 2.4),
  }));

describe('scene', () => {
  const size = { width: 800, height: 600 };
  const t = { x: 400, y: 300, k: 1 };
  const none = { hovered: null, focused: null, selected: null };

  it('draws every visible member once, at full strength when nothing is highlighted', async () => {
    const m = await model();
    const scene = buildScene(m, spiral(m.n), t, size, theme, none);
    expect(scene.nodes).toHaveLength(m.n);
    expect(scene.nodes.every((x) => x.alpha === 1)).toBe(true);
    expect(scene.arrows.length).toBeGreaterThan(0);
  });

  it('fades members outside a hovered neighbourhood', async () => {
    const m = await model();
    const h = { ...none, hovered: 0 };
    const lit = highlightSet(m, h);
    expect(lit).toEqual(new Set([0, ...(m.neighbours[0] ?? [])]));
    const scene = buildScene(m, spiral(m.n), t, size, theme, h);
    for (const node of scene.nodes) {
      expect(node.alpha).toBe(lit?.has(node.index) ? 1 : theme.fade);
    }
    const litOnly = buildScene(m, spiral(m.n), t, size, theme, h, 'lit');
    expect(litOnly.nodes.every((x) => lit?.has(x.index))).toBe(true);
    expect(litOnly.lines.every((b) => b.alpha === 1)).toBe(true);
  });

  it('never lets two labels overlap', async () => {
    const m = await model();
    const scene = buildScene(m, spiral(m.n), t, size, theme, none);
    const boxes = scene.labels.map((l) => {
      const w = (l.text.length * theme.labelSize * 0.5) / 2 + theme.labelGap;
      return { x0: l.x - w, x1: l.x + w, y0: l.y - theme.labelSize, y1: l.y + theme.labelGap };
    });
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (!a || !b) continue;
        expect(a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0).toBe(false);
      }
    }
  });

  it('draws the selection and focus rings', async () => {
    const m = await model();
    const scene = buildScene(m, spiral(m.n), t, size, theme, { ...none, selected: 2, focused: 5 });
    expect(scene.rings).toHaveLength(2);
  });
});

describe('keyboard traversal', () => {
  it('moves to the connected member in the direction of the arrow', async () => {
    const m = await model();
    const positions = spiral(m.n);
    const from = 0;
    const p = positions[from] as Point;
    const right = nextMember(m, positions, from, { x: 1, y: 0 });
    expect(right).not.toBeNull();
    const q = positions[right as number] as Point;
    expect(q.x).toBeGreaterThan(p.x);
    expect(m.neighbours[from]).toContain(right);
  });

  it('reaches a member without ties by falling back to the nearest one that way', () => {
    const m = {
      nodes: [0, 1, 2].map((i) => ({ index: i, visible: true })),
      neighbours: [[], [], []],
    } as unknown as MapModel;
    const positions = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ];
    expect(nextMember(m, positions, 0, { x: 1, y: 0 })).toBe(1);
    expect(nextMember(m, positions, 0, { x: 0, y: 1 })).toBe(2);
    expect(nextMember(m, positions, 0, { x: -1, y: 0 })).toBeNull();
  });
});

describe('ranks', () => {
  it('ranks from the highest value and shows tied values as a range', () => {
    const c = new Float64Array([0.5, 0.9, 0.5, NaN, 0.1, 0.5]);
    expect(rankOf(c, 1)).toBe('1');
    expect(rankOf(c, 0)).toBe('2–4');
    expect(rankOf(c, 4)).toBe('5');
    expect(rankOf(c, 3)).toBe('–');
  });
});
