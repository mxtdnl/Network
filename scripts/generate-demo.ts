// Generates the fictional demo project (spec §5): 40 people in 5 teams, built to
// contain four structures:
//   1. a broker: one Operations member is the main link between teams;
//   2. a siloed team: Finance has almost no ties outside itself, except through
//      the broker;
//   3. a pocket of reciprocated negative valence among four members;
//   4. a clear formal–informal mismatch: Product and Sales must collaborate by
//      process but rarely do so informally, while a group spanning Product and
//      People collaborates informally with no formal reason to.
// It is deterministic: the same seed always writes the same file.
//
// Run with `npm run demo`. Output: src/demo/demo.ona.json (committed).

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createProject } from '../src/data/defaults';
import { serialiseProject } from '../src/data/projectFile';
import type { Member, Project, Tie } from '../src/data/schema';
import { mulberry32 } from '../src/engine/rng';

export const DEMO_SEED = 20260926;
const CREATED_AT = '2026-09-26T09:00:00.000Z';

const FIRST = [
  'Ada',
  'Bram',
  'Chiara',
  'Dev',
  'Elif',
  'Farah',
  'Gideon',
  'Hana',
  'Ivo',
  'Jonah',
  'Kemi',
  'Lior',
  'Maren',
  'Nikhil',
  'Odile',
  'Pavel',
  'Quinn',
  'Rosa',
  'Sami',
  'Tove',
  'Uma',
  'Viktor',
  'Wren',
  'Xiomara',
  'Yusuf',
  'Zara',
  'Anouk',
  'Bastian',
  'Cleo',
  'Dario',
  'Esme',
  'Femi',
  'Greta',
  'Hugo',
  'Imani',
  'Joss',
  'Kai',
  'Leona',
  'Milo',
  'Nia',
];
// Surveying and map-making terms, so no name can be mistaken for a real person's.
const LAST = [
  'Meridian',
  'Contour',
  'Azimuth',
  'Bearing',
  'Datum',
  'Easting',
  'Northing',
  'Isobar',
  'Hachure',
  'Traverse',
  'Sextant',
  'Theodolite',
  'Plumbline',
  'Furlong',
  'Parallel',
  'Tropic',
  'Latitude',
  'Longitude',
  'Relief',
  'Cairn',
  'Trigpoint',
  'Benchmark',
  'Transect',
  'Cadastre',
  'Vernier',
  'Alidade',
  'Gnomon',
  'Quadrant',
  'Octant',
  'Zenith',
  'Nadir',
  'Horizon',
  'Isogon',
  'Compass',
  'Legend',
  'Waypoint',
  'Fathom',
  'Sounding',
  'Isthmus',
  'Cartouche',
];

const TEAMS = ['Finance', 'Operations', 'Product', 'Sales', 'People'] as const;
const LOCATIONS = ['Leeds', 'Bristol', 'Glasgow'];
const TENURE = ['Under 1 year', '1 to 3 years', '3 to 5 years', 'Over 5 years'];
const TEAM_SIZE = 8;

type TeamName = (typeof TEAMS)[number];

interface Person {
  id: string;
  name: string;
  team: TeamName;
  lead: boolean;
}

