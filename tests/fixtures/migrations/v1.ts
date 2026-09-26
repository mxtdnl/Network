// A version 1 project file (schema_version 1), kept as text so the migration
// to version 2 is tested on the older format exactly (src/data/migrations.ts).
// Version 1 described saved views after docs/plan.md §2: `analysis`, `map`
// with a viewport and a path, and `selection` as a list. It is TypeScript,
// not an .ona.json file, so the participant-data rule in .gitignore needs no
// exception (CLAUDE.md D21, D34). Apart from the version and the saved view,
// its content equals richProject() in tests/unit/projectFile.test.ts.

import type { SavedView } from '../../../src/data/schema';

export const V1_PROJECT = String.raw`{
  "schema_version": 1,
  "app": { "name": "Graticule", "version": "0.2.0" },
  "meta": {
    "title": "Équipe “Nord” 2026",
    "created_at": "2026-09-26T10:00:00.000Z",
    "modified_at": "2026-09-26T11:30:00.000Z",
    "notes": "Line one\nLine two, with a tab\tand emoji-free text."
  },
  "attribute_definitions": [
    {
      "key": "team",
      "label": "Team or function",
      "type": "categorical",
      "builtin": true,
      "categories": [
        "Finance",
        "Operations"
      ]
    },
    {
      "key": "level",
      "label": "Level",
      "type": "ordinal",
      "builtin": true
    },
    {
      "key": "location",
      "label": "Location",
      "type": "categorical",
      "builtin": true
    },
    {
      "key": "tenure_band",
      "label": "Tenure band",
      "type": "ordinal",
      "builtin": true
    },
    {
      "key": "manager_id",
      "label": "Formal manager",
      "type": "member_ref",
      "builtin": true
    },
    {
      "key": "office_floor",
      "label": "Office floor",
      "type": "categorical",
      "categories": [
        "2",
        "3"
      ],
      "builtin": false
    }
  ],
  "members": [
    {
      "id": "A01",
      "display_name": "Zoë Ødegaard",
      "attributes": {
        "team": "Finance",
        "level": "L4",
        "manager_id": null,
        "office_floor": "3"
      }
    },
    {
      "id": "A02",
      "display_name": "Bram Contour",
      "attributes": {
        "team": "Finance",
        "level": null,
        "manager_id": "A01",
        "office_floor": null
      }
    },
    {
      "id": "A03",
      "display_name": "Chiara Meridian",
      "attributes": {
        "team": "Operations",
        "level": "L3",
        "manager_id": "A01",
        "office_floor": "2"
      }
    }
  ],
  "layers": [
    {
      "default_weight": 1,
      "key": "connection_strength",
      "label": "Connection strength",
      "question_wording": "How strong is your working connection with this person?",
      "scale_type": "strength",
      "min": 0,
      "max": 5,
      "signed": false,
      "scale_labels": {
        "0": "No meaningful working connection",
        "5": "Very strong"
      },
      "enabled": true,
      "core": true,
      "builtin": true
    },
    {
      "default_weight": 1,
      "key": "valence",
      "label": "Valence",
      "question_wording": "Overall, how positive or negative is your working relationship with this person?",
      "scale_type": "signed",
      "min": -3,
      "max": 3,
      "signed": true,
      "scale_labels": {
        "0": "Neutral",
        "3": "Very positive",
        "-3": "Very negative"
      },
      "enabled": false,
      "core": true,
      "builtin": true
    },
    {
      "default_weight": 1,
      "key": "informal_collaboration",
      "label": "Informal collaboration",
      "question_wording": "How often do you collaborate with this person outside formal roles, processes or reporting lines?",
      "scale_type": "frequency",
      "min": 0,
      "max": 5,
      "signed": false,
      "scale_labels": {
        "0": "Never",
        "1": "Less than monthly",
        "2": "Monthly",
        "3": "Weekly",
        "4": "Several times a week",
        "5": "Daily"
      },
      "role": "informal",
      "enabled": true,
      "core": true,
      "builtin": true
    },
    {
      "default_weight": 1,
      "key": "formal_collaboration",
      "label": "Formal collaboration",
      "question_wording": "How often does your role, a process or a reporting line require you to collaborate with this person?",
      "scale_type": "frequency",
      "min": 0,
      "max": 5,
      "signed": false,
      "scale_labels": {
        "0": "Never",
        "1": "Less than monthly",
        "2": "Monthly",
        "3": "Weekly",
        "4": "Several times a week",
        "5": "Daily"
      },
      "role": "formal",
      "enabled": true,
      "core": true,
      "builtin": true
    },
    {
      "default_weight": 1,
      "key": "advice",
      "label": "Advice",
      "question_wording": "Whom do you ask for advice?",
      "scale_type": "frequency",
      "min": 0,
      "max": 5,
      "signed": false,
      "scale_labels": {
        "0": "Never",
        "1": "Less than monthly",
        "2": "Monthly",
        "3": "Weekly",
        "4": "Several times a week",
        "5": "Daily"
      },
      "enabled": false,
      "core": false,
      "builtin": true
    },
    {
      "default_weight": 1,
      "key": "competence_trust",
      "label": "Competence-based trust",
      "question_wording": "I rely on this person’s expertise and judgement.",
      "scale_type": "strength",
      "min": 0,
      "max": 5,
      "signed": false,
      "scale_labels": {
        "0": "Not at all",
        "5": "Completely"
      },
      "enabled": false,
      "core": false,
      "builtin": true
    },
    {
      "default_weight": 1,
      "key": "benevolence_trust",
      "label": "Benevolence-based trust",
      "question_wording": "This person would look out for my interests.",
      "scale_type": "strength",
      "min": 0,
      "max": 5,
      "signed": false,
      "scale_labels": {
        "0": "Not at all",
        "5": "Completely"
      },
      "enabled": false,
      "core": false,
      "builtin": true
    },
    {
      "default_weight": 1,
      "key": "energy",
      "label": "Energy",
      "question_wording": "Interactions with this person typically leave me energised / drained.",
      "scale_type": "signed",
      "min": -3,
      "max": 3,
      "signed": true,
      "scale_labels": {
        "0": "Neutral",
        "3": "Very energising",
        "-3": "Very draining"
      },
      "enabled": false,
      "core": false,
      "builtin": true
    },
    {
      "default_weight": 1,
      "key": "decision_influence",
      "label": "Decision influence",
      "question_wording": "This person’s input materially affects my decisions.",
      "scale_type": "strength",
      "min": 0,
      "max": 5,
      "signed": false,
      "scale_labels": {
        "0": "Not at all",
        "5": "Completely"
      },
      "enabled": false,
      "core": false,
      "builtin": true
    },
    {
      "default_weight": 1,
      "key": "workflow_dependency",
      "label": "Workflow dependency",
      "question_wording": "I cannot complete my work without this person’s output.",
      "scale_type": "strength",
      "min": 0,
      "max": 5,
      "signed": false,
      "scale_labels": {
        "0": "Not at all",
        "5": "Completely"
      },
      "enabled": false,
      "core": false,
      "builtin": true
    },
    {
      "default_weight": 1,
      "key": "knowledge_awareness",
      "label": "Knowledge awareness",
      "question_wording": "I understand what this person knows and can do.",
      "scale_type": "strength",
      "min": 0,
      "max": 5,
      "signed": false,
      "scale_labels": {
        "0": "Not at all",
        "5": "Completely"
      },
      "enabled": false,
      "core": false,
      "builtin": true
    },
    {
      "default_weight": 1,
      "key": "idea_sharing",
      "label": "Idea sharing",
      "question_wording": "I would take a new or untested idea to this person.",
      "scale_type": "strength",
      "min": 0,
      "max": 5,
      "signed": false,
      "scale_labels": {
        "0": "Not at all",
        "5": "Completely"
      },
      "enabled": false,
      "core": false,
      "builtin": true
    },
    {
      "default_weight": 1,
      "key": "interpersonal_safety",
      "label": "Interpersonal safety",
      "question_wording": "I can raise a concern or admit a mistake with this person without fear of negative consequences.",
      "scale_type": "strength",
      "min": 0,
      "max": 5,
      "signed": false,
      "scale_labels": {
        "0": "Not at all",
        "5": "Completely"
      },
      "enabled": false,
      "core": false,
      "builtin": true
    },
    {
      "default_weight": 1,
      "key": "conflict_task",
      "label": "Conflict: task disagreement",
      "question_wording": "How often do you experience task disagreement with this person?",
      "scale_type": "frequency",
      "min": 0,
      "max": 5,
      "signed": false,
      "scale_labels": {
        "0": "Never",
        "1": "Less than monthly",
        "2": "Monthly",
        "3": "Weekly",
        "4": "Several times a week",
        "5": "Daily"
      },
      "group": "conflict",
      "enabled": false,
      "core": false,
      "builtin": true
    },
    {
      "default_weight": 1,
      "key": "conflict_personal",
      "label": "Conflict: personal friction",
      "question_wording": "How often do you experience personal friction with this person?",
      "scale_type": "frequency",
      "min": 0,
      "max": 5,
      "signed": false,
      "scale_labels": {
        "0": "Never",
        "1": "Less than monthly",
        "2": "Monthly",
        "3": "Weekly",
        "4": "Several times a week",
        "5": "Daily"
      },
      "group": "conflict",
      "enabled": false,
      "core": false,
      "builtin": true
    },
    {
      "default_weight": 0,
      "key": "primary_channel",
      "label": "Primary channel",
      "question_wording": "Which channel do you mainly use with this person?",
      "scale_type": "categorical",
      "min": 0,
      "max": 0,
      "signed": false,
      "categories": [
        "in_person",
        "video",
        "chat",
        "email"
      ],
      "category_labels": {
        "in_person": "In person",
        "video": "Video",
        "chat": "Chat",
        "email": "Email"
      },
      "enabled": true,
      "core": false,
      "builtin": true
    }
  ],
  "ties": [
    {
      "rater_id": "A01",
      "ratee_id": "A02",
      "variable": "connection_strength",
      "value": 0,
      "wave": 1
    },
    {
      "rater_id": "A02",
      "ratee_id": "A01",
      "variable": "connection_strength",
      "value": null,
      "wave": 1
    },
    {
      "rater_id": "A01",
      "ratee_id": "A03",
      "variable": "valence",
      "value": -3,
      "wave": 1
    },
    {
      "rater_id": "A03",
      "ratee_id": "A01",
      "variable": "valence",
      "value": 2.5,
      "wave": 1
    },
    {
      "rater_id": "A03",
      "ratee_id": "A02",
      "variable": "primary_channel",
      "value": "video",
      "wave": 1
    },
    {
      "rater_id": "A01",
      "ratee_id": "A02",
      "variable": "connection_strength",
      "value": 5,
      "wave": 2
    }
  ],
  "saved_views": [
    {
      "id": "v1",
      "name": "Finance links",
      "caption": "Who connects Finance to Operations?",
      "created_at": "2026-09-26T11:00:00.000Z",
      "analysis": {
        "view": "symmetrised",
        "symmetrise": "min",
        "activeLayer": "composite",
        "weights": { "connection_strength": 0.5, "informal_collaboration": 0.5 },
        "signedTreatment": { "valence": "multiplier" },
        "preset": "custom",
        "nodeSizeMetric": "betweenness",
        "nodeFill": { "kind": "attribute", "key": "team" }
      },
      "map": {
        "layout": "grouped",
        "groupBy": "team",
        "positions": { "A01": { "x": 1.5, "y": -2, "pinned": true } },
        "viewport": { "x": 0, "y": 0, "k": 1.25 },
        "threshold": 0.2,
        "layerToggles": { "connection_strength": true },
        "filters": [{ "key": "team", "values": ["Finance"] }],
        "egoView": { "member": "A01", "depth": 2 },
        "path": null
      },
      "selection": ["A01", "A03"]
    }
  ],
  "settings": {
    "coverage_threshold": 0.65,
    "anonymise": true,
    "exclude_signed_from_exports": true,
    "random_seed": 42,
    "bootstrap": {
      "replicates": 500,
      "drop_fraction": 0.2
    },
    "anonymisation_scheme": "role_team"
  }
}
`;

/** The saved view above after migration to version 2. */
export const V1_VIEW_MIGRATED: SavedView = {
  id: 'v1',
  name: 'Finance links',
  caption: 'Who connects Finance to Operations?',
  created_at: '2026-09-26T11:00:00.000Z',
  weights: {
    preset: 'custom',
    custom: { connection_strength: 0.5, informal_collaboration: 0.5 },
    customTreatment: { valence: 'multiplier' },
  },
  map: {
    view: 'symmetrised',
    symmetrise: 'min',
    layer: 'composite',
    sizeMetric: 'betweenness',
    fill: { kind: 'attribute', key: 'team' },
    threshold: 0.2,
    layerToggles: { connection_strength: true },
    hideOffLayers: false,
    filters: [{ key: 'team', values: ['Finance'] }],
    layout: 'grouped',
    groupBy: 'team',
    ego: { member: 'A01', depth: 2 },
    highlight: [],
  },
  positions: { A01: { x: 1.5, y: -2, pinned: true } },
  selection: { member: null, group: ['A01', 'A03'] },
};
