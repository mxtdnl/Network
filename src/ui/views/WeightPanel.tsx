import { useId } from 'react';
import type { CompositeFormula } from '../engineClient';
import { formatWeight } from '../copy/map';
import { weightsCopy } from '../copy/weights';
import { PRESETS, effectiveWeights, weightedLayers, type Preset } from '../state/presets';
import { useAppStore } from '../state/store';
import type { SignedTreatment } from '../state/presets';
import { formulaLines } from './formula';

const W = weightsCopy;
const TREATMENTS: readonly SignedTreatment[] = ['positive', 'filterNegative', 'multiplier'];

// The weight panel (spec §7, design-system §5.1): a preset, one slider per
// weighted layer with its share of the composite, a treatment for each signed
// layer, and the formula beneath in the same order. Shares and the formula
// come from the engine's formula object for the analysis on screen.
export function WeightPanel() {
  const project = useAppStore((s) => s.data.project);
  const weights = useAppStore((s) => s.weights);
  const formula = useAppStore((s) => s.results.current?.composite ?? null);
  const running = useAppStore((s) => s.results.status === 'running');
  const setPreset = useAppStore((s) => s.setPreset);
  const setLayerWeight = useAppStore((s) => s.setLayerWeight);
  const setTreatment = useAppStore((s) => s.setTreatment);
  const presetId = useId();
  const presetHelpId = useId();
  const shareHelpId = useId();
  const baseId = useId();

  if (!project) return null;
  const layers = weightedLayers(project);
  if (layers.length === 0) return <p className="placeholder">{W.noLayers}</p>;
  const current = effectiveWeights(project, weights);

  const shareOf = (key: string): string => {
    const raw = current.weights[key] ?? 0;
    if (raw <= 0) return W.notUsed;
    const treatment = current.signedTreatment[key];
    if (treatment === 'filterNegative') return W.asFilter;
    if (treatment === 'multiplier') return W.asMultiplier;
    const term = formula?.terms.find((t) => t.layer === key);
    return term ? formatWeight(term.weight) : '–';
  };

  return (
    <div className="weights">
      <div className="field">
        <label htmlFor={presetId} className="field__label">
          {W.preset}
        </label>
        <select
          id={presetId}
          className="select"
          value={weights.preset}
          aria-describedby={presetHelpId}
          onChange={(e) => {
            setPreset(e.currentTarget.value as Preset);
          }}
        >
          {PRESETS.map((p) => (
            <option key={p} value={p}>
              {W.presets[p]}
            </option>
          ))}
        </select>
        <p id={presetHelpId} className="field__help">
          {W.presetHelp[weights.preset]}
        </p>
      </div>

      <div className="weights__sliders">
        <p className="weights__share-heading" id={shareHelpId}>
          <span className="visually-hidden">{W.shareHelp}</span>
          <span aria-hidden="true">{W.share}</span>
        </p>
        {layers.map((layer) => {
          const id = `${baseId}-${layer.key}`;
          const raw = current.weights[layer.key] ?? 0;
          const share = shareOf(layer.key);
          const treatment = current.signedTreatment[layer.key] ?? 'positive';
          return (
            <div key={layer.key} className="field weights__layer">
              <div className="field__row">
                <label htmlFor={id} className="field__label">
                  {layer.label}
                </label>
                <output htmlFor={id} className="field__value weights__share">
                  {share}
                </output>
              </div>
              <input
                id={id}
                type="range"
                className="range"
                min={0}
                max={1}
                step={0.05}
                value={raw}
                aria-describedby={shareHelpId}
                aria-valuetext={W.sliderText(formatWeight(raw), share)}
                onChange={(e) => {
                  setLayerWeight(layer.key, Number(e.currentTarget.value));
                }}
              />
              {layer.signed && (
                <div className="field weights__treatment">
                  <label htmlFor={`${id}-treatment`} className="field__help">
                    {W.treatment(layer.label)}
                  </label>
                  <select
                    id={`${id}-treatment`}
                    className="select"
                    value={treatment}
                    onChange={(e) => {
                      setTreatment(layer.key, e.currentTarget.value as SignedTreatment);
                    }}
                  >
                    {TREATMENTS.map((t) => (
                      <option key={t} value={t}>
                        {W.treatments[t]}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <FormulaView formula={formula} running={running} />
    </div>
  );
}

/** The live formula, rendered line by line from the engine's formula object. */
export function FormulaView({
  formula,
  running = false,
}: {
  formula: CompositeFormula | null;
  running?: boolean;
}) {
  const headingId = useId();
  return (
    <section className="formula" aria-labelledby={headingId} aria-busy={running}>
      <h3 id={headingId} className="formula__heading">
        {W.formula.heading}
      </h3>
      {formula ? (
        <>
          <p className="formula__lead">{W.formula.lead}</p>
          <ol className="formula__lines" data-testid="composite-formula">
            {formulaLines(formula).map((line, i) => (
              <li key={i} className={`formula__line formula__line--${line.kind}`}>
                {line.kind === 'term' ? (
                  <>
                    <span className="formula__op" aria-hidden={line.first}>
                      {line.first ? '' : '+'}
                    </span>
                    <span className="formula__weight num">{line.weight}</span>
                    <span className="formula__times">×</span>
                    <span className="formula__label">
                      {line.label}
                      {line.positiveOnly && (
                        <span className="formula__qualifier">, {W.formula.positiveOnly}</span>
                      )}
                    </span>
                  </>
                ) : (
                  <span className="formula__label">{line.text}</span>
                )}
              </li>
            ))}
          </ol>
          <p className="formula__note">{W.formula.note}</p>
        </>
      ) : (
        <p className="formula__note">{W.undefinedComposite}</p>
      )}
      {running && <p className="formula__note">{W.updating}</p>}
    </section>
  );
}