export function generateDemo(seed = DEMO_SEED): Project {
  const rand = mulberry32(seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)] as T;
  const noise = (spread: number) => (rand() - 0.5) * 2 * spread;

  const people: Person[] = [];
  TEAMS.forEach((team, t) => {
    for (let k = 0; k < TEAM_SIZE; k += 1) {
      const i = t * TEAM_SIZE + k;
      people.push({
        id: `${team.slice(0, 3).toUpperCase()}${String(k + 1).padStart(2, '0')}`,
        name: `${FIRST[i] ?? ''} ${LAST[i] ?? ''}`,
        team,
        lead: k === 0,
      });
    }
  });
  const byId = new Map(people.map((p) => [p.id, p]));
  const leadOf = (team: TeamName) => people.find((p) => p.team === team && p.lead) as Person;
  const top = leadOf('Operations');

  // Named structures.
  const broker = 'OPE04';
  const brokerContacts = new Set(['FIN03', 'FIN06', 'PRO04', 'PRO07', 'SAL05', 'PEO03', 'PEO06']);
  const negativePocket = new Set(['SAL02', 'SAL03', 'SAL06', 'PRO05']);
  const informalGroup = new Set(['PRO02', 'PRO03', 'PRO06', 'PEO02', 'PEO04', 'PEO07']);
  const lowResponders = new Set(['SAL08', 'OPE07']);

  const members: Member[] = people.map((p) => {
    const level = p.lead ? 'L4' : pick(['L1', 'L2', 'L2', 'L3', 'L3']);
    return {
      id: p.id,
      display_name: p.name,
      attributes: {
        team: p.team,
        level: p.id === top.id ? 'L5' : level,
        location: pick(LOCATIONS),
        tenure_band: pick(TENURE),
        manager_id: p.id === top.id ? null : p.lead ? top.id : leadOf(p.team).id,
      },
    };
  });
  const manager = new Map(members.map((m) => [m.id, m.attributes.manager_id ?? null]));

  // Baseline tie strength in [0, 1] for each ordered pair, from which every
  // layer is derived with its own noise.
  function strength(a: Person, b: Person): number {
    if (a.id === broker && brokerContacts.has(b.id)) return 0.8;
    if (b.id === broker && brokerContacts.has(a.id)) return 0.75;
    if (a.team === b.team) {
      const line = manager.get(a.id) === b.id || manager.get(b.id) === a.id;
      return Math.min(1, 0.55 + (line ? 0.2 : 0) + noise(0.2));
    }
    if (a.team === 'Finance' || b.team === 'Finance') return 0; // the silo
    if (a.lead && b.lead) return 0.45 + noise(0.1);
    if (informalGroup.has(a.id) && informalGroup.has(b.id)) return 0.55 + noise(0.1);
    return rand() < 0.15 ? 0.3 + noise(0.1) : Math.max(0, 0.05 + noise(0.08));
  }

  const scale5 = (v: number) => Math.max(0, Math.min(5, Math.round(v * 5)));
  const ties: Tie[] = [];
  const declinedValence = new Set<string>();
  for (let k = 0; k < 12; k += 1) {
    const a = pick(people);
    const b = pick(people);
    if (a.id !== b.id) declinedValence.add(`${a.id}>${b.id}`);
  }

  for (const a of people) {
    for (const b of people) {
      if (a.id === b.id) continue;
      const s = strength(a, b);
      const sameTeam = a.team === b.team;
      const line = manager.get(a.id) === b.id || manager.get(b.id) === a.id;
      const productSales =
        (a.team === 'Product' && b.team === 'Sales') ||
        (a.team === 'Sales' && b.team === 'Product');
      const informalOnly = informalGroup.has(a.id) && informalGroup.has(b.id) && a.team !== b.team;

      const connection = scale5(s + noise(0.08));

      let formal: number;
      if (line) formal = 5;
      else if (sameTeam) formal = scale5(0.6 + noise(0.15));
      else if (productSales) formal = scale5(0.65 + noise(0.1));
      else if (a.lead && b.lead && a.team !== 'Finance' && b.team !== 'Finance') formal = 3;
      else if (informalOnly) formal = 0;
      else formal = scale5(s * 0.6 + noise(0.05));

      let informal: number;
      if (productSales && !informalOnly) informal = scale5(Math.min(s, 0.1));
      else if (informalOnly) informal = scale5(0.75 + noise(0.1));
      else if (line) informal = scale5(s * 0.5 + noise(0.1));
      else informal = scale5(s * 0.9 + noise(0.1));

      let valence: number | null;
      if (negativePocket.has(a.id) && negativePocket.has(b.id)) {
        valence = rand() < 0.5 ? -3 : -2;
      } else if (s < 0.15) valence = rand() < 0.8 ? 0 : 1;
      else valence = Math.max(-1, Math.min(3, Math.round(s * 3.4 + noise(0.8))));
      if (declinedValence.has(`${a.id}>${b.id}`) && !negativePocket.has(a.id)) valence = null;

      const values: [string, number | null][] = [
        ['connection_strength', connection],
        ['valence', valence],
        ['informal_collaboration', informal],
        ['formal_collaboration', formal],
      ];
      for (const [variable, value] of values) {
        // Coverage: two members answered about half the survey, and about 2 % of
        // other ratings were never entered.
        const skip = lowResponders.has(a.id) ? rand() < 0.5 : rand() < 0.02;
        if (skip) continue;
        ties.push({ rater_id: a.id, ratee_id: b.id, variable, value, wave: 1 });
      }
    }
  }

  const project = createProject('Demo: Meridian Works', CREATED_AT);
  project.members = members;
  project.ties = ties;
  for (const def of project.attribute_definitions) {
    if (def.key === 'team') def.categories = [...TEAMS];
    if (def.key === 'level') def.categories = ['L1', 'L2', 'L3', 'L4', 'L5'];
    if (def.key === 'location') def.categories = [...LOCATIONS].sort();
    if (def.key === 'tenure_band') def.categories = [...TENURE];
  }
  const brokerName = byId.get(broker)?.name ?? broker;
  project.meta.notes =
    `Fictional data, generated by scripts/generate-demo.ts with seed ${String(seed)}. ` +
    `It contains a broker (${brokerName}, Operations), a siloed team (Finance), ` +
    `a pocket of reciprocated negative valence (${[...negativePocket].join(', ')}), ` +
    `and a formal–informal mismatch (Product and Sales: formal without informal; ` +
    `${[...informalGroup].join(', ')}: informal without formal).`;
  return project;
}

const isMain = process.argv[1]?.endsWith('generate-demo.ts') ?? false;
if (isMain) {
  const out = join(import.meta.dirname, '..', 'src', 'demo', 'demo.ona.json');
  writeFileSync(out, serialiseProject(generateDemo()));
  console.log(`Wrote ${out}`);
}
