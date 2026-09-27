// Default attribute and layer definitions (spec §4.1, §4.2) and project settings.
// Question wording for the optional layers is the spec's suggested wording; the
// core layers' wording is written from the spec's "Meaning" column. Users can
// edit both.

import {
  APP_NAME,
  APP_VERSION,
  SCHEMA_VERSION,
  type AttributeDefinition,
  type LayerDefinition,
  type Project,
  type ProjectSettings,
} from './schema';

export const DEFAULT_ATTRIBUTES: readonly AttributeDefinition[] = [
  { key: 'team', label: 'Team or function', type: 'categorical', builtin: true },
  { key: 'level', label: 'Level', type: 'ordinal', builtin: true },
  { key: 'location', label: 'Location', type: 'categorical', builtin: true },
  { key: 'tenure_band', label: 'Tenure band', type: 'ordinal', builtin: true },
  { key: 'manager_id', label: 'Formal manager', type: 'member_ref', builtin: true },
];

const FREQUENCY_LABELS = {
  '0': 'Never',
  '1': 'Less than monthly',
  '2': 'Monthly',
  '3': 'Weekly',
  '4': 'Several times a week',
  '5': 'Daily',
};
const AGREEMENT_LABELS = { '0': 'Not at all', '5': 'Completely' };

type LayerSeed = Omit<LayerDefinition, 'enabled' | 'core' | 'builtin' | 'default_weight'> &
  Partial<Pick<LayerDefinition, 'default_weight'>>;

function scaled(
  key: string,
  label: string,
  question_wording: string,
  scale_type: 'strength' | 'frequency',
  extra: Partial<LayerSeed> = {},
): LayerSeed {
  return {
    key,
    label,
    question_wording,
    scale_type,
    min: 0,
    max: 5,
    signed: false,
    scale_labels: scale_type === 'frequency' ? FREQUENCY_LABELS : AGREEMENT_LABELS,
    ...extra,
  };
}

function signed(key: string, label: string, question_wording: string, low: string, high: string) {
  return {
    key,
    label,
    question_wording,
    scale_type: 'signed' as const,
    min: -3,
    max: 3,
    signed: true,
    scale_labels: { '-3': low, '0': 'Neutral', '3': high },
  };
}

const CORE: readonly LayerSeed[] = [
  scaled(
    'connection_strength',
    'Connection strength',
    'How strong is your working connection with this person?',
    'strength',
    { scale_labels: { '0': 'No meaningful working connection', '5': 'Very strong' } },
  ),
  signed(
    'valence',
    'Valence',
    'Overall, how positive or negative is your working relationship with this person?',
    'Very negative',
    'Very positive',
  ),
  scaled(
    'informal_collaboration',
    'Informal collaboration',
    'How often do you collaborate with this person outside formal roles, processes or reporting lines?',
    'frequency',
    { role: 'informal' },
  ),
  scaled(
    'formal_collaboration',
    'Formal collaboration',
    'How often does your role, a process or a reporting line require you to collaborate with this person?',
    'frequency',
    { role: 'formal' },
  ),
];

const OPTIONAL: readonly LayerSeed[] = [
  scaled(
    'advice',
    'Advice and information seeking',
    'Who do you go to for work-related information or advice?',
    'frequency',
  ),
  scaled(
    'competence_trust',
    'Competence-based trust',
    'I rely on this person’s expertise and judgement.',
    'strength',
  ),
  scaled(
    'benevolence_trust',
    'Benevolence-based trust',
    'This person would look out for my interests.',
    'strength',
  ),
  signed(
    'energy',
    'Energy',
    'Interactions with this person typically leave me energised / drained.',
    'Very draining',
    'Very energising',
  ),
  scaled(
    'decision_influence',
    'Decision influence',
    'This person’s input materially affects my decisions.',
    'strength',
  ),
  scaled(
    'workflow_dependency',
    'Workflow dependency',
    'I cannot complete my work without this person’s output.',
    'strength',
  ),
  scaled(
    'knowledge_awareness',
    'Knowledge awareness',
    'I understand what this person knows and can do.',
    'strength',
  ),
  scaled(
    'idea_sharing',
    'Idea sharing',
    'I would take a new or untested idea to this person.',
    'strength',
  ),
  scaled(
    'interpersonal_safety',
    'Interpersonal safety',
    'I can raise a concern or admit a mistake with this person without fear of negative consequences.',
    'strength',
  ),
  scaled(
    'conflict_task',
    'Conflict: task disagreement',
    'How often do you experience task disagreement with this person?',
    'frequency',
    { group: 'conflict' },
  ),
  scaled(
    'conflict_personal',
    'Conflict: personal friction',
    'How often do you experience personal friction with this person?',
    'frequency',
    { group: 'conflict' },
  ),
  {
    key: 'primary_channel',
    label: 'Primary channel',
    question_wording: 'Which channel do you mainly use with this person?',
    scale_type: 'categorical',
    min: 0,
    max: 0,
    signed: false,
    default_weight: 0, // categorical, not weighted (spec §4.2)
    categories: ['in_person', 'video', 'chat', 'email'],
    category_labels: { in_person: 'In person', video: 'Video', chat: 'Chat', email: 'Email' },
  },
];

function finish(seed: LayerSeed, core: boolean): LayerDefinition {
  return { default_weight: 1, ...seed, enabled: core, core, builtin: true };
}

export function defaultLayers(): LayerDefinition[] {
  return [...CORE.map((l) => finish(l, true)), ...OPTIONAL.map((l) => finish(l, false))];
}

/** Built-in layer definition by key, used to restore a deleted optional layer. */
export function builtinLayer(key: string): LayerDefinition | undefined {
  return defaultLayers().find((l) => l.key === key);
}

export function defaultSettings(): ProjectSettings {
  return {
    coverage_threshold: 0.8,
    anonymise: false,
    exclude_signed_from_exports: false,
    random_seed: 1,
    bootstrap: { replicates: 200, drop_fraction: 0.1 },
    anonymisation_scheme: 'role_team',
  };
}

export function createProject(title: string, now: string): Project {
  return {
    schema_version: SCHEMA_VERSION,
    app: { name: APP_NAME, version: APP_VERSION },
    meta: { title, created_at: now, modified_at: now, notes: '' },
    attribute_definitions: DEFAULT_ATTRIBUTES.map((a) => ({ ...a })),
    members: [],
    layers: defaultLayers(),
    ties: [],
    saved_views: [],
    surveys: [],
    settings: defaultSettings(),
  };
}
