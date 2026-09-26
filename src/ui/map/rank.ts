// Ranks for the member panel: 1 is the highest value. Members with equal
// values share a range, so "3–6" means four members tie from third place.
// Members whose value is not defined are not ranked and do not count.

export const NOT_RANKED = '–';

export function rankOf(column: ArrayLike<number>, i: number): string {
  const v = column[i];
  if (v === undefined || !Number.isFinite(v)) return NOT_RANKED;
  let above = 0;
  let equal = 0;
  for (let k = 0; k < column.length; k++) {
    const x = column[k] as number;
    if (!Number.isFinite(x)) continue;
    if (x > v) above += 1;
    else if (x === v) equal += 1;
  }
  const lo = above + 1;
  const hi = above + equal;
  return lo === hi ? String(lo) : `${String(lo)}–${String(hi)}`;
}
