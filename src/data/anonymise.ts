// Role/team codes that replace member names when anonymisation is on (spec §8,
// §10; plan Q13). Pure: the UI applies these through one rendering layer,
// `ui/state/names.ts`, which is the only UI module allowed to read
// `display_name`.
//
// Format: <team abbreviation>-<level>-<nn>, for example "FIN-L3-02". The number
// counts members of the same team and level in project order, so a code is
// stable for as long as the member list is not reordered. A code whose team and
// level group has fewer than SMALL_GROUP members can identify the person, so
// those groups are reported for a warning.

import type { Member } from './schema';

/** Groups smaller than this are reported: their codes may identify someone. */
export const SMALL_GROUP = 3;

/** Attribute keys the code is built from. */
export const CODE_ATTRIBUTES = { team: 'team', level: 'level' } as const;

/** Stands in for a missing team or level. */
const MISSING = 'X';

export interface MemberCodes {
  /** One code per member, in project order. */
  codes: string[];
  /** Team–level groups with fewer than SMALL_GROUP members, e.g. "FIN-L5". */
  smallGroups: { prefix: string; size: number }[];
}

const letters = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .toUpperCase();

/** Candidate abbreviations for a team, most readable first. */
function candidates(team: string): string[] {
  const clean = letters(team);
  const words = clean.split(/\s+/).filter(Boolean);
  const joined = words.join('');
  const out: string[] = [];
  if (joined.length > 0) out.push(joined.slice(0, 3));
  if (words.length > 1)
    out.push(
      words
        .map((w) => w[0])
        .join('')
        .slice(0, 3),
    );
  if (joined.length > 3) out.push(`${joined.slice(0, 2)}${joined.slice(-1)}`);
  if (joined.length > 3) out.push(joined.slice(0, 4));
  return out.filter((c) => c.length > 0);
}

/** A distinct abbreviation per team value, in order of first appearance. */
export function teamAbbreviations(teams: readonly string[]): Map<string, string> {
  const result = new Map<string, string>();
  const used = new Set<string>([MISSING]);
  for (const team of teams) {
    if (result.has(team)) continue;
    const options = candidates(team);
    let chosen = options.find((c) => !used.has(c));
    if (!chosen) {
      const base = options[0] ?? 'T';
      for (let k = 2; !chosen; k++) {
        if (!used.has(`${base}${String(k)}`)) chosen = `${base}${String(k)}`;
      }
    }
    used.add(chosen);
    result.set(team, chosen);
  }
  return result;
}

function levelCode(level: string | null | undefined): string {
  if (level === null || level === undefined) return MISSING;
  const clean = letters(level).replace(/\s+/g, '').slice(0, 4);
  return clean === '' ? MISSING : clean;
}

export function memberCodes(members: readonly Pick<Member, 'attributes'>[]): MemberCodes {
  const teamOf = (m: Pick<Member, 'attributes'>) => m.attributes[CODE_ATTRIBUTES.team] ?? null;
  const abbreviations = teamAbbreviations(
    members.map(teamOf).filter((t): t is string => t !== null && letters(t).trim() !== ''),
  );
  const prefixes = members.map((m) => {
    const team = teamOf(m);
    const abbr = team === null ? MISSING : (abbreviations.get(team) ?? MISSING);
    return `${abbr}-${levelCode(m.attributes[CODE_ATTRIBUTES.level])}`;
  });
  const sizes = new Map<string, number>();
  for (const p of prefixes) sizes.set(p, (sizes.get(p) ?? 0) + 1);
  const width = Math.max(2, String(Math.max(0, ...sizes.values())).length);
  const counter = new Map<string, number>();
  const codes = prefixes.map((p) => {
    const k = (counter.get(p) ?? 0) + 1;
    counter.set(p, k);
    return `${p}-${String(k).padStart(width, '0')}`;
  });
  const smallGroups = [...sizes]
    .filter(([, size]) => size < SMALL_GROUP)
    .map(([prefix, size]) => ({ prefix, size }));
  return { codes, smallGroups };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Name parts shorter than this are not replaced on their own (initials, "Al"). */
const MIN_PART = 3;

/**
 * Replaces members' names in free text (captions) with their codes. Full
 * names are replaced first; then each part of a name (a first name or a
 * surname) of at least MIN_PART letters, matched case-sensitively as a whole
 * word. A part shared by several members is replaced with `shared`, because
 * no single code fits. This errs towards replacing too much: a caption word
 * that happens to equal a name part is replaced as well.
 */
export function replaceNames(
  text: string,
  names: readonly string[],
  codes: readonly string[],
  shared: string,
): string {
  if (text === '' || names.length === 0) return text;
  const replacements = new Map<string, string>();
  const parts = new Map<string, Set<number>>();
  names.forEach((name, i) => {
    const full = name.trim();
    if (full === '') return;
    replacements.set(full, codes[i] ?? shared);
    for (const part of full.split(/[\s‐-―-]+/)) {
      if (part.length < MIN_PART) continue;
      const owners = parts.get(part) ?? new Set<number>();
      owners.add(i);
      parts.set(part, owners);
    }
  });
  for (const [part, owners] of parts) {
    if (replacements.has(part)) continue;
    const [only] = owners;
    replacements.set(
      part,
      owners.size === 1 && only !== undefined ? (codes[only] ?? shared) : shared,
    );
  }
  // Longest first, so a full name is replaced before its parts.
  const keys = [...replacements.keys()].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${keys.map(escape).join('|')})(?![\\p{L}\\p{N}])`,
    'gu',
  );
  return text.replace(pattern, (m) => replacements.get(m) ?? shared);
}
