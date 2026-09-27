// Survey setup and administration (spec §15.1, §15.3): drafts, versions,
// tokens, the completion-time estimate, and the links and packages built from
// a project. Pure apart from randomness and hashing.

import { isCategorical } from '../data/schema';
import type {
  AttributeDefinition,
  LayerDefinition,
  MemberId,
  Project,
  Survey,
  SurveyEntry,
  SurveyKey,
  SurveyLayer,
  SurveySettings,
  SurveyTexts,
  SurveyVersion,
} from '../data/schema';
import { randomBytes, toBase64Url } from './bytes';
import { LINK_BUDGET, makePackage, packageLink, personalLink, type SurveyPayload } from './payload';

// Completion-time estimate (CLAUDE.md Q31, approved as proposed). Conventions,
// not measurements; docs/method-notes.md §9 states them.
export const ESTIMATE = {
  overheadSeconds: 60,
  secondsPerRating: 5,
  secondsPerNominationScan: 2,
} as const;

export const DEFAULT_SURVEY_SETTINGS: SurveySettings = {
  burden_limit_minutes: 15,
  expected_nominations: 12,
  link_mode: 'auto',
};

/** With selection, the respondent rates the larger of the expected selections
 *  and the required colleagues (who are usually among those selected). */
export function estimateSeconds(
  rosterSize: number,
  layerCount: number,
  entry: SurveyEntry,
  expectedNominations: number,
  requiredCount = 0,
): number {
  const colleagues = Math.max(0, rosterSize - 1);
  const rated =
    entry === 'nominate'
      ? Math.min(colleagues, Math.max(expectedNominations, requiredCount))
      : colleagues;
  const scan = entry === 'nominate' ? colleagues * ESTIMATE.secondsPerNominationScan : 0;
  return ESTIMATE.overheadSeconds + scan + rated * layerCount * ESTIMATE.secondsPerRating;
}

export const estimateMinutes = (seconds: number) => Math.max(1, Math.ceil(seconds / 60));

/** What the analyst edits before creating a survey or a new version. */
export interface SurveyDraft {
  title: string;
  layers: SurveyLayer[];
  entry: SurveyEntry;
  nominationQuestion: string;
  texts: SurveyTexts;
  deadline: string | null;
  wave: number;
  settings: SurveySettings;
  sharedAttributes: string[];
  /** Colleagues every respondent is asked about, selected or not (D103). */
  required: MemberId[];
}

export const DEFAULT_NOMINATION_QUESTION = 'Select everyone you have a working relationship with.';

/** A survey layer from a project layer. Colleagues not selected: 0 on unsigned
 *  layers, "does not apply" on signed and categorical ones (D88, D102). Signed
 *  layers offer "Does not apply" as an answer, because their 0 means neutral. */
export function surveyLayerFrom(layer: LayerDefinition): SurveyLayer {
  return {
    key: layer.key,
    label: layer.label,
    question_wording: layer.question_wording,
    scale_type: layer.scale_type,
    min: layer.min,
    max: layer.max,
    signed: layer.signed,
    ...(layer.scale_labels ? { scale_labels: { ...layer.scale_labels } } : {}),
    ...(layer.categories ? { categories: [...layer.categories] } : {}),
    ...(layer.category_labels ? { category_labels: { ...layer.category_labels } } : {}),
    unselected: layer.signed || isCategorical(layer) ? 'not_applicable' : 'zero',
    offer_not_applicable: layer.signed,
  };
}

export function draftProblems(draft: SurveyDraft, project: Project): string[] {
  const problems: string[] = [];
  if (draft.title.trim() === '') problems.push('title');
  if (draft.layers.length === 0) problems.push('layers');
  if (draft.layers.some((l) => l.question_wording.trim() === '' || l.label.trim() === ''))
    problems.push('wording');
  if (draft.texts.introduction.trim() === '') problems.push('introduction');
  if (draft.texts.confidentiality.trim() === '') problems.push('confidentiality');
  if (draft.texts.return_instructions.trim() === '') problems.push('returnInstructions');
  if (draft.entry === 'nominate' && draft.nominationQuestion.trim() === '')
    problems.push('nominationQuestion');
  if (project.members.length < 2) problems.push('roster');
  if (!Number.isInteger(draft.wave) || draft.wave < 1) problems.push('wave');
  return problems;
}

export const newSurveyId = () => toBase64Url(randomBytes(8));
export const newToken = () => toBase64Url(randomBytes(16));

