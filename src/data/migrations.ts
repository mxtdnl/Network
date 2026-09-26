// Schema migrations for .ona.json project files (spec §4.3, plan §2).
//
// Each step upgrades a file from one schema version to the next. `migrate` runs
// every step from the file's version up to SCHEMA_VERSION in order. Version 1
// is the first released version, so the registry holds only an identity step:
// it runs on every load, which keeps the chain exercised until a real step
// (1 → 2) is added. Every future step must ship with a fixture file of the
// older version and a round-trip test.

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
    to: 1,
    description: 'Version 1 is current; nothing to change.',
    up: (file) => file,
  },
];

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
