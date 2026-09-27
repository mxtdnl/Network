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
  SCHEMA_VERSION,
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
const ATTRIBUTE_TYPES = new Set(['categorical', 'ordinal', 'member_ref', 'email']);
const TIE_SOURCES = new Set(['self_report', 'imported', 'entered']);

/** Lists every structural problem in a migrated project file. Empty when valid. */
export function checkProject(file: Obj): string[] {
  const problems: string[] = [];
  const need = (ok: boolean, message: string) => {
    if (!ok) problems.push(message);
  };

  need(file.schema_version === SCHEMA_VERSION, `schema_version must be ${String(SCHEMA_VERSION)}.`);
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
      need(
        a.shareable === undefined || isBool(a.shareable),
        `${at} (${a.key}) has an invalid shareable flag.`,
      );
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
      need(
        t.source === undefined || TIE_SOURCES.has(t.source as string),
        `${at} has an unknown source ${JSON.stringify(t.source)}.`,
      );
      need(
        t.survey === undefined ||
          (isObj(t.survey) && isStr(t.survey.id) && isNum(t.survey.version)),
        `${at} has an invalid survey reference.`,
      );
      if (isStr(rater) && isStr(ratee) && isStr(variable) && isNum(wave)) {
        const key = tieKey(rater, ratee, variable, wave);
        need(!tieKeys.has(key), `${at} duplicates an earlier rating of ${ratee} by ${rater}.`);
        tieKeys.add(key);
      }
    });

  // Saved views: every field is checked, so a restored view never meets a
  // value the app cannot show. Member ids that are no longer in the project
  // are allowed and ignored when the view is restored.
  const views = file.saved_views;
  const viewIds = new Set<string>();
  if (!Array.isArray(views)) problems.push('saved_views must be a list.');
  else
    views.forEach((v: unknown, i) => {
      const at = `Saved view ${String(i + 1)}`;
      if (!isObj(v) || !isStr(v.id) || v.id === '') {
        problems.push(`${at} has no id.`);
        return;
      }
      need(!viewIds.has(v.id), `${at} repeats the id “${v.id}”.`);
      viewIds.add(v.id);
      for (const problem of checkSavedView(v))
        problems.push(`${at} (${v.name as string}) ${problem}`);
    });

  const surveys = file.surveys;
  const surveyIds = new Set<string>();
  if (!Array.isArray(surveys)) problems.push('surveys must be a list.');
  else
    surveys.forEach((v: unknown, i) => {
      const at = `Survey ${String(i + 1)}`;
      if (!isObj(v) || !isStr(v.id) || v.id === '') {
        problems.push(`${at} has no id.`);
        return;
      }
      need(!surveyIds.has(v.id), `${at} repeats the id “${v.id}”.`);
      surveyIds.add(v.id);
      for (const problem of checkSurvey(v)) problems.push(`${at} (${v.id}) ${problem}`);
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

const LAYOUTS = new Set(['force', 'grouped', 'circular', 'hierarchy']);
const PRESETS = new Set(['formal', 'informal', 'health', 'custom']);
const TREATMENTS = new Set(['positive', 'filterNegative', 'multiplier']);
const isNumRecord = (v: unknown): v is Record<string, number> =>
  isObj(v) && Object.values(v).every(isNum);
const isNullableStr = (v: unknown) => v === null || isStr(v);

/** Problems with one saved view (schema version 2), each a sentence ending. */
export function checkSavedView(v: Obj): string[] {
  const problems: string[] = [];
  const need = (ok: boolean, message: string) => {
    if (!ok) problems.push(message);
  };
  need(isStr(v.name) && v.name.trim() !== '', 'has no name.');
  need(isStr(v.caption), 'has no caption text.');
  need(isStr(v.created_at), 'has no created_at.');

  const w = v.weights;
  need(
    isObj(w) &&
      PRESETS.has(w.preset as string) &&
      isNumRecord(w.custom) &&
      isObj(w.customTreatment) &&
      Object.values(w.customTreatment).every((t) => TREATMENTS.has(t as string)),
    'has invalid weights.',
  );

  const m = v.map;
  if (!isObj(m)) {
    problems.push('has no map settings.');
  } else {
    need(m.view === 'directed' || m.view === 'symmetrised', 'has an unknown view.');
    need(['mean', 'min', 'max'].includes(m.symmetrise as string), 'has an unknown rule.');
    need(isStr(m.layer) && isStr(m.sizeMetric), 'has no layer or node-size metric.');
    const fill = m.fill;
    need(
      isObj(fill) && (fill.kind === 'community' || (fill.kind === 'attribute' && isStr(fill.key))),
      'has an invalid node fill.',
    );
    need(isNum(m.threshold) && m.threshold >= 0 && m.threshold <= 1, 'has an invalid threshold.');
    need(
      isObj(m.layerToggles) && Object.values(m.layerToggles).every(isBool),
      'has invalid layer toggles.',
    );
    need(isBool(m.hideOffLayers), 'must say whether switched-off layers hide their ties.');
    need(
      Array.isArray(m.filters) &&
        m.filters.every((f: unknown) => isObj(f) && isStr(f.key) && isStrArray(f.values)),
      'has invalid filters.',
    );
    need(LAYOUTS.has(m.layout as string), 'has an unknown layout.');
    need(isNullableStr(m.groupBy), 'has an invalid grouping attribute.');
    const ego = m.ego;
    need(
      ego === null || (isObj(ego) && isStr(ego.member) && (ego.depth === 1 || ego.depth === 2)),
      'has an invalid ego view.',
    );
    need(isStrArray(m.highlight), 'has an invalid highlight.');
  }

  const positions = v.positions;
  need(
    isObj(positions) &&
      Object.values(positions).every(
        (p) => isObj(p) && isNum(p.x) && isNum(p.y) && isBool(p.pinned),
      ),
    'has invalid positions.',
  );
  const sel = v.selection;
  need(
    isObj(sel) && isNullableStr(sel.member) && isStrArray(sel.group),
    'has an invalid selection.',
  );
  return problems;
}

const ENTRIES = new Set(['nominate', 'full']);
const UNSELECTED = new Set(['zero', 'not_rated']);
const REJECT_REASONS = new Set([
  'unreadable',
  'other_survey',
  'other_key',
  'tampered',
  'unknown_version',
  'unknown_token',
  'token_mismatch',
  'already_imported',
  'closed',
]);
const isInt = (v: unknown): v is number => isNum(v) && Number.isInteger(v);

/**
 * Problems with one survey (schema version 3), each a sentence ending. Roster
 * members may since have left the project; responses naming them are reported
 * on import, so they are allowed here.
 */
export function checkSurvey(v: Obj): string[] {
  const problems: string[] = [];
  const need = (ok: boolean, message: string) => {
    if (!ok) problems.push(message);
  };
  need(isStr(v.title), 'has no title.');
  need(isStr(v.created_at), 'has no created_at.');
  need(v.status === 'open' || v.status === 'closed', 'has an unknown status.');
  need(isInt(v.wave) && v.wave >= 1, 'must have a whole-number wave of 1 or more.');
  const t = v.texts;
  need(
    isObj(t) && isStr(t.introduction) && isStr(t.confidentiality) && isStr(t.return_instructions),
    'has invalid texts.',
  );
  need(
    v.deadline === null || (isStr(v.deadline) && /^\d{4}-\d{2}-\d{2}$/.test(v.deadline)),
    'has an invalid deadline.',
  );
  const st = v.settings;
  need(
    isObj(st) &&
      isNum(st.burden_limit_minutes) &&
      st.burden_limit_minutes > 0 &&
      isInt(st.expected_nominations) &&
      st.expected_nominations >= 0 &&
      (st.link_mode === 'auto' || st.link_mode === 'package'),
    'has invalid settings.',
  );
  const k = v.key;
  const w = isObj(k) ? k.wrapped : undefined;
  need(
    isObj(k) &&
      isStr(k.public_key) &&
      isStr(k.fingerprint) &&
      isObj(w) &&
      w.kdf === 'PBKDF2-SHA-256' &&
      isInt(w.iterations) &&
      isStr(w.salt) &&
      isStr(w.iv) &&
      isStr(w.ciphertext),
    'has an invalid key.',
  );
  const versions = new Set<number>();
  if (!Array.isArray(v.versions) || v.versions.length === 0) {
    problems.push('has no versions.');
  } else
    v.versions.forEach((ver: unknown, i) => {
      const at = `version entry ${String(i + 1)}`;
      if (!isObj(ver) || !isInt(ver.version) || ver.version < 1) {
        problems.push(`has an invalid ${at}.`);
        return;
      }
      need(!versions.has(ver.version), `repeats version ${String(ver.version)}.`);
      versions.add(ver.version);
      need(isStr(ver.created_at), `${at} has no created_at.`);
      need(
        isStrArray(ver.roster) && ver.roster.length >= 2,
        `${at} needs a roster of two or more.`,
      );
      need(ENTRIES.has(ver.entry as string), `${at} has an unknown entry method.`);
      need(isStr(ver.nomination_question), `${at} has no nomination question.`);
      need(isStrArray(ver.shared_attributes), `${at} has invalid shared attributes.`);
      need(
        Array.isArray(ver.layers) &&
          ver.layers.length > 0 &&
          ver.layers.every(
            (l: unknown) =>
              isObj(l) &&
              isStr(l.key) &&
              isStr(l.label) &&
              isStr(l.question_wording) &&
              SCALE_TYPES.has(l.scale_type as string) &&
              isNum(l.min) &&
              isNum(l.max) &&
              isBool(l.signed) &&
              UNSELECTED.has(l.unselected as string) &&
              (l.scale_labels === undefined || isStrRecord(l.scale_labels)) &&
              (l.categories === undefined || isStrArray(l.categories)) &&
              (l.category_labels === undefined || isStrRecord(l.category_labels)),
          ),
        `${at} has invalid layers.`,
      );
    });
  const tokens = new Set<string>();
  const respondents = new Set<string>();
  if (!Array.isArray(v.respondents)) problems.push('has no respondent list.');
  else
    v.respondents.forEach((r: unknown, i) => {
      const at = `respondent ${String(i + 1)}`;
      if (!isObj(r) || !isStr(r.member_id) || !isStr(r.token) || r.token === '') {
        problems.push(`has an invalid ${at}.`);
        return;
      }
      need(!tokens.has(r.token), `issues the same token twice.`);
      tokens.add(r.token);
      need(!respondents.has(r.member_id), `lists ${r.member_id} twice.`);
      respondents.add(r.member_id);
      need(isInt(r.version) && versions.has(r.version), `${at} names an unknown version.`);
      need(isStr(r.issued_at), `${at} has no issued_at.`);
    });
  if (!Array.isArray(v.log)) problems.push('has no import log.');
  else
    v.log.forEach((e: unknown, i) => {
      const at = `log entry ${String(i + 1)}`;
      const ok =
        isObj(e) &&
        isStr(e.imported_at) &&
        ((e.kind === 'accepted' &&
          isStr(e.receipt) &&
          isStr(e.member_id) &&
          isInt(e.version) &&
          isStr(e.submitted_at) &&
          isInt(e.ratings) &&
          isNullableStr(e.replaced_by)) ||
          (e.kind === 'duplicate' && isStr(e.member_id) && isStr(e.kept) && isStr(e.set_aside)) ||
          (e.kind === 'rejected' &&
            isStr(e.source) &&
            isNullableStr(e.receipt) &&
            REJECT_REASONS.has(e.reason as string)));
      need(ok, `has an invalid ${at}.`);
    });
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