function versionFrom(
  draft: SurveyDraft,
  project: Project,
  version: number,
  now: string,
): SurveyVersion {
  return {
    version,
    created_at: now,
    roster: project.members.map((m) => m.id),
    layers: draft.layers.map((l) => ({ ...l })),
    entry: draft.entry,
    nomination_question: draft.nominationQuestion,
    shared_attributes: [...draft.sharedAttributes],
    // Only members on the roster, in roster order; meaningless for a full roster.
    required:
      draft.entry === 'nominate'
        ? project.members.map((m) => m.id).filter((id) => draft.required.includes(id))
        : [],
  };
}

/** A new survey, version 1, with a token issued to every member. */
export function createSurvey(
  draft: SurveyDraft,
  project: Project,
  key: SurveyKey,
  now: string,
  id = newSurveyId(),
): Survey {
  const version = versionFrom(draft, project, 1, now);
  return {
    id,
    title: draft.title.trim(),
    created_at: now,
    status: 'open',
    wave: draft.wave,
    texts: { ...draft.texts },
    deadline: draft.deadline,
    settings: { ...draft.settings },
    key,
    versions: [version],
    respondents: version.roster.map((member_id) => ({
      member_id,
      token: newToken(),
      version: 1,
      issued_at: now,
    })),
    log: [],
  };
}

export function currentVersion(s: Survey): SurveyVersion {
  const v = s.versions.at(-1);
  if (!v) throw new Error('A survey always has a version.');
  return v;
}

export function draftFromSurvey(s: Survey): SurveyDraft {
  const v = currentVersion(s);
  return {
    title: s.title,
    layers: v.layers.map((l) => ({ ...l })),
    entry: v.entry,
    nominationQuestion: v.nomination_question,
    texts: { ...s.texts },
    deadline: s.deadline,
    wave: s.wave,
    settings: { ...s.settings },
    sharedAttributes: [...v.shared_attributes],
    required: [...v.required],
  };
}

/** True when the draft changes what respondents are asked, or whom (spec §15.1). */
export function needsNewVersion(s: Survey, draft: SurveyDraft, project: Project): boolean {
  const v = currentVersion(s);
  const roster = project.members.map((m) => m.id);
  return (
    JSON.stringify(v.roster) !== JSON.stringify(roster) ||
    JSON.stringify(v.layers) !== JSON.stringify(draft.layers) ||
    v.entry !== draft.entry ||
    v.nomination_question !== draft.nominationQuestion ||
    JSON.stringify(v.shared_attributes) !== JSON.stringify(draft.sharedAttributes) ||
    JSON.stringify(v.required) !==
      JSON.stringify(versionFrom(draft, project, v.version, v.created_at).required)
  );
}

/**
 * Applies a draft. Texts, deadline and settings change in place; a change to
 * the roster, layers, entry method or shared attributes adds a version.
 * `issue` says who gets a link for the new version: everyone on its roster, or
 * only members with no link yet. Earlier links stay valid for their version.
 */
export function updateSurvey(
  s: Survey,
  draft: SurveyDraft,
  project: Project,
  now: string,
  issue: 'all' | 'new' = 'all',
): Survey {
  const base: Survey = {
    ...s,
    title: draft.title.trim(),
    texts: { ...draft.texts },
    deadline: draft.deadline,
    settings: { ...draft.settings },
    wave: draft.wave,
  };
  if (!needsNewVersion(s, draft, project)) return base;
  const version = versionFrom(draft, project, currentVersion(s).version + 1, now);
  const known = new Map(s.respondents.map((r) => [r.member_id, r]));
  const respondents = [...s.respondents];
  for (const id of version.roster) {
    const existing = known.get(id);
    if (!existing) {
      respondents.push({
        member_id: id,
        token: newToken(),
        version: version.version,
        issued_at: now,
      });
    } else if (issue === 'all') {
      const i = respondents.indexOf(existing);
      respondents[i] = { ...existing, version: version.version, issued_at: now };
    }
  }
  return { ...base, versions: [...s.versions, version], respondents };
}

/** The payload respondents of `version` receive. Names come from the project
 *  as it is now; a member no longer in the project is shown by id. */
export function payloadFor(s: Survey, version: SurveyVersion, project: Project): SurveyPayload {
  const members = new Map(project.members.map((m) => [m.id, m]));
  const attrDefs = version.shared_attributes
    .map((k) => project.attribute_definitions.find((a) => a.key === k))
    .filter((a): a is AttributeDefinition => a !== undefined && a.type !== 'email');
  const expected = s.settings.expected_nominations;
  return {
    surveyId: s.id,
    version: version.version,
    title: s.title,
    roster: version.roster.map((id) => {
      const m = members.get(id);
      return {
        name: m?.display_name ?? id,
        attributes: attrDefs.map((a) => m?.attributes[a.key] ?? null),
      };
    }),
    attributeLabels: attrDefs.map((a) => a.label),
    layers: version.layers,
    entry: version.entry,
    nominationQuestion: version.nomination_question,
    texts: s.texts,
    deadline: s.deadline,
    required: version.required.map((id) => version.roster.indexOf(id)).filter((i) => i >= 0),
    estimateMinutes: estimateMinutes(
      estimateSeconds(
        version.roster.length,
        version.layers.length,
        version.entry,
        expected,
        version.required.length,
      ),
    ),
    publicKey: s.key.public_key,
    keyFingerprint: s.key.fingerprint,
  };
}

