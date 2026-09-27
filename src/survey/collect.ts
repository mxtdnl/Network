// Importing survey responses (spec §15.2 "On import", §15.5).
//
// planImport decides every response before anything changes: rejected (with a
// reason), already imported, a duplicate of the same token (the latest
// submission is kept), or accepted. Accepted responses are mapped to the
// current roster and layers and turned into ties, which pass through the same
// validation as a ties file (validateTies), so the analyst sees the usual
// report. applyImport then writes the ties and the log in one step.

import { validateTies, type FileReport } from '../data/import/validate';
import { NOT_APPLICABLE_TEXT } from '../data/ratings';
import { tableFromCells } from '../data/import/table';
import {
  isCategorical,
  tieKey,
  type MemberId,
  type Project,
  type RejectReason,
  type Survey,
  type SurveyLogEntry,
  type SurveyVersion,
  type Tie,
} from '../data/schema';
import { DecryptError } from './crypto';
import { currentVersion } from './model';
import { decryptResponse, receiptCode, type ResponseBody } from './response';
import type { CollectedEnvelope } from './transport';

export interface Rejected {
  source: string;
  receipt: string | null;
  reason: RejectReason;
}

export interface AcceptedResponse {
  source: string;
  receipt: string;
  memberId: MemberId;
  version: number;
  submittedAt: string;
  body: ResponseBody;
}

export interface DuplicateEvent {
  memberId: MemberId;
  kept: string;
  setAside: string;
}

/** What could not be carried from an older version to the current one. */
export interface MappingNote {
  receipt: string;
  version: number;
  /** Layers answered that the current version no longer asks. */
  droppedLayers: string[];
  /** Colleagues rated who are no longer on the roster or in the project. */
  droppedColleagues: MemberId[];
  /** Colleagues on the current roster whom this version did not list. */
  notAsked: MemberId[];
}

export interface ImportPlan {
  surveyId: string;
  rejected: Rejected[];
  /** Files already imported, recognised by receipt; nothing changes for them. */
  alreadyImported: { source: string; receipt: string }[];
  accepted: AcceptedResponse[];
  duplicates: DuplicateEvent[];
  /** Receipts of earlier accepted responses that new ones replace. */
  replaced: { receipt: string; by: string; memberId: MemberId }[];
  mapping: MappingNote[];
  ties: Tie[];
  report: FileReport;
}

export const RESPONSES_REPORT_NAME = 'Survey responses';

