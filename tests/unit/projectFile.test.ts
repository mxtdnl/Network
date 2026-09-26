import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createProject } from '../../src/data/defaults';
import { migrate, MIGRATIONS, ProjectFileError, type Migration } from '../../src/data/migrations';
import { parseProject, projectFileName, serialiseProject } from '../../src/data/projectFile';
import { SCHEMA_VERSION, type Project } from '../../src/data/schema';

// A project with every field populated, including the awkward cases: null and
// zero ratings, negative and categorical values, a later wave, unicode text,
// custom attributes, a disabled core layer, a saved view and non-default settings.
export function richProject(): Project {
  const p = createProject('Équipe “Nord” 2026', '2026-09-26T10:00:00.000Z');
  p.meta.modified_at = '2026-09-26T11:30:00.000Z';
  p.meta.notes = 'Line one\nLine two, with a tab\tand emoji-free text.';
  p.attribute_definitions.push({
    key: 'office_floor',
    label: 'Office floor',
    type: 'categorical',
    categories: ['2', '3'],
    builtin: false,
  });
  const team = p.attribute_definitions.find((a) => a.key === 'team');
  if (team) team.categories = ['Finance', 'Operations'];
  p.members = [
    {
      id: 'A01',
      display_name: 'Zoë Ødegaard',
      attributes: { team: 'Finance', level: 'L4', manager_id: null, office_floor: '3' },
    },
    {
      id: 'A02',
      display_name: 'Bram Contour',
      attributes: { team: 'Finance', level: null, manager_id: 'A01', office_floor: null },
    },
    {
      id: 'A03',
      display_name: 'Chiara Meridian',
      attributes: { team: 'Operations', level: 'L3', manager_id: 'A01', office_floor: '2' },
    },
  ];
  const valence = p.layers.find((l) => l.key === 'valence');
  if (valence) valence.enabled = false;
  const channel = p.layers.find((l) => l.key === 'primary_channel');
  if (channel) channel.enabled = true;
  const advice = p.layers.find((l) => l.key === 'advice');
  if (advice) {
    advice.label = 'Advice';
    advice.question_wording = 'Whom do you ask for advice?';
  }
  p.ties = [
    { rater_id: 'A01', ratee_id: 'A02', variable: 'connection_strength', value: 0, wave: 1 },
    { rater_id: 'A02', ratee_id: 'A01', variable: 'connection_strength', value: null, wave: 1 },
    { rater_id: 'A01', ratee_id: 'A03', variable: 'valence', value: -3, wave: 1 },
    { rater_id: 'A03', ratee_id: 'A01', variable: 'valence', value: 2.5, wave: 1 },
    { rater_id: 'A03', ratee_id: 'A02', variable: 'primary_channel', value: 'video', wave: 1 },
    { rater_id: 'A01', ratee_id: 'A02', variable: 'connection_strength', value: 5, wave: 2 },
  ];
  p.saved_views = [
    {
      id: 'v1',
      name: 'Finance links',
      caption: 'Who connects Finance to Operations?',
      created_at: '2026-09-26T11:00:00.000Z',
      analysis: {
        view: 'symmetrised',
        symmetrise: 'min',
        activeLayer: 'composite',
        weights: { connection_strength: 0.5, informal_collaboration: 0.5 },
        signedTreatment: { valence: 'multiplier' },
        preset: 'custom',
        nodeSizeMetric: 'betweenness',
        nodeFill: { kind: 'attribute', key: 'team' },
      },
      map: {
        layout: 'grouped',
        groupBy: 'team',
        positions: { A01: { x: 1.5, y: -2, pinned: true } },
        viewport: { x: 0, y: 0, k: 1.25 },
        threshold: 0.2,
        layerToggles: { connection_strength: true },
        filters: [{ key: 'team', values: ['Finance'] }],
        egoView: { member: 'A01', depth: 2 },
        path: null,
      },
      selection: ['A01', 'A03'],
    },
  ];
  p.settings = {
    coverage_threshold: 0.65,
    anonymise: true,
    exclude_signed_from_exports: true,
    random_seed: 42,
    bootstrap: { replicates: 500, drop_fraction: 0.2 },
    anonymisation_scheme: 'role_team',
  };
  return p;
}

const demoText = readFileSync(
  join(import.meta.dirname, '..', '..', 'src', 'demo', 'demo.ona.json'),
  'utf8',
);

