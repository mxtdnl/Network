// Wording for the insights panel (spec §9, CLAUDE.md D9). The engine's rules
// (src/engine/insights.ts) return structure; this module turns it into
// neutral questions for inquiry. Nothing here describes a person as good or
// bad: tests/unit/insightsCopy.test.ts fails if any string contains a word
// from the banned list in CLAUDE.md ("Insight wording").
//
// Rule descriptions quote the thresholds from INSIGHT_RULES, so the rule shown
// is the rule that ran.

import {
  INSIGHT_RULES,
  type InsightRuleId,
  type InsightUnavailable,
  type InsightView,
  type Observation,
} from '../engineClient';
import { percent } from './data';
import { formatValue } from './map';
import type { SizeMetric } from '../state/store';
import { metricCopy } from './metrics';

/** What the copy needs from the project: plain labels for layers and attributes. */
export interface InsightContext {
  /** Label of a layer, a signed sub-layer or the composite. */
  layerLabel: (ref: string) => string;
  attributeLabel: (key: string) => string;
}

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

/** "Three members", "12 members": counts up to ten in words, as in running text. */
export function countOf(n: number, singular: string, plural: string): string {
  const word = WORDS[n] ?? String(n);
  return `${word} ${n === 1 ? singular : plural}`;
}

const lower = (s: string) => (s.length > 0 ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** −0.89: two decimals with a true minus sign. */
export function signed2(v: number): string {
  const text = Math.abs(v).toFixed(2);
  return v < 0 ? `−${text}` : text;
}

const ordinal = (q: number) => {
  const p = Math.round(q * 100);
  const suffix =
    p % 10 === 1 && p !== 11
      ? 'st'
      : p % 10 === 2 && p !== 12
        ? 'nd'
        : p % 10 === 3 && p !== 13
          ? 'rd'
          : 'th';
  return `${String(p)}${suffix}`;
};

const R = INSIGHT_RULES;

export const insightsCopy = {
  tab: 'Insights',
  intro:
    'Rule-based observations from the analysis on screen. Each is a question to explore with the people involved, not a finding about anyone. Every observation shows the rule that produced it.',
  coverage: (rate: string) =>
    `Data coverage is ${rate}, below the threshold, so observations about the whole network rest on incomplete data.`,
  noResult: 'Insights appear here once the analysis has run.',
  titles: {
    brokers: 'Potential brokers',
    peripheral: 'Peripheral members',
    overload: 'Possible overload',
    silo: 'Silos',
    negativeCluster: 'Negative clusters',
    formalOnly: 'Formal ties with no informal counterpart',
    informalOnly: 'Informal ties with no formal counterpart',
  } satisfies Record<InsightRuleId, string>,
  ruleLabel: 'Rule',
  membersLabel: (n: number, rule?: InsightRuleId) =>
    rule === 'formalOnly' || rule === 'informalOnly'
      ? `Members in the most such ties (${String(n)})`
      : n === 1
        ? 'Member'
        : `Members (${String(n)})`,
  viewLabel: 'View',
  none: 'No observation: nothing in this analysis meets the rule.',
  unavailable: {
    noComposite: 'Not applied: the composite is not defined. Give at least one layer a weight.',
    noLayers: 'Not applied: no enabled layer has ties.',
    layersNotEnabled:
      'Not applied: this rule reads the advice and workflow dependency layers. Enable either layer and add its ratings.',
    noGroupAttribute: 'Not applied: members have no team attribute.',
    noSignedLayer: 'Not applied: no signed layer (valence or energy) is enabled.',
    noFormalInformal:
      'Not applied: this rule needs both the formal and the informal collaboration layers.',
  } satisfies Record<InsightUnavailable, string>,
  nth: (title: string, k: number, n: number) => `${title}, ${String(k)} of ${String(n)}`,
  show: 'Show on the map',
  showLabel: (title: string) => `Show on the map: ${title}`,
  shown: (title: string) => `Shown on the map: ${title}`,
  saveView: 'Save as view',
  saveViewLabel: (title: string) => `Save as view: ${title}`,
  clearHighlight: 'Clear highlight',
} as const;

/** The rule as applied, with its thresholds. */
export function ruleText(rule: InsightRuleId, directed: boolean): string {
  const received = directed ? metricCopy.inStrength.label : metricCopy.strength.label;
  const connectionsIn = directed ? metricCopy.inDegree.label : metricCopy.degree.label;
  switch (rule) {
    case 'brokers':
      return `Bridging (betweenness) on the composite among the highest ${percent(R.brokers.topShare)} of members and above 0, and constraint at or below the median. At most ${String(R.brokers.maxMembers)} members, highest bridging first.`;
    case 'peripheral':
      return `${received} at or below the ${ordinal(R.peripheral.quantile)} percentile of members on more than half of the layers considered: each unsigned layer and the positive ratings of each signed layer, not the composite. A layer on which no one receives a tie is not considered.`;
    case 'overload':
      return `On the advice and workflow dependency layers: ${lower(connectionsIn)} at or above the ${ordinal(R.overload.quantile)} percentile of members and at least ${String(R.overload.medianMultiple)} times the median. At most ${String(R.overload.maxMembers)} members per layer.`;
    case 'silo':
      return `A team of at least ${String(R.silo.minGroupSize)} members whose E-I index is ${signed2(R.silo.maxEi)} or lower on the composite or on any unsigned layer, which means at least three ties inside the team for every tie outside it. The layer with the lowest index is quoted.`;
    case 'negativeCluster':
      return `Pairs who rate each other negatively in both directions on a signed layer, joined into groups through shared members. A group of at least ${String(R.negativeCluster.minSize)} members is shown. Read from the directed ratings in either view.`;
    case 'formalOnly':
      return `For every pair of teams, and every team on its own: at least ${percent(R.formalInformal.minShare)} of formal collaboration ties have no informal collaboration tie, and there are at least ${String(R.formalInformal.minPairs)} such ties. Pairs with a missing rating on either layer are left out. The ${String(R.formalInformal.maxMembers)} members in the most such ties are highlighted.`;
    case 'informalOnly':
      return `For every pair of teams, and every team on its own: at least ${percent(R.formalInformal.minShare)} of informal collaboration ties have no formal collaboration tie, and there are at least ${String(R.formalInformal.minPairs)} such ties. Pairs with a missing rating on either layer are left out. The ${String(R.formalInformal.maxMembers)} members in the most such ties are highlighted.`;
  }
}

const between = (o: Observation) => {
  const g = o.group;
  if (!g) return 'Across the network';
  return g.other === undefined || g.other === g.value
    ? `Within ${g.value}`
    : `Between ${g.value} and ${g.other}`;
};

/** The observation as a neutral question, with the figures that support it. */
export function questionText(o: Observation, ctx: InsightContext): string {
  const e = o.evidence;
  const n = (k: string) => e[k] ?? NaN;
  switch (o.rule) {
    case 'brokers':
      return `${countOf(o.members.length, 'member lies', 'members lie')} on many of the shortest routes between colleagues, while their own contacts are not closely tied to one another. What would happen to those routes if one of them were unavailable?`;
    case 'peripheral':
      return `${countOf(o.members.length, 'member receives', 'members receive')} fewer ties than most colleagues on at least ${formatValue(n('fewestLowLayers'))} of ${formatValue(n('layers'))} layers. Are they new, working remotely, or working through channels the survey does not ask about?`;
    case 'overload':
      return `On ${lower(ctx.layerLabel(o.ref))}, ${lower(countOf(o.members.length, 'member is', 'members are'))} named by the most colleagues: up to ${formatValue(n('highest'))} each, against a median of ${formatValue(n('median'))}. How is the demand on their time shared?`;
    case 'silo': {
      const team = o.group?.value ?? '';
      return `Most ${lower(ctx.layerLabel(o.ref))} ties involving ${team} stay within ${team}: ${formatValue(n('internal'))} inside and ${formatValue(n('external'))} outside (E-I index ${signed2(n('ei'))}). How does work reach the rest of the organisation?`;
    }
    case 'negativeCluster':
      return `In a group of ${formatValue(n('size'))} members, ${formatValue(n('pairs'))} pairs rate each other negatively on ${lower(ctx.layerLabel(o.ref))} in both directions. What shared circumstances might lie behind these ratings?`;
    case 'formalOnly':
      return `${between(o)}, ${formatValue(n('pairs'))} of ${formatValue(n('total'))} formal collaboration ties (${percent(n('share'))}) have no informal counterpart. What happens between these people outside formal processes?`;
    case 'informalOnly':
      return `${between(o)}, ${formatValue(n('pairs'))} of ${formatValue(n('total'))} informal collaboration ties (${percent(n('share'))}) have no formal counterpart. What work do these ties carry that the formal structure does not show?`;
  }
}

function metricLabel(key: string): string {
  const copy = (metricCopy as Partial<Record<string, { label: string }>>)[key as SizeMetric];
  return copy?.label ?? key;
}

const LAYOUTS: Record<InsightView['layout'], string> = {
  force: 'force-directed layout',
  grouped: 'grouped layout',
  hierarchy: 'formal hierarchy',
};

/** The view configuration in words: ties drawn, node size, layout, filters and highlight. */
export function viewText(view: InsightView, ctx: InsightContext): string {
  const parts = [
    `Ties from ${lower(ctx.layerLabel(view.layer))}`,
    `node size by ${lower(metricLabel(view.sizeMetric))}`,
    view.layout === 'grouped' && view.groupBy
      ? `grouped by ${lower(ctx.attributeLabel(view.groupBy))}`
      : LAYOUTS[view.layout],
  ];
  for (const f of view.filters) {
    parts.push(`showing ${lower(ctx.attributeLabel(f.key))} ${f.values.join(' or ')}`);
  }
  if (view.highlight.length > 0) {
    parts.push(`${countOf(view.highlight.length, 'member', 'members').toLowerCase()} highlighted`);
  }
  const text = parts.join(', ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}