export async function planImport(
  project: Project,
  survey: Survey,
  privateKey: CryptoKey | null,
  collected: { envelopes: readonly CollectedEnvelope[]; unreadable: readonly string[] },
): Promise<ImportPlan> {
  const rejected: Rejected[] = collected.unreadable.map((source) => ({
    source,
    receipt: null,
    reason: 'unreadable',
  }));
  const alreadyImported: ImportPlan['alreadyImported'] = [];
  const loggedReceipts = new Set(
    survey.log.flatMap((e) =>
      e.kind === 'accepted' ? [e.receipt] : e.kind === 'duplicate' ? [e.set_aside] : [],
    ),
  );
  const versions = new Map(survey.versions.map((v) => [v.version, v]));
  const byToken = new Map(survey.respondents.map((r) => [r.token, r]));
  const candidates: AcceptedResponse[] = [];
  const seen = new Set<string>();

  for (const { source, envelope } of collected.envelopes) {
    const receipt = await receiptCode(envelope);
    const reject = (reason: RejectReason) => {
      rejected.push({ source, receipt, reason });
    };
    if (loggedReceipts.has(receipt) || seen.has(receipt)) {
      alreadyImported.push({ source, receipt });
      continue;
    }
    seen.add(receipt);
    if (survey.status === 'closed') {
      reject('closed');
      continue;
    }
    if (envelope.survey_id !== survey.id) {
      reject('other_survey');
      continue;
    }
    if (envelope.kid !== survey.key.fingerprint || !privateKey) {
      reject('other_key');
      continue;
    }
    let body: ResponseBody;
    try {
      body = await decryptResponse(privateKey, envelope);
    } catch (e) {
      reject(e instanceof DecryptError ? 'tampered' : 'unreadable');
      continue;
    }
    const version = versions.get(body.version);
    if (!version) {
      reject('unknown_version');
      continue;
    }
    const respondent = byToken.get(body.token);
    if (!respondent) {
      reject('unknown_token');
      continue;
    }
    if (version.roster[body.position] !== respondent.member_id) {
      reject('token_mismatch');
      continue;
    }
    candidates.push({
      source,
      receipt,
      memberId: respondent.member_id,
      version: body.version,
      submittedAt: body.submitted_at,
      body,
    });
  }

  // Duplicates: one response per member counts, the latest by submission time.
  // Earlier imports take part; on equal times the one imported first stays.
  const accepted: AcceptedResponse[] = [];
  const duplicates: DuplicateEvent[] = [];
  const replaced: ImportPlan['replaced'] = [];
  const byMember = new Map<MemberId, AcceptedResponse[]>();
  for (const c of candidates) byMember.set(c.memberId, [...(byMember.get(c.memberId) ?? []), c]);
  for (const [memberId, list] of byMember) {
    const earlier = survey.log.find(
      (e): e is Extract<SurveyLogEntry, { kind: 'accepted' }> =>
        e.kind === 'accepted' && e.member_id === memberId && e.replaced_by === null,
    );
    let best: { receipt: string; submittedAt: string; fresh: AcceptedResponse | null } | null =
      earlier ? { receipt: earlier.receipt, submittedAt: earlier.submitted_at, fresh: null } : null;
    for (const c of list) {
      if (!best) {
        best = { receipt: c.receipt, submittedAt: c.submittedAt, fresh: c };
        continue;
      }
      const newer = Date.parse(c.submittedAt) > Date.parse(best.submittedAt);
      const kept = newer ? c.receipt : best.receipt;
      const setAside = newer ? best.receipt : c.receipt;
      duplicates.push({ memberId, kept, setAside });
      if (newer) best = { receipt: c.receipt, submittedAt: c.submittedAt, fresh: c };
    }
    if (best?.fresh) {
      accepted.push(best.fresh);
      if (earlier) replaced.push({ receipt: earlier.receipt, by: best.fresh.receipt, memberId });
    }
  }

  const current = currentVersion(survey);
  const mapping: MappingNote[] = [];
  const rows: string[][] = [['rater_id', 'ratee_id', 'variable', 'value', 'wave']];
  const origin: { receipt: string; version: number }[] = [];
  for (const a of accepted) {
    const version = versions.get(a.version) as SurveyVersion;
    const note = mapResponse(project, current, version, a, rows, survey.wave);
    for (let i = origin.length; i < rows.length - 1; i++)
      origin.push({ receipt: a.receipt, version: a.version });
    if (note.droppedLayers.length + note.droppedColleagues.length + note.notAsked.length > 0)
      mapping.push(note);
  }

  // Ratings replaced by a newer response from the same member do not count as
  // existing; any other existing rating is a conflict and is reported.
  const replacedMembers = new Set(replaced.map((r) => r.memberId));
  const existingKeys = new Set(
    project.ties
      .filter(
        (t) =>
          !(
            t.survey?.id === survey.id &&
            t.source === 'self_report' &&
            replacedMembers.has(t.rater_id)
          ),
      )
      .map((t) => tieKey(t.rater_id, t.ratee_id, t.variable, t.wave)),
  );
  const table = tableFromCells(RESPONSES_REPORT_NAME, rows);
  const result = validateTies(table, {
    memberIds: new Set(project.members.map((m) => m.id)),
    layers: project.layers,
    existingKeys,
  });
  // validateTies keeps valid rows in order; match them back to their response.
  const validRows = new Set(table.rows.map((r) => r.row));
  for (const issue of result.report.issues)
    if (issue.severity === 'error' && issue.row !== null) validRows.delete(issue.row);
  const kept = table.rows.filter((r) => validRows.has(r.row));
  const ties = result.ties.map((t, i) => {
    const o = origin[(kept[i]?.row ?? 2) - 2] ?? { version: current.version };
    return { ...t, source: 'self_report' as const, survey: { id: survey.id, version: o.version } };
  });

  return {
    surveyId: survey.id,
    rejected,
    alreadyImported,
    accepted,
    duplicates,
    replaced,
    mapping,
    ties,
    report: result.report,
  };
}

