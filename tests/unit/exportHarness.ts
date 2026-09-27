// Shared set-up for the export tests: design tokens read from tokens.css, the
// engine run directly, fonts read from src/assets/fonts, and a demo project
// with every kind of layer the signed-layer exclusion removes.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { parseProject } from '../../src/data/projectFile';
import type { Project, Tie } from '../../src/data/schema';
import { analyse } from '../../src/engine/analyse';
import { buildAnalysisInput } from '../../src/engine/input';
import { mulberry32 } from '../../src/engine/rng';
import type { AnalysisResult } from '../../src/engine/types';
import { createSurvey } from '../../src/survey/model';
import { exportContext, type ExportContext } from '../../src/ui/export/context';
import type { FontLoader, Inflate } from '../../src/ui/export/fonts';
import type { TokenSource } from '../../src/ui/export/theme';
import { effectiveWeights, initialWeightState, type WeightState } from '../../src/ui/state/presets';
import { initialMapSettings, type MapSettings } from '../../src/ui/state/store';
import { draftFor } from '../fixtures/surveyProject';

export const root = join(import.meta.dirname, '..', '..');

/** Custom properties of tokens.css, with var() references resolved (as getComputedStyle does). */
export function tokensCss(): TokenSource {
  const css = readFileSync(join(root, 'src/styles/tokens.css'), 'utf8');
  const block = /^:root\s*\{([^}]*)\}/m.exec(css)?.[1] ?? '';
  const raw = new Map(
    [...block.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [
      m[1] ?? '',
      (m[2] ?? '').trim(),
    ]),
  );
  const resolve = (value: string, depth = 0): string =>
    depth > 10
      ? value
      : value.replace(/var\((--[\w-]+)\)/g, (_, name: string) =>
          resolve(raw.get(name) ?? '', depth + 1),
        );
  return (name) => resolve(raw.get(name) ?? '');
}

export const diskFonts: FontLoader = (file) =>
  Promise.resolve(new Uint8Array(readFileSync(join(root, 'src/assets/fonts', file))));

export const nodeInflate: Inflate = (data) => Promise.resolve(new Uint8Array(inflateSync(data)));

export const methodNotes = () => readFileSync(join(root, 'docs/method-notes.md'), 'utf8');

/** Layer keys the signed-layer exclusion removes in the sensitive project. */
export const EXCLUDED_KEYS = ['valence', 'energy', 'conflict_task', 'conflict_personal'];

/**
 * The demo with energy and both conflict layers enabled and rated (seeded), a
 * member's full name in the project title, and a survey whose title names a
 * member, so tests can check that names in free text are replaced.
 */
export function sensitiveProject(): Project {
  const demo = parseProject(readFileSync(join(root, 'src/demo/demo.ona.json'), 'utf8'));
  const rnd = mulberry32(7);
  const ties: Tie[] = [...demo.ties];
  const members = demo.members;
  for (const key of ['energy', 'conflict_task', 'conflict_personal']) {
    const layer = demo.layers.find((l) => l.key === key);
    if (!layer) throw new Error(key);
    for (const a of members) {
      for (const b of members) {
        if (a.id === b.id || rnd() > 0.3) continue;
        const span = layer.max - layer.min;
        ties.push({
          rater_id: a.id,
          ratee_id: b.id,
          variable: key,
          value: layer.min + Math.floor(rnd() * (span + 1)),
          wave: 1,
          source: 'imported',
        });
      }
    }
  }
  const first = members[0]?.display_name ?? '';
  const project: Project = {
    ...demo,
    meta: { ...demo.meta, title: `Network review for ${first}` },
    layers: demo.layers.map((l) =>
      ['energy', 'conflict_task', 'conflict_personal'].includes(l.key)
        ? { ...l, enabled: true }
        : l,
    ),
    ties,
  };
  const key = {
    public_key: 'test',
    fingerprint: 'test',
    wrapped: { kdf: 'PBKDF2-SHA-256' as const, iterations: 1, salt: '', iv: '', ciphertext: '' },
  };
  const survey = createSurvey(
    { ...draftFor(project), title: `Survey led by ${first}` },
    project,
    key,
    '2026-09-27T10:00:00.000Z',
    'survey-1',
  );
  survey.log = members.slice(0, 30).map((m, i) => ({
    kind: 'accepted' as const,
    receipt: `R${String(i)}`,
    member_id: m.id,
    version: 1,
    submitted_at: '2026-09-27T11:00:00.000Z',
    imported_at: '2026-09-27T12:00:00.000Z',
    ratings: 10,
    replaced_by: null,
  }));
  return { ...project, surveys: [survey] };
}

export async function screenResult(
  project: Project,
  map: MapSettings,
  weights: WeightState,
): Promise<AnalysisResult> {
  const w = effectiveWeights(project, weights);
  return analyse(
    buildAnalysisInput(
      project,
      {
        view: map.view,
        symmetrise: map.symmetrise,
        weights: w.weights,
        signedTreatment: w.signedTreatment,
      },
      'screen',
    ),
  );
}

/** The export context for a project under both settings, with the map as on screen. */
export async function contextFor(
  project: Project,
  options: {
    anonymise: boolean;
    excludeSigned: boolean;
    map?: Partial<MapSettings>;
    weights?: WeightState;
  },
): Promise<ExportContext> {
  const map = { ...initialMapSettings(), ...options.map };
  const weights = options.weights ?? initialWeightState();
  const result = await screenResult(project, map, weights);
  return exportContext(
    {
      project,
      result,
      map,
      weights,
      anonymise: options.anonymise,
      excludeSigned: options.excludeSigned,
    },
    (input) => analyse(input),
  );
}
