// Projects and survey drafts for the respondent-mode tests. The 40-member case
// is the demo; larger rosters use seeded names built from random letters,
// which compress worse than real names, so measured link lengths are an upper
// estimate (CLAUDE.md, "Research").

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createProject } from '../../src/data/defaults';
import { parseProject } from '../../src/data/projectFile';
import type { Project } from '../../src/data/schema';
import { mulberry32 } from '../../src/engine/rng';
import {
  DEFAULT_NOMINATION_QUESTION,
  DEFAULT_SURVEY_SETTINGS,
  surveyLayerFrom,
  type SurveyDraft,
} from '../../src/survey/model';

export function demoProject(): Project {
  return parseProject(readFileSync(join(__dirname, '../../src/demo/demo.ona.json'), 'utf8'));
}

export function namedProject(n: number, seed = 20260926): Project {
  if (n === 40) return demoProject();
  const rnd = mulberry32(seed);
  const C = 'bcdfghjklmnprstvwyz';
  const V = 'aeiou';
  const word = (a: number, b: number) => {
    const len = a + Math.floor(rnd() * (b - a + 1));
    let w = '';
    for (let i = 0; i < len; i++)
      w += i % 2 ? V.charAt(Math.floor(rnd() * 5)) : C.charAt(Math.floor(rnd() * 19));
    return w.charAt(0).toUpperCase() + w.slice(1);
  };
  const p = createProject(`Survey test ${String(n)}`, '2026-09-26T10:00:00.000Z');
  const teams = ['Finance', 'Operations', 'Product', 'Sales', 'People'];
  p.members = Array.from({ length: n }, (_, i) => ({
    id: `M${String(i + 1).padStart(3, '0')}`,
    display_name: `${word(3, 7)} ${word(4, 9)}`,
    attributes: { team: teams[i % teams.length] ?? null, level: null, manager_id: null },
  }));
  return p;
}

export const TEXTS = {
  introduction:
    'We are mapping how people across the organisation work together, so that we can improve how teams collaborate and share information. You will be asked about your working relationships with each colleague on the list. There are no right or wrong answers.',
  confidentiality:
    'Your responses are confidential, not anonymous. The analysis team (two people in People Analytics) will see who gave which ratings, because the method needs it. Results are reported for teams and the organisation, never used to evaluate any individual, and your ratings are never shown to the people you rate.',
  return_instructions: 'Email your response file or text to ona-survey@example.org by 14 November.',
};

export function draftFor(project: Project, patch: Partial<SurveyDraft> = {}): SurveyDraft {
  return {
    title: 'Working relationships 2026',
    layers: project.layers.filter((l) => l.enabled).map(surveyLayerFrom),
    entry: 'nominate',
    nominationQuestion: DEFAULT_NOMINATION_QUESTION,
    texts: { ...TEXTS },
    deadline: '2026-11-14',
    wave: 1,
    settings: { ...DEFAULT_SURVEY_SETTINGS },
    sharedAttributes: [],
    required: [],
    ...patch,
  };
}