describe('save → load round trip', () => {
  it('loses nothing: the loaded project deep-equals the saved one', () => {
    const project = richProject();
    const loaded = parseProject(serialiseProject(project));
    expect(loaded).toStrictEqual(project);
  });

  it('is stable: saving a loaded project writes identical text', () => {
    const text = serialiseProject(richProject());
    expect(serialiseProject(parseProject(text))).toBe(text);
  });

  it('round-trips the demo project', () => {
    const demo = parseProject(demoText);
    expect(parseProject(serialiseProject(demo))).toStrictEqual(demo);
    expect(serialiseProject(demo)).toBe(demoText);
  });

  it('writes schema_version first', () => {
    expect(
      serialiseProject(richProject()).startsWith(
        `{\n  "schema_version": ${String(SCHEMA_VERSION)},`,
      ),
    ).toBe(true);
  });

  it('names the file after the project title', () => {
    expect(projectFileName(richProject())).toBe('equipe-nord-2026.ona.json');
    expect(projectFileName(createProject('', 'x'))).toBe('project.ona.json');
  });
});

describe('schema versions and migrations', () => {
  const v1 = () => JSON.parse(serialiseProject(richProject())) as Record<string, unknown>;

  it('has a registry whose version-1 step is the identity', () => {
    expect(MIGRATIONS.map((m) => [m.from, m.to])).toEqual([[1, 1]]);
    const file = v1();
    expect(migrate(file)).toStrictEqual(file);
  });

  it('refuses a file from a newer version with a clear message', () => {
    const text = JSON.stringify({ ...v1(), schema_version: SCHEMA_VERSION + 1 });
    expect(() => parseProject(text)).toThrow(ProjectFileError);
    expect(() => parseProject(text)).toThrow(
      'This file was saved by a newer version of Graticule (schema 2). Update Graticule to open it.',
    );
  });

  it.each([
    [{ members: [] }, 'has no schema_version'],
    [{ schema_version: '1' }, 'is not a version Graticule recognises'],
    [{ schema_version: 0 }, 'is not a version Graticule recognises'],
  ])('refuses %j', (file, message) => {
    expect(() => parseProject(JSON.stringify(file))).toThrow(message);
  });

  it('refuses text that is not JSON, or not an object', () => {
    expect(() => parseProject('{ not json')).toThrow('not valid JSON');
    expect(() => parseProject('[1, 2]')).toThrow('does not contain a Graticule project');
  });

  it('runs every step in order from an older version', () => {
    const registry: Migration[] = [
      { from: 2, to: 3, description: 'rename b to c', up: ({ b, ...rest }) => ({ ...rest, c: b }) },
      { from: 1, to: 2, description: 'add b', up: (f) => ({ ...f, b: 'added' }) },
    ];
    expect(migrate({ schema_version: 1, a: 1 }, registry, 3)).toEqual({
      schema_version: 3,
      a: 1,
      c: 'added',
    });
    expect(migrate({ schema_version: 2, a: 1, b: 'x' }, registry, 3)).toEqual({
      schema_version: 3,
      a: 1,
      c: 'x',
    });
    expect(() => migrate({ schema_version: 4 }, registry, 3)).toThrow('newer version');
  });

  it('refuses a version with no migration path', () => {
    expect(() => migrate({ schema_version: 1 }, [], 2)).toThrow('no migration is registered');
  });
});

describe('damaged files are refused, never repaired', () => {
  const mutate = (fn: (p: Record<string, unknown>) => void) => {
    const file = JSON.parse(serialiseProject(richProject())) as Record<string, unknown>;
    fn(file);
    return JSON.stringify(file);
  };
  const ties = (f: Record<string, unknown>) => f.ties as Record<string, unknown>[];

  it.each([
    [
      'a duplicate rating',
      (f: Record<string, unknown>) => ties(f).push({ ...ties(f)[0] }),
      'duplicates',
    ],
    [
      'an unknown rater',
      (f: Record<string, unknown>) => {
        (ties(f)[0] ?? {}).rater_id = 'Z';
      },
      'unknown rater_id',
    ],
    [
      'a self-rating',
      (f: Record<string, unknown>) => {
        (ties(f)[0] ?? {}).ratee_id = 'A01';
      },
      'self-rating',
    ],
    [
      'an out-of-range value',
      (f: Record<string, unknown>) => {
        (ties(f)[0] ?? {}).value = 9;
      },
      'outside',
    ],
    [
      'a missing value',
      (f: Record<string, unknown>) => {
        delete (ties(f)[0] ?? {}).value;
      },
      'Use null for a rating that was not given',
    ],
    [
      'an unknown variable',
      (f: Record<string, unknown>) => {
        (ties(f)[0] ?? {}).variable = 'x';
      },
      'unknown variable',
    ],
    [
      'an unknown manager',
      (f: Record<string, unknown>) => {
        const members = f.members as { attributes: Record<string, unknown> }[];
        const second = members[1];
        if (second) second.attributes.manager_id = 'Z';
      },
      'unknown manager id',
    ],
  ])('refuses %s', (_name, fn, message) => {
    expect(() => parseProject(mutate(fn))).toThrow(message);
  });
});
