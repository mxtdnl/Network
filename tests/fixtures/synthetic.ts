// A synthetic 250-member project with about 10,000 directed ties, the size the
// map must stay interactive at (spec §8, Phase 4 acceptance). Seeded, so every
// run draws the same graph. Five teams of 50: ties are likelier within a team.
// Every tie also carries formal, informal and valence ratings, so all
// encodings are exercised; other pairs are left unrated, which puts data
// coverage far below the threshold (the map's coverage warning shows).

import { createProject } from '../../src/data/defaults';
import type { Member, Project, Tie } from '../../src/data/schema';
import { mulberry32 } from '../../src/engine/rng';

export const SYNTHETIC_SEED = 250;
const TEAMS = ['North', 'East', 'South', 'West', 'Centre'];

export function syntheticProject(n = 250, targetTies = 10_000): Project {
  const rng = mulberry32(SYNTHETIC_SEED);
  const project = createProject('Synthetic 250', '2026-09-26T09:00:00.000Z');
  const members: Member[] = Array.from({ length: n }, (_, i) => ({
    id: `S${String(i + 1).padStart(3, '0')}`,
    display_name: `Member ${String(i + 1).padStart(3, '0')}`,
    attributes: {
      team: TEAMS[i % TEAMS.length] ?? null,
      level: `L${String(1 + (i % 5))}`,
      location: i % 3 === 0 ? 'Leeds' : 'Bristol',
      tenure_band: null,
      manager_id: null,
    },
  }));
  const sameTeam = n / TEAMS.length - 1;
  const inside = n * sameTeam;
  const outside = n * (n - 1) - inside;
  // Half of the within-team pairs are tied; cross-team pairs make up the rest.
  const pIn = 0.5;
  const pOut = Math.max(0, (targetTies - inside * pIn) / outside);
  const ties: Tie[] = [];
  const add = (a: string, b: string, variable: string, value: number) => {
    ties.push({ rater_id: a, ratee_id: b, variable, value, wave: 1 });
  };
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const same = i % TEAMS.length === j % TEAMS.length;
      if (rng() >= (same ? pIn : pOut)) continue;
      const a = members[i]?.id ?? '';
      const b = members[j]?.id ?? '';
      add(a, b, 'connection_strength', 1 + Math.floor(rng() * 5));
      add(a, b, 'formal_collaboration', same ? Math.floor(rng() * 6) : Math.floor(rng() * 3));
      add(a, b, 'informal_collaboration', Math.floor(rng() * 6));
      add(a, b, 'valence', Math.floor(rng() * 7) - 3);
    }
  }
  return { ...project, members, ties };
}
