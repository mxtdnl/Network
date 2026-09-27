// Reading and writing single ratings, for matrix entry and paste (spec §5).
// Typed and pasted values follow the same rules as imported ones: nothing is
// coerced, self-pairs are never stored, and clearing a cell removes the rating
// (it becomes "not entered"), which is different from entering 0.

import {
  DEFAULT_WAVE,
  isCategorical,
  tieKey,
  type LayerDefinition,
  type MemberId,
  type Project,
  type RatingValue,
  type Tie,
} from './schema';

/** Visual and semantic state of one matrix cell. */
export type CellState = 'self' | 'not-rated' | 'declined' | 'zero' | 'value';

export function cellState(rater: MemberId, ratee: MemberId, tie: Tie | undefined): CellState {
  if (rater === ratee) return 'self';
  if (tie === undefined) return 'not-rated';
  if (tie.value === null) return 'declined';
  if (tie.value === 0) return 'zero';
  return 'value';
}

export type ParsedInput =
  | { kind: 'value'; value: number | string }
  | { kind: 'clear' }
  | { kind: 'error'; code: 'non_numeric' | 'out_of_range' | 'unknown_category' };

const NUMBER = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;

/** Short code shown in a categorical cell: the first letter of each label. */
export function categoryCodes(layer: LayerDefinition): Map<string, string> {
  const codes = new Map<string, string>();
  for (const c of layer.categories ?? []) {
    const label = layer.category_labels?.[c] ?? c;
    codes.set(c, label.charAt(0).toUpperCase());
  }
  return codes;
}

export function parseRatingInput(layer: LayerDefinition, raw: string): ParsedInput {
  const text = raw.trim();
  if (text === '') return { kind: 'clear' };
  if (isCategorical(layer)) {
    const lower = text.toLowerCase();
    const codes = categoryCodes(layer);
    const codeCounts = new Map<string, number>();
    for (const code of codes.values()) codeCounts.set(code, (codeCounts.get(code) ?? 0) + 1);
    for (const c of layer.categories ?? []) {
      const label = layer.category_labels?.[c] ?? c;
      const code = codes.get(c) ?? '';
      const uniqueCode = codeCounts.get(code) === 1;
      if (
        lower === c.toLowerCase() ||
        lower === label.toLowerCase() ||
        (uniqueCode && lower === code.toLowerCase())
      ) {
        return { kind: 'value', value: c };
      }
    }
    return { kind: 'error', code: 'unknown_category' };
  }
  if (!NUMBER.test(text)) return { kind: 'error', code: 'non_numeric' };
  const n = Number(text);
  if (n < layer.min || n > layer.max) return { kind: 'error', code: 'out_of_range' };
  return { kind: 'value', value: n };
}

export type RatingChange =
  | { rater: MemberId; ratee: MemberId; kind: 'set'; value: RatingValue }
  | { rater: MemberId; ratee: MemberId; kind: 'clear' };

/** Applies changes to one layer's wave-1 ratings. Self-pairs are ignored. */
export function applyRatingChanges(
  project: Project,
  variable: string,
  changes: readonly RatingChange[],
  now: string,
): Project {
  const pending = new Map<string, RatingChange>();
  for (const c of changes) {
    if (c.rater === c.ratee) continue;
    pending.set(tieKey(c.rater, c.ratee, variable, DEFAULT_WAVE), c);
  }
  if (pending.size === 0) return project;

  const ties: Tie[] = [];
  for (const t of project.ties) {
    const key = tieKey(t.rater_id, t.ratee_id, t.variable, t.wave);
    const change = pending.get(key);
    if (!change) {
      ties.push(t);
      continue;
    }
    pending.delete(key);
    if (change.kind === 'set') {
      // An edited rating is the analyst's entry now, whatever its origin.
      const edited: Tie = { ...t, value: change.value, source: 'entered' };
      delete edited.survey;
      ties.push(edited);
    }
  }
  for (const c of pending.values()) {
    if (c.kind === 'set') {
      ties.push({
        rater_id: c.rater,
        ratee_id: c.ratee,
        variable,
        value: c.value,
        wave: DEFAULT_WAVE,
        source: 'entered',
      });
    }
  }
  return { ...project, meta: { ...project.meta, modified_at: now }, ties };
}

/** Index of one layer's wave-1 ratings by rater and ratee. */
export function layerIndex(ties: readonly Tie[], variable: string): Map<string, Tie> {
  const index = new Map<string, Tie>();
  for (const t of ties) {
    if (t.variable === variable && t.wave === DEFAULT_WAVE) {
      index.set(pairKey(t.rater_id, t.ratee_id), t);
    }
  }
  return index;
}

export function pairKey(rater: MemberId, ratee: MemberId): string {
  return `${rater}\u0000${ratee}`;
}

// ------------------------------------------------------------------ paste

export interface PasteSkip {
  rater: MemberId;
  ratee: MemberId;
  text: string;
  reason: 'self' | 'non_numeric' | 'out_of_range' | 'unknown_category';
}

export interface PastePlan {
  changes: RatingChange[];
  set: number;
  cleared: number;
  skipped: PasteSkip[];
  /** Cells that fell outside the grid and were not pasted. */
  outside: number;
}

/** Splits spreadsheet clipboard text (tab-separated rows) into cells. */
export function parseClipboardGrid(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines.map((line) => line.split('\t'));
}

/** Plans a paste of a block of cells with its top-left cell at (row, col). */
export function planPaste(
  layer: LayerDefinition,
  order: readonly MemberId[],
  row: number,
  col: number,
  grid: readonly string[][],
): PastePlan {
  const plan: PastePlan = { changes: [], set: 0, cleared: 0, skipped: [], outside: 0 };
  grid.forEach((cells, r) => {
    cells.forEach((text, c) => {
      const rater = order[row + r];
      const ratee = order[col + c];
      if (rater === undefined || ratee === undefined) {
        plan.outside += 1;
        return;
      }
      if (rater === ratee) {
        if (text.trim() !== '') plan.skipped.push({ rater, ratee, text, reason: 'self' });
        return;
      }
      const parsed = parseRatingInput(layer, text);
      if (parsed.kind === 'error') {
        plan.skipped.push({ rater, ratee, text, reason: parsed.code });
      } else if (parsed.kind === 'clear') {
        plan.changes.push({ rater, ratee, kind: 'clear' });
        plan.cleared += 1;
      } else {
        plan.changes.push({ rater, ratee, kind: 'set', value: parsed.value });
        plan.set += 1;
      }
    });
  });
  return plan;
}