export interface IssuedLink {
  memberId: MemberId;
  version: number;
  url: string;
  /** True when the link needs the survey package. */
  package: boolean;
}

export interface SurveyLinks {
  links: IssuedLink[];
  /** Package file per version, present when any link of that version needs one. */
  packages: Map<number, { text: string; fileName: string }>;
  /** Longest full link that would have been issued, for the budget note. */
  longestFullLink: number;
}

export const packageFileName = (s: Survey, version: number) =>
  `graticule-survey-${s.id}-v${String(version)}.graticule-survey`;

/**
 * Every respondent's link. Under 'auto', a version whose longest full link is
 * within the budget gets full links; otherwise, or under 'package', the version
 * gets a package and short links.
 */
export async function buildLinks(s: Survey, project: Project, base: string): Promise<SurveyLinks> {
  const links: IssuedLink[] = [];
  const packages = new Map<number, { text: string; fileName: string }>();
  let longestFullLink = 0;
  for (const version of s.versions) {
    const holders = s.respondents.filter((r) => r.version === version.version);
    if (holders.length === 0) continue;
    const payload = payloadFor(s, version, project);
    const position = new Map(version.roster.map((id, i) => [id, i]));
    const full: IssuedLink[] = [];
    for (const r of holders) {
      const p = position.get(r.member_id);
      if (p === undefined) continue;
      const url = await personalLink(base, payload, { position: p, token: r.token });
      longestFullLink = Math.max(longestFullLink, url.length);
      full.push({ memberId: r.member_id, version: version.version, url, package: false });
    }
    const overBudget = full.some((l) => l.url.length > LINK_BUDGET);
    if (s.settings.link_mode === 'package' || overBudget) {
      const pkg = await makePackage(payload);
      packages.set(version.version, {
        text: pkg.text,
        fileName: packageFileName(s, version.version),
      });
      for (const r of holders) {
        const p = position.get(r.member_id);
        if (p === undefined) continue;
        links.push({
          memberId: r.member_id,
          version: version.version,
          url: packageLink(base, s.id, { position: p, token: r.token }, pkg.fingerprint),
          package: true,
        });
      }
    } else links.push(...full);
  }
  return { links, packages, longestFullLink };
}

/** Members with an accepted response that has not been replaced. */
export function responders(s: Survey): Set<MemberId> {
  const out = new Set<MemberId>();
  for (const e of s.log) if (e.kind === 'accepted' && e.replaced_by === null) out.add(e.member_id);
  return out;
}

export interface SurveyStatus {
  issued: number;
  responded: number;
  rate: number;
  nonResponders: MemberId[];
  duplicates: number;
  rejected: Extract<Survey['log'][number], { kind: 'rejected' }>[];
}

export function surveyStatus(s: Survey): SurveyStatus {
  const done = responders(s);
  const issued = s.respondents.length;
  return {
    issued,
    responded: done.size,
    rate: issued === 0 ? 0 : done.size / issued,
    nonResponders: s.respondents.map((r) => r.member_id).filter((id) => !done.has(id)),
    duplicates: s.log.filter((e) => e.kind === 'duplicate').length,
    rejected: s.log.filter((e) => e.kind === 'rejected'),
  };
}

// RFC 4180 CSV with a byte-order mark and CRLF, as the metrics table export.
function csv(rows: string[][]): string {
  const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return `\uFEFF${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}

/** Name, email if recorded, and link, for mail merge (spec §15.3). These files
 *  identify people by design and are exempt from anonymisation (spec §11). */
export function linksCsv(
  project: Project,
  links: readonly IssuedLink[],
  only?: ReadonlySet<MemberId>,
) {
  const email = project.attribute_definitions.find((a) => a.type === 'email');
  const members = new Map(project.members.map((m) => [m.id, m]));
  const rows = [['name', 'email', 'link']];
  for (const l of links) {
    if (only && !only.has(l.memberId)) continue;
    const m = members.get(l.memberId);
    rows.push([m?.display_name ?? l.memberId, (email && m?.attributes[email.key]) ?? '', l.url]);
  }
  return csv(rows);
}
