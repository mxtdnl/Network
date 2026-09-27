// A respondent's answers, saved on their own device after every change so they
// can close the page and resume (spec §15.4). Keyed by survey, version and
// token. Cleared on request, and automatically once the encrypted response has
// been copied or downloaded (CLAUDE.md D94). If storage is unavailable the
// survey still works; answers then last only as long as the page.

import type { Answer } from '../survey/response';

export type Step = 'welcome' | 'consent' | 'identity' | 'notMe' | 'nominate' | 'rate' | 'review';

export interface Progress {
  v: 1;
  step: Step;
  consent: boolean;
  /** Roster positions selected; null until the nomination stage is used. */
  nominated: number[] | null;
  /** Per layer key, by roster position. */
  answers: Record<string, Record<string, Answer>>;
  /** Mobile: the colleague on screen, as an index into the people to rate. */
  person: number;
  /** Desktop: the question on screen. */
  question: number;
  /** A survey package's text, so a package link resumes without choosing the file again. */
  packageText?: string;
}

export const PREFIX = 'graticule.respond.';

export const progressKey = (surveyId: string, version: number, token: string) =>
  `${PREFIX}${surveyId}.${String(version)}.${token}`;

export function emptyProgress(): Progress {
  return {
    v: 1,
    step: 'welcome',
    consent: false,
    nominated: null,
    answers: {},
    person: 0,
    question: 0,
  };
}

export function loadProgress(key: string): Progress | null {
  try {
    const text = window.localStorage.getItem(key);
    if (!text) return null;
    const p = JSON.parse(text) as Partial<Progress>;
    if (p.v !== 1 || typeof p.answers !== 'object' || typeof p.step !== 'string') return null;
    return { ...emptyProgress(), ...p };
  } catch {
    return null;
  }
}

export function saveProgress(key: string, progress: Progress): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(progress));
    return true;
  } catch {
    return false;
  }
}

export function clearProgress(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Storage unavailable: nothing was saved.
  }
}
