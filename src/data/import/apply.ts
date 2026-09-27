// Turns validated import results into project data.

import { createProject } from '../defaults';
import { tieKey, type Project } from '../schema';
import type { MembersResult, TiesResult } from './validate';

/** A new project from an imported members file and, optionally, a ties file. */
export function projectFromImport(
  title: string,
  now: string,
  members: MembersResult,
  ties: TiesResult | null,
): Project {
  const project = createProject(title, now);
  project.attribute_definitions = members.attributes;
  project.members = members.members;
  project.ties = (ties?.ties ?? []).map((t) => ({ ...t, source: 'imported' as const }));
  return project;
}

/** Adds imported ties to an open project. Validation has already rejected any
 *  row that repeats an existing rating, so nothing is overwritten. */
export function addImportedTies(project: Project, ties: TiesResult, now: string): Project {
  const existing = new Set(
    project.ties.map((t) => tieKey(t.rater_id, t.ratee_id, t.variable, t.wave)),
  );
  const added = ties.ties
    .filter((t) => !existing.has(tieKey(t.rater_id, t.ratee_id, t.variable, t.wave)))
    .map((t) => ({ ...t, source: 'imported' as const }));
  return {
    ...project,
    meta: { ...project.meta, modified_at: now },
    ties: [...project.ties, ...added],
  };
}

export function existingTieKeys(project: Project): Set<string> {
  return new Set(project.ties.map((t) => tieKey(t.rater_id, t.ratee_id, t.variable, t.wave)));
}
