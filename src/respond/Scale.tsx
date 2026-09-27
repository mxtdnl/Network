import { useId } from 'react';
import type { SurveyLayer } from '../data/schema';
import type { Answer } from '../survey/response';
import { respondCopy as C } from './copy';

export interface ScaleOption {
  value: number | string;
  /** Shown on the option: the number, or the category label. */
  mark: string;
  label: string | undefined;
}

/** The answers a layer offers, lowest first (spec §4.2 scales). */
export function scaleOptions(layer: SurveyLayer): ScaleOption[] {
  if (layer.scale_type === 'categorical') {
    return (layer.categories ?? []).map((c) => {
      const label = layer.category_labels?.[c] ?? c;
      return { value: c, mark: label, label: undefined };
    });
  }
  const out: ScaleOption[] = [];
  for (let v = layer.min; v <= layer.max; v++) {
    const mark = v > 0 && layer.signed ? `+${String(v)}` : String(v).replace('-', '−');
    out.push({ value: v, mark, label: layer.scale_labels?.[String(v)] });
  }
  return out;
}

export function answerLabel(layer: SurveyLayer, answer: Answer): string {
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
  /** Id of the element naming the question (the legend is used when absent). */
  legend: string;
}

/**
 * One question for one colleague on a phone: large options in a row that
 * wraps, each a native radio (so arrow keys and screen readers work as
 * expected), with every scale label written out under the options.
 */
export function Scale({ layer, name, value, onChange, legend }: ScaleProps) {
  const labelsId = useId();
  const options = scaleOptions(layer);
  const categorical = layer.scale_type === 'categorical';
  const labelled = options.filter((o) => o.label);
  return (
    <fieldset className="scale" aria-describedby={labelled.length > 0 ? labelsId : undefined}>
      <legend className="scale__question">{legend}</legend>
      <div className={categorical ? 'scale__options scale__options--list' : 'scale__options'}>
        {options.map((o) => (
          <label key={String(o.value)} className="scale__option">
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
        ))}
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
    </fieldset>
  );
}
