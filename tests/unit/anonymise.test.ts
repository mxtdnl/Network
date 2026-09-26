import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { memberCodes, replaceNames, teamAbbreviations } from '../../src/data/anonymise';
import { parseProject } from '../../src/data/projectFile';
import { memberNames } from '../../src/ui/state/names';

const member = (team: string | null, level: string | null) => ({ attributes: { team, level } });

describe('role/team codes (plan Q13)', () => {
  it('writes team, level and a number within the team and level', () => {
    const { codes } = memberCodes([
      member('Finance', 'L3'),
      member('Finance', 'L3'),
      member('Finance', 'L4'),
      member('Operations', 'L3'),
    ]);
    expect(codes).toEqual(['FIN-L3-01', 'FIN-L3-02', 'FIN-L4-01', 'OPE-L3-01']);
  });

  it('gives teams distinct abbreviations', () => {
    const abbr = teamAbbreviations(['Operations', 'Operations support', 'Opera', 'Ops']);
    expect(new Set(abbr.values()).size).toBe(4);
    expect(abbr.get('Operations')).toBe('OPE');
    expect(abbr.get('Operations support')).toBe('OS');
  });

  it('marks a missing team or level with X', () => {
    expect(memberCodes([member(null, null), member('Sales', null)]).codes).toEqual([
      'X-X-01',
      'SAL-X-01',
    ]);
  });

  it('reports team–level groups smaller than three', () => {
    const { smallGroups } = memberCodes([
      member('Finance', 'L3'),
      member('Finance', 'L3'),
      member('Finance', 'L3'),
      member('Finance', 'L5'),
    ]);
    expect(smallGroups).toEqual([{ prefix: 'FIN-L5', size: 1 }]);
  });

  it('gives every demo member a distinct code', () => {
    const demo = parseProject(
      readFileSync(join(import.meta.dirname, '..', '..', 'src', 'demo', 'demo.ona.json'), 'utf8'),
    );
    const { codes } = memberCodes(demo.members);
    expect(new Set(codes).size).toBe(demo.members.length);
    for (const code of codes) expect(code).toMatch(/^[A-Z]{2,4}\d?-[A-Z0-9]{1,4}-\d{2,}$/);
  });
});

describe('names replaced in free text', () => {
  const names = ['Ada Theodolite', 'Ben Alidade', 'Ada Plumb'];
  const codes = ['FIN-L3-01', 'OPE-L2-01', 'SAL-L2-01'];

  it('replaces full names, then unique name parts, and marks shared parts', () => {
    expect(replaceNames('Ada Theodolite and Ben met Plumb.', names, codes, '[name]')).toBe(
      'FIN-L3-01 and OPE-L2-01 met SAL-L2-01.',
    );
    expect(replaceNames('Ask Ada.', names, codes, '[name]')).toBe('Ask [name].');
    expect(replaceNames('Alidade’s team', names, codes, '[name]')).toBe('OPE-L2-01’s team');
  });

  it('matches whole words only, case-sensitively', () => {
    expect(replaceNames('Benchmarks and ben', names, codes, '[name]')).toBe('Benchmarks and ben');
  });
});

describe('the names layer', () => {
  const demo = parseProject(
    readFileSync(join(import.meta.dirname, '..', '..', 'src', 'demo', 'demo.ona.json'), 'utf8'),
  );

  it('gives real names when off and codes when on, for every member', () => {
    const named = memberNames(demo, false);
    const coded = memberNames(demo, true);
    expect(named.byIndex).toEqual(demo.members.map((m) => m.display_name));
    for (const m of demo.members) {
      expect(coded.of(m.id)).not.toBe(m.display_name);
      expect(coded.text(`Caption about ${m.display_name}.`)).not.toContain(m.display_name);
    }
  });

  it('memoises per project and setting', () => {
    expect(memberNames(demo, true)).toBe(memberNames(demo, true));
    expect(memberNames(demo, false)).not.toBe(memberNames(demo, true));
  });
});
