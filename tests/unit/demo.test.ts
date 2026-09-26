import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateDemo } from '../../scripts/generate-demo';
import { computeCoverage } from '../../src/data/coverage';
import { parseProject, serialiseProject } from '../../src/data/projectFile';
import type { Project } from '../../src/data/schema';

const committed = readFileSync(
  join(import.meta.dirname, '..', '..', 'src', 'demo', 'demo.ona.json'),
  'utf8',
);
const demo = parseProject(committed);

function ratings(p: Project, variable: string) {
  const map = new Map<string, number | null>();
  for (const t of p.ties) {
    if (t.variable === variable && typeof t.value !== 'string') {
      map.set(`${t.rater_id}>${t.ratee_id}`, t.value);
    }
  }
  return map;
}
const teamOf = (p: Project) => new Map(p.members.map((m) => [m.id, m.attributes.team]));

describe('demo dataset', () => {
  it('is deterministic and matches the committed file', () => {
    expect(serialiseProject(generateDemo())).toBe(committed);
    expect(serialiseProject(generateDemo(7))).not.toBe(committed);
  });

  it('has about 40 fictional people in 5 teams', () => {
    expect(demo.members).toHaveLength(40);
    expect(new Set(demo.members.map((m) => m.attributes.team)).size).toBe(5);
    expect(demo.meta.notes).toContain('Fictional data');
  });

  it('has a broker: one member with strong ties into every other team', () => {
    const team = teamOf(demo);
    const strength = ratings(demo, 'connection_strength');
    const reach = new Map<string, Set<string>>();
    for (const [pair, value] of strength) {
      const [a = '', b = ''] = pair.split('>');
      if ((value ?? 0) >= 3 && team.get(a) !== team.get(b)) {
        const set = reach.get(a) ?? new Set();
        set.add(team.get(b) ?? '');
        reach.set(a, set);
      }
    }
    const brokers = [...reach].filter(([, teams]) => teams.size >= 4).map(([id]) => id);
    expect(brokers).toEqual(['OPE04']);
  });

  it('has a siloed team: Finance ties outside Finance run only through the broker', () => {
    const team = teamOf(demo);
    const strength = ratings(demo, 'connection_strength');
    const outside = [...strength].filter(([pair, value]) => {
      const [a = '', b = ''] = pair.split('>');
      const crosses = (team.get(a) === 'Finance') !== (team.get(b) === 'Finance');
      return crosses && (value ?? 0) > 0;
    });
    expect(outside.length).toBeGreaterThan(0);
    expect(outside.every(([pair]) => pair.includes('OPE04'))).toBe(true);
  });

  it('has a pocket of reciprocated negative valence', () => {
    const valence = ratings(demo, 'valence');
    const mutual = [...valence].filter(([pair, value]) => {
      const [a, b] = pair.split('>');
      return (value ?? 0) < 0 && (valence.get(`${b ?? ''}>${a ?? ''}`) ?? 0) < 0;
    });
    const people = new Set(mutual.flatMap(([pair]) => pair.split('>')));
    expect(people.size).toBeGreaterThanOrEqual(3);
    expect(mutual.length).toBeGreaterThanOrEqual(6);
  });

  it('has a clear formal–informal mismatch in both directions', () => {
    const formal = ratings(demo, 'formal_collaboration');
    const informal = ratings(demo, 'informal_collaboration');
    let formalOnly = 0;
    let informalOnly = 0;
    for (const [pair, f] of formal) {
      const i = informal.get(pair);
      if (f === null || i === null || i === undefined) continue;
      if (f >= 3 && i === 0) formalOnly += 1;
      if (i >= 3 && f === 0) informalOnly += 1;
    }
    expect(formalOnly).toBeGreaterThanOrEqual(20);
    expect(informalOnly).toBeGreaterThanOrEqual(10);
  });

  it('has realistic, incomplete coverage above the default threshold', () => {
    const c = computeCoverage(demo);
    expect(c.rate).toBeGreaterThan(0.8);
    expect(c.rate).toBeLessThan(1);
    expect(c.declined).toBeGreaterThan(0);
    expect(c.raters.filter((r) => r.rate < 0.8).length).toBe(2);
  });
});
