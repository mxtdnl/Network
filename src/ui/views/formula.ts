// The composite formula as display lines, built only from the engine's
// structured formula (CompositeFormula, src/engine/composite.ts). The weight
// panel renders these lines; nothing here recomputes a weight.

import type { CompositeFormula } from '../engineClient';
import { formatWeight } from '../copy/map';
import { weightsCopy } from '../copy/weights';

const F = weightsCopy.formula;

export type FormulaLine =
  | { kind: 'term'; first: boolean; weight: string; label: string; positiveOnly: boolean }
  | { kind: 'multiplier'; text: string }
  | { kind: 'filter'; text: string }
  | { kind: 'cap'; text: string };

export function formulaLines(formula: CompositeFormula): FormulaLine[] {
  const lines: FormulaLine[] = formula.terms.map((t, i) => ({
    kind: 'term',
    first: i === 0,
    weight: formatWeight(t.weight),
    label: t.label,
    positiveOnly: t.transform === 'positivePart',
  }));
  for (const m of formula.multipliers)
    lines.push({ kind: 'multiplier', text: F.multiplier(m.label, String(m.alpha)) });
  for (const f of formula.filters) lines.push({ kind: 'filter', text: F.filter(f.label) });
  lines.push({ kind: 'cap', text: F.cap(String(formula.cap)) });
  return lines;
}
