// Wording for anonymisation (spec §8, §10). Sentence case, plain language.

export const namesCopy = {
  /** Replaces a name part in a caption that belongs to more than one member. */
  sharedName: '[name]',
  on: 'Names hidden. Members are shown by team, level and number, for example FIN-L3-02.',
  off: 'Names shown.',
  smallGroups: (count: number, examples: string) =>
    count === 1
      ? `One code belongs to a team and level with fewer than 3 members (${examples}), so it may still identify someone.`
      : `${String(count)} codes belong to a team and level with fewer than 3 members (${examples}), so they may still identify someone.`,
} as const;
