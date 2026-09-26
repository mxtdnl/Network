// Schema migrations for .ona.json project files (spec §4.3, plan §2).
//
// Each step upgrades a file from one schema version to the next. `migrate` runs
// every step from the file's version up to SCHEMA_VERSION in order. Every step
// ships with a fixture file of the older version and a round-trip test
// (tests/fixtures/migrations/, tests/unit/projectFile.test.ts).

import { SCHEMA_VERSION } from './schema';

export interface Migration {
  from: number;
  to: number;
  description: string;
  up: (file: Record<string, unknown>) => Record<string, unknown>;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    from: 1,
    to: 2,
    description:
      'Saved views take the shape of the app state they restore: weights, map settings, positions and selection (Phase 6).',
    up: (file) => ({
      ...file,
      saved_views: Array.isArray(file.saved_views)
        ? file.saved_views.map(savedViewV1toV2)
        : file.saved_views,
    }),
  },
];

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : {};
const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);

/**
 * Version 1 described saved views after docs/plan.md §2 (`analysis`, `map`
 * with a viewport and a path, `selection` as a list), before any version of
 * Graticule could create one. Each field is carried to its version 2 place;
 * fields with no counterpart (the viewport, the path) are dropped, and a
 * missing field takes the app's default. A view that is not an object is left
 * as it is, so the file check reports it.
 */
export function savedViewV1toV2(view: unknown): unknown {
  if (typeof view !== 'object' || view === null || Array.isArray(view)) return view;
  const v = view as Obj;
  const analysis = obj(v.analysis);
  const map = obj(v.map);
  const positions: Record<string, { x: number; y: number; pinned: boolean }> = {};
  for (const [id, p] of Object.entries(obj(map.positions))) {
    const q = obj(p);
    if (typeof q.x === 'number' && typeof q.y === 'number') {
      positions[id] = { x: q.x, y: q.y, pinned: q.pinned === true };
    }
  }
  const ego = obj(map.egoView);
  return {
    id: v.id,
    name: v.name,
    caption: v.caption,
    created_at: v.created_at,
    weights: {
      preset: str(analysis.preset, 'custom'),
      custom: obj(analysis.weights),
      customTreatment: obj(analysis.signedTreatment),
    },
    map: {
      view: str(analysis.view, 'directed'),
      symmetrise: str(analysis.symmetrise, 'mean'),
      layer: str(analysis.activeLayer, 'composite'),
      sizeMetric: str(analysis.nodeSizeMetric, 'betweenness'),
      fill: analysis.nodeFill ?? { kind: 'community' },
      threshold: typeof map.threshold === 'number' ? map.threshold : 0,
      layerToggles: obj(map.layerToggles),
      hideOffLayers: false,
      filters: Array.isArray(map.filters) ? map.filters : [],
      layout: str(map.layout, 'force'),
      groupBy: typeof map.groupBy === 'string' ? map.groupBy : null,
      ego:
        typeof ego.member === 'string'
          ? { member: ego.member, depth: ego.depth === 2 ? 2 : 1 }
          : null,
      highlight: [],
    },
    positions,
    selection: {
      member: null,
      group: Array.isArray(v.selection) ? v.selection : [],
    },
  };
}

export class ProjectFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectFileError';
  }
}

export function readSchemaVersion(file: Record<string, unknown>): number {
  const version = file.schema_version;
  if (version === undefined) {
    throw new ProjectFileError(
      'This file has no schema_version, so it is not a Graticule project file. Open a file saved by Graticule (.ona.json).',
    );
  }
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new ProjectFileError(
      `This file’s schema_version (${JSON.stringify(version)}) is not a version Graticule recognises. Open a file saved by Graticule (.ona.json).`,
    );
  }
  return version;
}

/**
 * Upgrades a parsed project file to `target`. Refuses files written by a newer
 * version, because fields it does not know about would be lost on save.
 */
export function migrate(
  file: Record<string, unknown>,
  registry: readonly Migration[] = MIGRATIONS,
  target: number = SCHEMA_VERSION,
): Record<string, unknown> {
  let version = readSchemaVersion(file);
  if (version > target) {
    throw new ProjectFileError(
      `This file was saved by a newer version of Graticule (schema ${String(version)}). Update Graticule to open it. This version reads schema ${String(target)} and earlier.`,
    );
  }
  let current = file;
  for (const step of [...registry].sort((a, b) => a.from - b.from)) {
    if (step.from !== version || step.to > target) continue;
    current = { ...step.up(current), schema_version: step.to };
    version = step.to;
  }
  if (version !== target) {
    throw new ProjectFileError(
      `Graticule cannot upgrade this file from schema ${String(version)} to schema ${String(target)}: no migration is registered for it.`,
    );
  }
  return current;
}
