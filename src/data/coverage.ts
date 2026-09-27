// Data coverage (spec §6, plan §3.7): the share of possible ratings that were
// given, per rater and overall, over the enabled layers of wave 1.
//
//   coverage_i = |{(j, l) : rating_ijl given}| / ((n − 1) × L_enabled − NA_i)
//
// where NA_i counts the ratings i marked "does not apply" (CLAUDE.md D102):
// the question has no answer for that colleague, so it was never a possible
// rating. A rating of 0 is a rating. A null tie ("declined") and a missing tie ("not
// entered") are both not rated; they are counted separately so the coverage
// view can show the difference (plan Q1). Categorical layers count.
// Pure and cheap (one pass over the ties), so it runs on the main thread; the
// Phase 3 engine imports the same function.

import { DEFAULT_WAVE, type MemberId, type Project } from './schema';

export interface RaterCoverage {
  id: MemberId;
  rated: number;
  declined: number;
  /** Marked "does not apply": left out of `possible`. */
  notApplicable: number;
  notEntered: number;
  possible: number;
  /** rated / possible; NaN when nothing is possible (fewer than two members or no layers). */
  rate: number;
}

export interface CoverageResult {
  raters: RaterCoverage[];
  rated: number;
  declined: number;
  notApplicable: number;
  notEntered: number;
  possible: number;
  rate: number;
  threshold: number;
  belowThreshold: boolean;
  layerCount: number;
}

export function computeCoverage(project: Project): CoverageResult {
  const enabled = new Set(project.layers.filter((l) => l.enabled).map((l) => l.key));
  const ids = new Set(project.members.map((m) => m.id));
  const n = project.members.length;
  const perRater = Math.max(n - 1, 0) * enabled.size;

  const rated = new Map<MemberId, number>();
  const declined = new Map<MemberId, number>();
  const notApplicable = new Map<MemberId, number>();
  for (const t of project.ties) {
    if (t.wave !== DEFAULT_WAVE || !enabled.has(t.variable)) continue;
    if (t.rater_id === t.ratee_id || !ids.has(t.rater_id) || !ids.has(t.ratee_id)) continue;
    const bucket = t.not_applicable ? notApplicable : t.value === null ? declined : rated;
    bucket.set(t.rater_id, (bucket.get(t.rater_id) ?? 0) + 1);
  }

  const raters = project.members.map((m): RaterCoverage => {
    const r = rated.get(m.id) ?? 0;
    const d = declined.get(m.id) ?? 0;
    const na = notApplicable.get(m.id) ?? 0;
    const possible = perRater - na;
    return {
      id: m.id,
      rated: r,
      declined: d,
      notApplicable: na,
      notEntered: possible - r - d,
      possible,
      rate: possible > 0 ? r / possible : NaN,
    };
  });
  const sum = (f: (r: RaterCoverage) => number) => raters.reduce((a, r) => a + f(r), 0);
  const possible = sum((r) => r.possible);
  const totalRated = sum((r) => r.rated);
  const rate = possible > 0 ? totalRated / possible : NaN;
  const threshold = project.settings.coverage_threshold;
  return {
    raters,
    rated: totalRated,
    declined: sum((r) => r.declined),
    notApplicable: sum((r) => r.notApplicable),
    notEntered: sum((r) => r.notEntered),
    possible,
    rate,
    threshold,
    belowThreshold: Number.isFinite(rate) && rate < threshold,
    layerCount: enabled.size,
  };
}
