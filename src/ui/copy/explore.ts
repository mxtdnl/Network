// Wording for the explore tools (spec §8): ego view, shortest path, subgroup
// and resilience. Neutral: they describe the network, never a person.

const num = (value: number) => value.toLocaleString('en-GB');
const count = (value: number, one: string, many: string) =>
  `${num(value)} ${value === 1 ? one : many}`;

export const exploreCopy = {
  tab: 'Explore',
  empty: 'Add data to explore ego views, paths, subgroups and resilience.',
  onLayer: (layer: string) => `Uses ties from ${layer}, as on the map.`,
  member: 'Member',
  none: 'Choose a member',

  ego: {
    heading: 'Ego view',
    help: 'Shows one member and everyone within one or two steps of them along the ties shown, in every view.',
    depth: 'Depth',
    one: '1 step',
    two: '2 steps',
    show: 'Show ego view',
    clear: 'Show everyone',
    active: (name: string, n: number) =>
      `Showing ${name} and ${count(n, 'other member', 'other members')}.`,
  },

  path: {
    heading: 'Shortest path',
    help: 'The strongest route between two members: the chain of ties with the smallest total distance, where each tie counts as 1 ÷ its strength.',
    from: 'From',
    to: 'To',
    find: 'Find path',
    clear: 'Clear path',
    same: 'Choose two different members.',
    finding: 'Finding the path…',
    none: (from: string, to: string) =>
      `No path leads from ${from} to ${to} on this layer. They are in separate parts of the network.`,
    distance: 'Distance',
    steps: 'Steps',
    alternatives: 'Equally short paths',
    route: 'Route',
    select: (name: string) => `Show ${name}`,
    failed: (reason: string) => `The path could not be found. ${reason}`,
  },

  group: {
    heading: 'Subgroup',
    help: 'Shift-click members on the map, draw round them with Lasso select, or tick them in the table.',
    empty: 'No subgroup yet.',
    members: (n: number) => count(n, 'member', 'members'),
    remove: (name: string) => `Take ${name} out of the subgroup`,
    addSelected: 'Add the selected member',
    clear: 'Clear subgroup',
    density: 'Tie density',
    inside: 'Inside the subgroup',
    outside: 'With everyone else',
    ties: (ties: number, possible: number) => `${num(ties)} of ${num(possible)} possible`,
    ei: 'E-I index',
    eiHelp:
      '−1 means every tie stays inside the subgroup; +1 means every tie reaches outside it. Counts ties, not their strength.',
    notDefined: 'Not defined',
    tooSmall: 'Add at least two members to compare ties inside and outside.',
    simulate: 'Simulate their removal',
  },

  resilience: {
    heading: 'Resilience',
    help: 'Remove members in a simulation and compare the network before and after. Nothing in the project changes.',
    toRemove: 'Members to remove',
    add: 'Add',
    addGroup: 'Add the subgroup',
    remove: (name: string) => `Keep ${name}`,
    none: 'No members chosen yet.',
    run: 'Run simulation',
    end: 'End simulation',
    running: 'Simulating…',
    failed: (reason: string) => `The simulation could not run. ${reason}`,
    measure: 'Measure',
    before: 'Before',
    after: 'After',
    change: 'Change',
    components: 'Separate parts',
    componentsStrong: 'Groups that can all reach each other',
    largest: 'Members in the largest part',
    reachability: 'Pairs that can reach each other',
    distance: 'Average distance, reachable pairs',
    steps: 'Average steps, reachable pairs',
    caveat:
      'Averages count only pairs that can still reach each other, so they can fall when the network splits. Read them with reachability.',
  },
};
