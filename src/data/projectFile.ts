// Reading and writing .ona.json project files (spec §4.3).
//
// `serialiseProject` writes every field; `parseProject` reads JSON, migrates it
// to the current schema and checks it strictly. A file that breaks any rule is
// refused as a whole, with the problems listed: nothing is dropped, merged or
// repaired on load.

import { migrate, ProjectFileError } from './migrations';
import {
  isCategorical,
  PROJECT_FILE_EXTENSION,
  tieKey,
  type LayerDefinition,
  type Project,
} from './schema';

export { ProjectFileError } from './migrations';

export function serialiseProject(project: Project): string {
  return `${JSON.stringify(project, null, 2)}\n`;
}

export function projectFileName(project: Project): string {
  const slug = project.meta.title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');
  return `${slug || 'project'}${PROJECT_FILE_EXTENSION}`;
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
const isStrRecord = (v: unknown): v is Record<string, string> =>
  isObj(v) && Object.values(v).every(isStr);

const SCALE_TYPES = new Set(['strength', 'frequency', 'signed', 'categorical']);
const ATTRIBUTE_TYPES = new Set(['categorical', 'ordinal', 'member_ref']);

/** Lists every structural problem in a migrated project file. Empty when valid. */
export function checkProject(file: Obj): string[] {
  const problems: string[] = [];
  const need = (ok: boolean, message: string) => {
    if (!ok) problems.push(message);
  };

  need(file.schema_version === 1, 'schema_version must be 1.');
  const app = file.app;
  need(
    isObj(app) && app.name === 'Graticule' && isStr(app.version),
    'app must name Graticule and a version.',
  );
  const meta = file.meta;
  need(
    isObj(meta) &&
      isStr(meta.title) &&
      isStr(meta.created_at) &&
      isStr(meta.modified_at) &&
      isStr(meta.notes),
    'meta must have a title, created_at, modified_at and notes.',
  );

  // Attribute definitions
  const attributeKeys = new Set<string>();
  const attrs = file.attribute_definitions;
  if (!Array.isArray(attrs)) problems.push('attribute_definitions must be a list.');
  else
    attrs.forEach((a: unknown, i) => {
      const at = `Attribute definition ${String(i + 1)}`;
      if (!isObj(a) || !isStr(a.key) || a.key === '') {
        problems.push(`${at} has no key.`);
        return;
      }
      need(!attributeKeys.has(a.key), `${at} repeats the key “${a.key}”.`);
      attributeKeys.add(a.key);
      need(isStr(a.label), `${at} (${a.key}) has no label.`);
      need(ATTRIBUTE_TYPES.has(a.type as string), `${at} (${a.key}) has an unknown type.`);
      need(a.categories === undefined || isStrArray(a.categories), `${at} has invalid categories.`);
      need(isBool(a.builtin), `${at} (${a.key}) must say whether it is built in.`);
    });

  // Members
  const memberIds = new Set<string>();
  const managerRefs: [number, string][] = [];
  const members = file.members;
  if (!Array.isArray(members)) problems.push('members must be a list.');
  else
    members.forEach((m: unknown, i) => {
      const at = `Member ${String(i + 1)}`;
      if (!isObj(m) || !isStr(m.id) || m.id === '') {
        problems.push(`${at} has no id.`);
        return;
      }
      need(!memberIds.has(m.id), `${at} repeats the id “${m.id}”.`);
      memberIds.add(m.id);
      need(isStr(m.display_name), `${at} (${m.id}) has no display_name.`);
      if (!isObj(m.attributes)) {
        problems.push(`${at} (${m.id}) has no attributes object.`);
        return;
      }
      for (const [key, value] of Object.entries(m.attributes)) {
        need(attributeKeys.has(key), `${at} (${m.id}) has an undefined attribute “${key}”.`);
        need(
          value === null || isStr(value),
          `${at} (${m.id}) attribute “${key}” must be text or null.`,
        );
        if (key === 'manager_id' && isStr(value)) managerRefs.push([i, value]);
      }
    });
  for (const [i, ref] of managerRefs) {
    need(memberIds.has(ref), `Member ${String(i + 1)} has an unknown manager id “${ref}”.`);
  }

  // Layers
  const layers = new Map<string, Obj>();
  const layerList = file.layers;
  if (!Array.isArray(layerList)) problems.push('layers must be a list.');
  else
    layerList.forEach((l: unknown, i) => {
      const at = `Layer ${String(i + 1)}`;
      if (!isObj(l) || !isStr(l.key) || l.key === '') {
        problems.push(`${at} has no key.`);
        return;
      }
      const name = `${at} (${l.key})`;
      need(!layers.has(l.key), `${at} repeats the key “${l.key}”.`);
      layers.set(l.key, l);
      need(isStr(l.label), `${name} has no label.`);
      need(isStr(l.question_wording), `${name} has no question_wording.`);
      need(SCALE_TYPES.has(l.scale_type as string), `${name} has an unknown scale_type.`);
      need(isNum(l.min) && isNum(l.max), `${name} must have numeric min and max.`);
      if (l.scale_type === 'categorical') {
        need(
          isStrArray(l.categories) && l.categories.length > 0,
          `${name} is categorical but lists no categories.`,
        );
      } else {
        need(isNum(l.min) && isNum(l.max) && l.min < l.max, `${name} needs min below max.`);
      }
      for (const flag of ['signed', 'enabled', 'core', 'builtin'] as const) {
        need(isBool(l[flag]), `${name} must have ${flag} set to true or false.`);
      }
      need(isNum(l.default_weight) && l.default_weight >= 0, `${name} has an invalid weight.`);
      need(
        l.scale_labels === undefined || isStrRecord(l.scale_labels),
        `${name} has invalid scale_labels.`,
      );
      need(
        l.category_labels === undefined || isStrRecord(l.category_labels),
        `${name} has invalid category_labels.`,
      );
      need(l.group === undefined || isStr(l.group), `${name} has an invalid group.`);
      need(
        l.role === undefined || l.role === 'formal' || l.role === 'informal',
        `${name} has an invalid role.`,
      );
    });

  // Ties
  const tieKeys = new Set<string>();
  const ties = file.ties;
  if (!Array.isArray(ties)) problems.push('ties must be a list.');
  else
    ties.forEach((t: unknown, i) => {
      const at = `Tie ${String(i + 1)}`;
      if (!isObj(t)) {
        problems.push(`${at} is not an object.`);
        return;
      }
      const { rater_id: rater, ratee_id: ratee, variable, value, wave } = t;
      if (!isStr(rater) || !memberIds.has(rater)) {
        problems.push(`${at} has an unknown rater_id ${JSON.stringify(rater)}.`);
      }
      if (!isStr(ratee) || !memberIds.has(ratee)) {
        problems.push(`${at} has an unknown ratee_id ${JSON.stringify(ratee)}.`);
      }
      need(rater !== ratee, `${at} is a self-rating (${String(rater)}).`);
      const layer = isStr(variable) ? layers.get(variable) : undefined;
      need(layer !== undefined, `${at} has an unknown variable ${JSON.stringify(variable)}.`);
      need(
        isNum(wave) && Number.isInteger(wave) && wave >= 1,
        `${at} must have a whole-number wave of 1 or more.`,
      );
      if (!('value' in t)) {
        problems.push(`${at} has no value. Use null for a rating that was not given.`);
      } else if (value !== null && layer) {
        const def = layer as unknown as LayerDefinition;
        if (isCategorical(def)) {
          need(
            isStr(value) && (def.categories ?? []).includes(value),
            `${at} value ${JSON.stringify(value)} is not a category of ${def.key}.`,
          );
        } else {
          need(
            isNum(value) && value >= def.min && value <= def.max,
            `${at} value ${JSON.stringify(value)} is outside ${def.key}’s range ${String(def.min)} to ${String(def.max)}.`,
          );
        }
      }
      if (isStr(rater) && isStr(ratee) && isStr(variable) && isNum(wave)) {
        const key = tieKey(rater, ratee, variable, wave);
        need(!tieKeys.has(key), `${at} duplicates an earlier rating of ${ratee} by ${rater}.`);
        tieKeys.add(key);
      }
    });

  // Saved views: checked for shape here; their contents gain behaviour in later phases.
  const views = file.saved_views;
  if (!Array.isArray(views)) problems.push('saved_views must be a list.');
  else
    views.forEach((v: unknown, i) => {
      const at = `Saved view ${String(i + 1)}`;
      need(
        isObj(v) &&
          isStr(v.id) &&
          isStr(v.name) &&
          isStr(v.caption) &&
          isStr(v.created_at) &&
          isObj(v.analysis) &&
          isObj(v.map) &&
          isStrArray(v.selection),
        `${at} must have an id, name, caption, created_at, analysis, map and selection.`,
      );
    });

  const s = file.settings;
  if (!isObj(s)) problems.push('settings must be an object.');
  else {
    need(
      isNum(s.coverage_threshold) && s.coverage_threshold >= 0 && s.coverage_threshold <= 1,
      'settings.coverage_threshold must be between 0 and 1.',
    );
    need(isBool(s.anonymise), 'settings.anonymise must be true or false.');
    need(
      isBool(s.exclude_signed_from_exports),
      'settings.exclude_signed_from_exports must be true or false.',
    );
    need(
      isNum(s.random_seed) && Number.isInteger(s.random_seed),
      'settings.random_seed must be a whole number.',
    );
    need(
      isObj(s.bootstrap) && isNum(s.bootstrap.replicates) && isNum(s.bootstrap.drop_fraction),
      'settings.bootstrap must have replicates and drop_fraction.',
    );
    need(
      s.anonymisation_scheme === 'role_team',
      'settings.anonymisation_scheme must be role_team.',
    );
  }

  return problems;
}

const SHOWN_PROBLEMS = 3;

/** Parses the text of an .ona.json file. Throws ProjectFileError with a message for the user. */
export function parseProject(text: string): Project {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ProjectFileError(
      'This file is not valid JSON, so it cannot be a Graticule project. Open a file saved by Graticule (.ona.json).',
    );
  }
  if (!isObj(json)) {
    throw new ProjectFileError(
      'This file does not contain a Graticule project. Open a file saved by Graticule (.ona.json).',
    );
  }
  const migrated = migrate(json);
  const problems = checkProject(migrated);
  if (problems.length > 0) {
    const shown = problems.slice(0, SHOWN_PROBLEMS).join(' ');
    const more =
      problems.length > SHOWN_PROBLEMS
        ? ` There are ${String(problems.length - SHOWN_PROBLEMS)} more problems.`
        : '';
    throw new ProjectFileError(
      `This project file is damaged or was edited by hand, so it was not opened. ${shown}${more}`,
    );
  }
  return migrated as unknown as Project;
}
