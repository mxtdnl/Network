import { useId, useMemo, useState } from 'react';
import { computeCoverage } from '../../data/coverage';
import { Icon } from '../components/Icon';
import { coverageCopy, percent } from '../copy/data';
import { useMemberNames } from '../state/names';
import { useAppStore } from '../state/store';

export function useCoverage() {
  const project = useAppStore((s) => s.data.project);
  return useMemo(() => (project ? computeCoverage(project) : null), [project]);
}

// Response rate per rater and overall, with the configurable warning threshold
// (spec §6, data coverage).
export function CoveragePanel() {
  const project = useAppStore((s) => s.data.project);
  const coverage = useCoverage();
  const setThreshold = useAppStore((s) => s.setCoverageThreshold);
  const thresholdId = useId();
  const tableId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const names = useMemberNames();

  if (!project || !coverage || !Number.isFinite(coverage.rate)) {
    return <p className="placeholder">{coverageCopy.noData}</p>;
  }

  const raters = [...coverage.raters].sort(
    (a, b) => a.rate - b.rate || names.of(a.id).localeCompare(names.of(b.id)),
  );
  const shown = draft ?? String(Math.round(coverage.threshold * 100));
  const draftValid = /^\d{1,3}$/.test(shown) && Number(shown) <= 100;

  return (
    <div className="coverage">
      <dl className="definition-list definition-list--wide">
        <dt>{coverageCopy.overall}</dt>
        <dd className="num">
          {percent(coverage.rate)}
          {coverage.belowThreshold && (
            <span className="coverage__flag">
              <Icon name="warning" />
              {coverageCopy.below}
            </span>
          )}
        </dd>
      </dl>
      <p className="coverage__counts num">
        {coverageCopy.counts(coverage.rated, coverage.possible)}
      </p>
      <p className="coverage__explain">{coverageCopy.explain}</p>
      <h3 className="coverage__subheading">{coverageCopy.sourcesHeading}</h3>
      <dl className="definition-list definition-list--wide">
        {(['self_report', 'imported', 'entered', 'none'] as const).map((k) => {
          const n = project.ties.filter((t) => (t.source ?? 'none') === k).length;
          return n === 0 ? null : (
            <div key={k} className="coverage__source">
              <dt>{coverageCopy.sources[k]}</dt>
              <dd className="num">{n}</dd>
            </div>
          );
        })}
      </dl>

      <div className="field field--inline">
        <label htmlFor={thresholdId} className="field__label">
          {coverageCopy.threshold}
        </label>
        <span className="percent-input">
          <input
            id={thresholdId}
            className="text-input text-input--number num"
            inputMode="numeric"
            value={shown}
            aria-describedby={`${thresholdId}-help`}
            aria-invalid={!draftValid}
            onChange={(e) => {
              const text = e.currentTarget.value;
              setDraft(text);
              if (/^\d{1,3}$/.test(text) && Number(text) <= 100) setThreshold(Number(text) / 100);
            }}
            onBlur={() => {
              if (draftValid) setDraft(null);
            }}
          />
          <span aria-hidden="true">%</span>
        </span>
      </div>
      <p id={`${thresholdId}-help`} className="field__help">
        {draftValid ? coverageCopy.thresholdHelp : coverageCopy.thresholdInvalid}
      </p>

      <table className="coverage__table">
        <caption id={tableId} className="coverage__caption">
          {coverageCopy.tableCaption}
        </caption>
        <thead>
          <tr>
            <th scope="col">{coverageCopy.columns.member}</th>
            <th scope="col" className="numeric">
              {coverageCopy.columns.rate}
            </th>
            <th scope="col" className="numeric">
              {coverageCopy.columns.declined}
            </th>
            <th scope="col" className="numeric">
              {coverageCopy.columns.notEntered}
            </th>
          </tr>
        </thead>
        <tbody>
          {raters.map((r) => {
            const below = Number.isFinite(r.rate) && r.rate < coverage.threshold;
            return (
              <tr key={r.id}>
                <th scope="row" className="coverage__name">
                  {names.of(r.id)}
                </th>
                <td className="numeric">
                  {below && (
                    <span className="coverage__row-flag">
                      <Icon name="warning" />
                      <span className="visually-hidden">{coverageCopy.below}</span>
                    </span>
                  )}
                  {percent(r.rate)}
                </td>
                <td className="numeric">{r.declined}</td>
                <td className="numeric">{r.notEntered}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">{coverageCopy.totals}</th>
            <td className="numeric">{percent(coverage.rate)}</td>
            <td className="numeric">{coverage.declined}</td>
            <td className="numeric">{coverage.notEntered}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
