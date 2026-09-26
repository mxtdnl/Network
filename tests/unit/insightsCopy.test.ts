// Copy test for the insights panel (spec §9): no insight string may contain a
// word from the banned evaluative list in CLAUDE.md ("Insight wording"). The
// strings checked are every title, rule, status line and button label, and
// the question and view description of every observation the rules produce on
// the demo (both views, all three symmetrisation rules) and on constructed
// observations for rules the demo cannot trigger.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseProject } from '../../src/data/projectFile';
import { analyse } from '../../src/engine/analyse';
import { buildAnalysisInput } from '../../src/engine/input';
import { INSIGHT_RULE_ORDER } from '../../src/engine/insights';
import type { InsightRuleId, Observation } from '../../src/engine/types';
import {
  insightsCopy,
  questionText,
  ruleText,
  viewText,
  type InsightContext,
} from '../../src/ui/copy/insights';

const root = join(import.meta.dirname, '..', '..');

/** The banned list, read from the fenced block in CLAUDE.md. */
export function bannedWords(): string[] {
  const text = readFileSync(join(root, 'CLAUDE.md'), 'utf8');
  const block = /```banned-evaluative-words\n([\s\S]*?)```/.exec(text)?.[1];
  if (!block) throw new Error('CLAUDE.md has no banned-evaluative-words block');
  return block
    .split(/[,\n]/)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w !== '');
}

/** Banned words or phrases found in `text`, as whole words, ignoring case. */
export function findBanned(text: string, words: readonly string[]): string[] {
  return words.filter((w) => {
    const pattern = w
      .split(/\s+/)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('\\s+');
    return new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, 'iu').test(text);
  });
}

const words = bannedWords();

const ctx: InsightContext = {
  layerLabel: (ref) =>
    ({
      composite: 'Composite',
      connection_strength: 'Connection strength',
      advice: 'Advice / information seeking',
      workflow_dependency: 'Workflow dependency',
      'valence-': 'Valence',
      formal_collaboration: 'Formal collaboration',
      informal_collaboration: 'Informal collaboration',
    })[ref] ?? ref,
  attributeLabel: (key) => (key === 'team' ? 'Team' : key),
};

/** Every static string of the panel. */
function staticStrings(): string[] {
  const out: string[] = [
    insightsCopy.tab,
    insightsCopy.intro,
    insightsCopy.coverage('62%'),
    insightsCopy.noResult,
    insightsCopy.ruleLabel,
    insightsCopy.membersLabel(1),
    insightsCopy.membersLabel(4),
    insightsCopy.membersLabel(5, 'formalOnly'),
    insightsCopy.viewLabel,
    insightsCopy.none,
    insightsCopy.show,
    insightsCopy.saveView,
    insightsCopy.clearHighlight,
    insightsCopy.nth('Silos', 2, 3),
    ...Object.values(insightsCopy.unavailable),
  ];
  for (const rule of INSIGHT_RULE_ORDER) {
    const title = insightsCopy.titles[rule];
    out.push(title, insightsCopy.showLabel(title), insightsCopy.shown(title));
    out.push(insightsCopy.saveViewLabel(title), ruleText(rule, true), ruleText(rule, false));
  }
  return out;
}

const view = (members: string[]): Observation['view'] => ({
  layer: 'composite',
  sizeMetric: 'betweenness',
  layout: 'force',
  groupBy: null,
  filters: [],
  highlight: members,
  show: [],
});

