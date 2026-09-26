// Design tokens for the map, read from the CSS custom properties in
// src/styles/tokens.css. The canvas cannot use CSS, so colours and sizes are
// read with getComputedStyle once and passed to the scene builder (the same
// approach as the matrix, CLAUDE.md D31). No design value is written here.

export interface MapTheme {
  ink: string;
  graphite: string;
  stone: string;
  paper: string;
  categorical: string[];
  other: string;
  /** Diverging valence scale, −3 … +3. */
  valence: string[];
  /** Node radius range in CSS pixels, and the radius of a member whose size metric is not defined. */
  nodeMin: number;
  nodeMax: number;
  nodeUndefined: number;
  edgeMin: number;
  edgeMax: number;
  arrow: number;
  dash: number;
  gap: number;
  dot: number;
  /** Offset between the two directions of a reciprocated tie, and between the lines of a "both" tie. */
  pairOffset: number;
  line: number;
  focusWidth: number;
  fade: number;
  labelFont: string;
  labelSize: number;
  labelGap: number;
  /** Length of a legend line sample. */
  swatch: number;
}

export const TOKEN_NAMES = {
  categorical: [
    '--cat-1',
    '--cat-2',
    '--cat-3',
    '--cat-4',
    '--cat-5',
    '--cat-6',
    '--cat-7',
    '--cat-8',
  ],
  valence: ['--val-n3', '--val-n2', '--val-n1', '--val-0', '--val-p1', '--val-p2', '--val-p3'],
} as const;

export function readMapTheme(element: Element = document.documentElement): MapTheme {
  const style = getComputedStyle(element);
  const text = (name: string) => style.getPropertyValue(name).trim();
  const number = (name: string) => {
    const v = Number.parseFloat(text(name));
    if (!Number.isFinite(v)) throw new Error(`Design token ${name} is missing or not a number.`);
    return v;
  };
  return {
    ink: text('--ink'),
    graphite: text('--graphite'),
    stone: text('--stone'),
    paper: text('--paper'),
    categorical: TOKEN_NAMES.categorical.map(text),
    other: text('--cat-other'),
    valence: TOKEN_NAMES.valence.map(text),
    nodeMin: number('--map-node-min'),
    nodeMax: number('--map-node-max'),
    nodeUndefined: number('--map-node-undefined'),
    edgeMin: number('--map-edge-min'),
    edgeMax: number('--map-edge-max'),
    arrow: number('--map-arrow'),
    dash: number('--map-dash'),
    gap: number('--map-gap'),
    dot: number('--map-dot'),
    pairOffset: number('--map-pair-offset'),
    line: number('--line-width'),
    focusWidth: number('--focus-width'),
    fade: number('--map-fade'),
    labelFont: `${text('--weight-medium')} ${text('--t--1-size')} ${text('--font-condensed')}`,
    labelSize: number('--t--1-size'),
    labelGap: number('--s-1'),
    swatch: number('--map-legend-swatch'),
  };
}