/** Appends one response's ratings as long-format rows; returns what did not map. */
function mapResponse(
  project: Project,
  current: SurveyVersion,
  version: SurveyVersion,
  a: AcceptedResponse,
  rows: string[][],
  wave: number,
): MappingNote {
  const note: MappingNote = {
    receipt: a.receipt,
    version: a.version,
    droppedLayers: [],
    droppedColleagues: [],
    notAsked: [],
  };
  const members = new Set(project.members.map((m) => m.id));
  const currentLayers = new Set(current.layers.map((l) => l.key));
  const projectLayers = new Map(project.layers.map((l) => [l.key, l]));
  const currentRoster = new Set(current.roster);
  // Asked about: the colleagues selected plus those the version requires (D103).
  const nominated = a.body.nominated
    ? new Set([
        ...a.body.nominated,
        ...version.required.map((id) => version.roster.indexOf(id)).filter((i) => i >= 0),
      ])
    : null;
  const rosterNow = new Set(version.roster);
  note.notAsked = current.roster.filter((id) => !rosterNow.has(id) && id !== a.memberId);

  for (const layer of version.layers) {
    const projectLayer = projectLayers.get(layer.key);
    if (!currentLayers.has(layer.key) || !projectLayer) {
      note.droppedLayers.push(layer.key);
      continue;
    }
    const answers = a.body.answers[layer.key] ?? [];
    const na = new Set(a.body.not_applicable[layer.key] ?? []);
    version.roster.forEach((ratee, position) => {
      if (position === a.body.position) return;
      let value: string | null;
      if (nominated && !nominated.has(position)) {
        // Not selected: stored as the rule the respondent was told (D88, D102).
        value =
          layer.unselected === 'zero' && !isCategorical(projectLayer) ? '0' : NOT_APPLICABLE_TEXT;
      } else if (na.has(position)) {
        value = NOT_APPLICABLE_TEXT;
      } else {
        const answer = answers[position] ?? null;
        value = answer === null ? '' : String(answer);
      }
      if (!currentRoster.has(ratee) || !members.has(ratee)) {
        if (!note.droppedColleagues.includes(ratee)) note.droppedColleagues.push(ratee);
        return;
      }
      rows.push([a.memberId, ratee, layer.key, value, String(wave)]);
    });
  }
  return note;
}

/** Applies a plan: replaced responses' ties go, new ties and every decision are logged. */
export function applyImport(project: Project, plan: ImportPlan, now: string): Project {
  const survey = project.surveys.find((s) => s.id === plan.surveyId);
  if (!survey) return project;
  const replacedMembers = new Set(plan.replaced.map((r) => r.memberId));
  const replacedBy = new Map(plan.replaced.map((r) => [r.receipt, r.by]));
  const counts = new Map<string, number>();
  const receiptOf = new Map(plan.accepted.map((a) => [a.memberId, a.receipt]));
  for (const t of plan.ties) {
    const r = receiptOf.get(t.rater_id);
    if (r) counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  const log: SurveyLogEntry[] = [
    ...survey.log.map((e) =>
      e.kind === 'accepted' && replacedBy.has(e.receipt)
        ? { ...e, replaced_by: replacedBy.get(e.receipt) ?? null }
        : e,
    ),
    ...plan.accepted.map((a): SurveyLogEntry => ({
      kind: 'accepted',
      receipt: a.receipt,
      member_id: a.memberId,
      version: a.version,
      submitted_at: a.submittedAt,
      imported_at: now,
      ratings: counts.get(a.receipt) ?? 0,
      replaced_by: null,
    })),
    ...plan.duplicates.map((d): SurveyLogEntry => ({
      kind: 'duplicate',
      member_id: d.memberId,
      kept: d.kept,
      set_aside: d.setAside,
      imported_at: now,
    })),
    ...plan.rejected.map((r): SurveyLogEntry => ({
      kind: 'rejected',
      source: r.source,
      receipt: r.receipt,
      reason: r.reason,
      imported_at: now,
    })),
  ];
  const ties = project.ties.filter(
    (t) =>
      !(
        t.survey?.id === survey.id &&
        t.source === 'self_report' &&
        replacedMembers.has(t.rater_id)
      ),
  );
  return {
    ...project,
    ties: [...ties, ...plan.ties],
    surveys: project.surveys.map((s) => (s.id === survey.id ? { ...s, log } : s)),
  };
}