/** One observation per rule with typical evidence, including rules the demo cannot trigger. */
function constructed(): Observation[] {
  const m = ['A', 'B', 'C'];
  const make = (
    rule: InsightRuleId,
    ref: string,
    evidence: Record<string, number>,
    extra: Partial<Observation> = {},
  ): Observation => ({ rule, ref, members: m, evidence, view: view(m), ...extra });
  return [
    make('brokers', 'composite', { count: 3 }),
    make('peripheral', 'composite', { count: 3, layers: 5, fewestLowLayers: 3 }),
    make('overload', 'advice', { count: 3, highest: 17, median: 4 }),
    make('overload', 'workflow_dependency', { count: 1, highest: 9, median: 2 }),
    make(
      'silo',
      'connection_strength',
      { ei: -0.71, internal: 40, external: 7 },
      { group: { attribute: 'team', value: 'Finance' } },
    ),
    make('negativeCluster', 'valence-', { size: 5, pairs: 6 }),
    make(
      'formalOnly',
      'formal_collaboration',
      { pairs: 12, total: 20, share: 0.6 },
      { group: { attribute: 'team', value: 'Product', other: 'Sales' } },
    ),
    make(
      'informalOnly',
      'informal_collaboration',
      { pairs: 8, total: 9, share: 0.89 },
      { group: { attribute: 'team', value: 'People', other: 'People' } },
    ),
    make('formalOnly', 'formal_collaboration', { pairs: 6, total: 7, share: 0.86 }),
    {
      ...make('silo', 'composite', { ei: -1, internal: 3, external: 0 }),
      group: { attribute: 'team', value: 'Legal' },
      view: {
        ...view(m),
        layout: 'grouped',
        groupBy: 'team',
        filters: [{ key: 'team', values: ['Legal', 'Finance'] }],
      },
    },
  ];
}

async function demoObservations(): Promise<Observation[]> {
  const project = parseProject(readFileSync(join(root, 'src/demo/demo.ona.json'), 'utf8'));
  const out: Observation[] = [];
  for (const [viewKind, rule] of [
    ['directed', 'mean'],
    ['symmetrised', 'mean'],
    ['symmetrised', 'min'],
    ['symmetrised', 'max'],
  ] as const) {
    const input = buildAnalysisInput(
      project,
      { view: viewKind, symmetrise: rule, weights: {}, signedTreatment: {} },
      `${viewKind}-${rule}`,
    );
    const result = await analyse(input);
    for (const o of result.insights) out.push(...o.observations);
  }
  return out;
}

describe('the banned-word check itself', () => {
  it('reads a non-empty list from CLAUDE.md', () => {
    expect(words.length).toBeGreaterThan(40);
    expect(words).toContain('bottleneck');
    expect(words).toContain('high performer');
  });

  it('finds whole words and phrases in any case, and nothing inside other words', () => {
    expect(findBanned('Is this team a Bottleneck?', words)).toEqual(['bottleneck']);
    expect(findBanned('A high  performer.', words)).toContain('high performer');
    expect(findBanned('Goodwill and badges', words)).toEqual([]);
    expect(findBanned('Staring at the stars', words)).toEqual([]);
  });

  it('would fail an insight that labels a person', () => {
    const verdict = 'Priya is a poor communicator and a bottleneck.';
    expect(findBanned(verdict, words)).toEqual(['poor', 'bottleneck']);
  });
});

describe('insight wording is neutral', () => {
  it('uses no banned word in any static string', () => {
    for (const text of staticStrings()) expect(findBanned(text, words), text).toEqual([]);
  });

  it('uses no banned word in any question or view description', async () => {
    const observations = [...(await demoObservations()), ...constructed()];
    // The demo triggers every rule except possible overload (no advice or dependency layer).
    const rules = new Set(observations.map((o) => o.rule));
    expect([...rules].sort()).toEqual([...INSIGHT_RULE_ORDER].sort());
    for (const o of observations) {
      for (const text of [questionText(o, ctx), viewText(o.view, ctx)]) {
        expect(findBanned(text, words), text).toEqual([]);
      }
    }
  });

  it('phrases every observation as a question', async () => {
    for (const o of [...(await demoObservations()), ...constructed()]) {
      expect(questionText(o, ctx).trim().endsWith('?')).toBe(true);
    }
  });

  it('never names a member in a question: members are listed separately', async () => {
    const project = parseProject(readFileSync(join(root, 'src/demo/demo.ona.json'), 'utf8'));
    const names = project.members.map((m) => m.display_name);
    for (const o of await demoObservations()) {
      const q = questionText(o, ctx);
      for (const name of names) expect(q.includes(name), `${name} in ${q}`).toBe(false);
    }
  });
});
