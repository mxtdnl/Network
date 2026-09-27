import { useId } from 'react';
import type { SurveyLayer } from '../data/schema';
import type { Answer } from '../survey/response';
import { respondCopy as C } from './copy';

/** The "Does not apply" answer while the respondent works; sent as a list of
 *  positions, never as a value (D102). */
export const NOT_APPLICABLE = '\u0000not-applicable';

export interface ScaleOption {
  value: number | string;
  /** Shown on the option: the number, or the category label. */
  mark: string;
  label: string | undefined;
  /** The "Does not apply" answer, shown apart from the scale. */
  na?: true;
}

/** The answers a layer offers, lowest first, then "Does not apply" if offered. */
export function scaleOptions(layer: SurveyLayer): ScaleOption[] {
  const out: ScaleOption[] = [];
  if (layer.scale_type === 'categorical') {
    for (const c of layer.categories ?? []) {
      out.push({ value: c, mark: layer.category_labels?.[c] ?? c, label: undefined });
    }
  } else {
    for (let v = layer.min; v <= layer.max; v++) {
      const mark = v > 0 && layer.signed ? `+${String(v)}` : String(v).replace('-', '−');
      out.push({ value: v, mark, label: layer.scale_labels?.[String(v)] });
    }
  }
  if (layer.offer_not_applicable) {
    out.push({ value: NOT_APPLICABLE, mark: C.rate.notApplicable, label: undefined, na: true });
  }
  return out;
}

export function answerLabel(layer: SurveyLayer, answer: Answer): string {
  if (answer === NOT_APPLICABLE) return C.rate.notApplicable;
  const o = scaleOptions(layer).find((x) => x.value === answer);
  if (!o) return C.review.notAnswered;
  return o.label ? `${o.mark} (${o.label})` : o.mark;
}

interface ScaleProps {
  layer: SurveyLayer;
  /** Radio group name; unique per question and colleague. */
  name: string;
  value: Answer;
  onChange: (value: Answer) => void;
  legend: string;
  /** Shown once the respondent has tried to move on without answering. */
  missing: boolean;
  missingText: string;
}

/**
 * One question for one colleague on a phone: the scale as a joined row of
 * large options, each a native radio (so arrow keys and screen readers work as
 * expected), every scale label written out beneath, and "Does not apply", when
 * offered, as a separate option so it is never read as a point on the scale.
 */
export function Scale({ layer, name, value, onChange, legend, missing, missingText }: ScaleProps) {
  const labelsId = useId();
  const missingId = useId();
  const options = scaleOptions(layer);
  const points = options.filter((o) => !o.na);
  const na = options.find((o) => o.na);
  const categorical = layer.scale_type === 'categorical';
  const labelled = points.filter((o) => o.label);
  const describedBy = [labelled.length > 0 ? labelsId : '', missing ? missingId : '']
    .filter(Boolean)
    .join(' ');
  const option = (o: ScaleOption) => (
    <label
      key={String(o.value)}
      className={o.na ? 'scale__option scale__option--na' : 'scale__option'}
    >
      <input
        type="radio"
        className="scale__input"
        name={name}
        checked={value === o.value}
        onChange={() => {
          onChange(o.value);
        }}
      />
      <span className="scale__mark num" aria-hidden="true">
        {o.mark}
      </span>
      <span className="visually-hidden">{C.rate.option(o.mark, o.label)}</span>
    </label>
  );
  return (
    <fieldset
      className={missing ? 'scale scale--missing' : 'scale'}
      aria-describedby={describedBy || undefined}
      data-missing={missing ? '' : undefined}
    >
      <legend className="scale__question">{legend}</legend>
      {missing && (
        <p id={missingId} className="scale__missing">
          {missingText}
        </p>
      )}
      <div className={categorical ? 'scale__options scale__options--list' : 'scale__options'}>
        {points.map(option)}
      </div>
      {labelled.length > 0 && (
        <dl id={labelsId} className="scale__labels">
          {labelled.map((o) => (
            <div key={String(o.value)} className="scale__label-row">
              <dt className="num">{o.mark}</dt>
              <dd>{o.label}</dd>
            </div>
          ))}
        </dl>
      )}
      {na && <div className="scale__na">{option(na)}</div>}
    </fieldset>
  );
}
