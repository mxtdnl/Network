import { useId, useMemo, useState } from 'react';
import type { BootstrapMetric } from '../engineClient';
import { Icon } from '../components/Icon';
import { percent } from '../copy/data';
import { formatScale, mapCopy } from '../copy/map';
import { DIRECTED_METRICS, SYMMETRISED_METRICS, metricCopy } from '../copy/metrics';
import { tableCopy } from '../copy/table';
import { rankInterval } from '../map/rank';
import { drawableLayers, useMapData, type MapData } from '../map/useMapModel';
import { useMemberNames } from '../state/names';
import { useAppStore, type SizeMetric } from '../state/store';
import { cancelBootstrap, runBootstrap } from '../state/tools';
import { downloadText, toCsv } from './csv';
import { EmptyState } from './EmptyState';

const T = tableCopy;

type SortKey = 'name' | 'group' | 'community' | 'rank' | SizeMetric;

interface Row {
  index: number;
  id: string;
  name: string;
  group: string;
  community: number | null;
  values: Partial<Record<SizeMetric, number>>;
  rankLow: number;
  rankHigh: number;
}

// The metrics table (spec §8): one row per member shown, the metrics of the
// layer the map draws ties from, sortable by any column and exportable as
// CSV. Selection and the subgroup are shared with the map and the matrix.
export function TableView() {
  const project = useAppStore((s) => s.data.project);
  const data = useMapData();
  if (!project || project.members.length === 0) return <EmptyState />;
  if (!data) return <p className="placeholder">{mapCopy.calculating}</p>;
  return <MetricsTable data={data} />;
}

function MetricsTable({ data }: { data: MapData }) {
  const { project, result, settings, model } = data;
  const selected = useAppStore((s) => s.selection.member);
  const group = useAppStore((s) => s.selection.group);
  const bootstrap = useAppStore((s) => s.tools.bootstrap);
  const selectMember = useAppStore((s) => s.selectMember);
  const toggleGroupMember = useAppStore((s) => s.toggleGroupMember);
  const setRightPanel = useAppStore((s) => s.setRightPanel);
  const setMap = useAppStore((s) => s.setMap);
  const setStatus = useAppStore((s) => s.setStatus);
  const names = useMemberNames();
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({
    key: settings.sizeMetric,
    descending: true,
  });
  const [bootMetric, setBootMetric] = useState<string>('');
  const layerId = useId();
  const metricId = useId();
  const captionId = useId();

  const ref = result.refs[settings.layer];
  const metrics = (result.view === 'directed' ? DIRECTED_METRICS : SYMMETRISED_METRICS).filter(
    (m) => ref?.node.columns[m] !== undefined,
  );
  const layerLabel = (key: string) =>
    key === 'composite'
      ? mapCopy.controls.composite
      : (project.layers.find((l) => l.key === key)?.label ?? key);
  const fillKey = settings.fill.kind === 'attribute' ? settings.fill.key : settings.groupBy;
  const fillAttr = project.attribute_definitions.find((a) => a.key === fillKey);
  const interval =
    bootstrap?.status === 'ready' &&
    bootstrap.ref === settings.layer &&
    bootstrap.inputKey === result.inputKey
      ? bootstrap.result
      : null;
  const inGroup = new Set(group);

  const rows = useMemo(() => {
    const out: Row[] = [];
    for (const node of model.nodes) {
      if (!node.visible) continue;
      const m = project.members[node.index];
      if (!m) continue;
      const values: Row['values'] = {};
      for (const k of metrics) values[k] = ref?.node.columns[k]?.[node.index] ?? NaN;
      out.push({
        index: node.index,
        id: m.id,
        name: names.of(m.id),
        group: fillAttr ? (m.attributes[fillAttr.key] ?? '') : '',
        community: ref?.communities ? (ref.communities.membership[node.index] ?? 0) + 1 : null,
        values,
        rankLow: interval ? (interval.rankLow[node.index] ?? NaN) : NaN,
        rankHigh: interval ? (interval.rankHigh[node.index] ?? NaN) : NaN,
      });
    }
    const dir = sort.descending ? -1 : 1;
    const val = (r: Row): number | string => {
      switch (sort.key) {
        case 'name':
          return r.name;
        case 'group':
          return r.group;
        case 'community':
          return r.community ?? NaN;
        case 'rank':
          return r.rankLow;
        default:
          return r.values[sort.key] ?? NaN;
      }
    };
    return out.sort((a, b) => {
      const x = val(a);
      const y = val(b);
      if (typeof x === 'string' || typeof y === 'string')
        return (
          dir * String(x).localeCompare(String(y), 'en-GB') || a.name.localeCompare(b.name, 'en-GB')
        );
      // Values that are not defined go last in either direction.
      const xn = Number.isFinite(x);
      const yn = Number.isFinite(y);
      if (xn !== yn) return xn ? -1 : 1;
      return (xn && yn ? dir * (x - y) : 0) || a.name.localeCompare(b.name, 'en-GB');
    });
  }, [model, project, names, metrics, ref, fillAttr, interval, sort]);

  const formatted = useMemo(() => {
    const out: Partial<Record<SizeMetric, string[]>> = {};
    for (const m of metrics) out[m] = formatScale(rows.map((r) => r.values[m] ?? NaN));
    return out;
  }, [rows, metrics]);

  const columns: { key: SortKey; label: string; numeric: boolean }[] = [
    { key: 'name', label: T.member, numeric: false },
    ...(fillAttr ? [{ key: 'group' as const, label: fillAttr.label, numeric: false }] : []),
    ...(ref?.communities ? [{ key: 'community' as const, label: T.community, numeric: true }] : []),
    ...metrics.flatMap((m) => [
      { key: m, label: metricCopy[m].label, numeric: true },
      ...(interval && interval.metric === m
        ? [{ key: 'rank' as const, label: T.rankRange, numeric: true }]
        : []),
    ]),
  ];

  const exportCsv = () => {
    const header = columns.map((c) =>
      c.key === 'rank' && interval ? T.rankRangeLong(metricCopy[interval.metric].label) : c.label,
    );
    const lines = rows.map((r) =>
      columns.map((c) => {
        switch (c.key) {
          case 'name':
            return r.name;
          case 'group':
            return r.group;
          case 'community':
            return r.community === null ? '' : String(r.community);
          case 'rank':
            return Number.isFinite(r.rankLow) ? `${String(r.rankLow)}–${String(r.rankHigh)}` : '';
          default: {
            const v = r.values[c.key] ?? NaN;
            return Number.isFinite(v) ? String(v) : '';
          }
        }
      }),
    );
    const file = `graticule-metrics-${settings.layer}-${result.view}.csv`;
    downloadText(file, toCsv([header, ...lines]), 'text/csv');
    setStatus({ text: T.exported(file), tone: 'info' });
  };

  const bootMetrics = metrics.filter(
    (m): m is BootstrapMetric & SizeMetric => m !== ('betweennessBinary' as SizeMetric),
  );
  const chosenMetric = (bootMetric ||
    (bootMetrics.includes(settings.sizeMetric) ? settings.sizeMetric : bootMetrics[0]) ||
    '') as BootstrapMetric;
  const running = bootstrap?.status === 'running';

  return (
    <div className="table-view">
      <div className="view-toolbar">
        <div className="field field--inline">
          <label htmlFor={layerId} className="field__label">
            {T.layer}
          </label>
          <select
            id={layerId}
            className="select"
            value={settings.layer}
            onChange={(e) => {
              setMap({ layer: e.currentTarget.value });
            }}
          >
            {drawableLayers(project, result).map((key) => (
              <option key={key} value={key}>
                {layerLabel(key)}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="button button--secondary"
          onClick={exportCsv}
          disabled={rows.length === 0}
        >
          {T.export}
        </button>
        <p className="field__help view-toolbar__help">{T.exportHelp}</p>
      </div>

      <section className="stability" aria-labelledby={`${metricId}-heading`}>
        <h3 id={`${metricId}-heading`} className="member__heading">
          {T.stability.heading}
        </h3>
        <p className="field__help">
          {T.stability.help(
            project.settings.bootstrap.replicates,
            percent(project.settings.bootstrap.drop_fraction),
          )}
        </p>
        <div className="stability__controls">
          <div className="field field--inline">
            <label htmlFor={metricId} className="field__label">
              {T.stability.metric}
            </label>
            <select
              id={metricId}
              className="select"
              value={chosenMetric}
              disabled={running}
              onChange={(e) => {
                setBootMetric(e.currentTarget.value);
              }}
            >
              {bootMetrics.map((m) => (
                <option key={m} value={m}>
                  {metricCopy[m].label}
                </option>
              ))}
            </select>
          </div>
          {running ? (
            <button type="button" className="button button--secondary" onClick={cancelBootstrap}>
              {T.stability.cancel}
            </button>
          ) : (
            <button
              type="button"
              className="button button--secondary"
              disabled={!chosenMetric}
              onClick={() => {
                runBootstrap(chosenMetric);
              }}
            >
              {T.stability.run}
            </button>
          )}
          {running && (
            <progress
              className="stability__progress"
              aria-label={T.stability.progress}
              max={1}
              value={bootstrap.progress}
            />
          )}
        </div>
        <p className="field__help" role="status">
          {bootstrap?.status === 'running' && T.stability.running(percent(bootstrap.progress))}
          {bootstrap?.status === 'cancelled' && T.stability.cancelled}
          {bootstrap?.status === 'error' && T.stability.failed(bootstrap.error)}
          {interval && T.stability.ready(metricCopy[interval.metric].label, interval.replicates)}
        </p>
      </section>

      {rows.length === 0 ? (
        <p className="placeholder">{T.noRows}</p>
      ) : (
        <div className="table-view__scroll">
          <table className="data-table" aria-labelledby={captionId}>
            <caption id={captionId} className="data-table__caption">
              {T.caption(layerLabel(settings.layer), rows.length)}
            </caption>
            <thead>
              <tr>
                <th scope="col" className="data-table__check">
                  {T.inGroup}
                </th>
                {columns.map((c) => {
                  const active = sort.key === c.key;
                  return (
                    <th
                      key={c.key}
                      scope="col"
                      className={c.numeric ? 'numeric' : undefined}
                      aria-sort={
                        active ? (sort.descending ? 'descending' : 'ascending') : undefined
                      }
                    >
                      <button
                        type="button"
                        className="data-table__sort"
                        aria-label={T.sortBy(c.label)}
                        onClick={() => {
                          setSort((s) =>
                            s.key === c.key
                              ? { key: c.key, descending: !s.descending }
                              : { key: c.key, descending: c.numeric },
                          );
                        }}
                      >
                        {c.label}
                        {active && <Icon name={sort.descending ? 'collapse' : 'chevron-up'} />}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, k) => (
                <tr
                  key={r.id}
                  className={
                    r.id === selected ? 'is-selected' : inGroup.has(r.id) ? 'is-grouped' : undefined
                  }
                  data-member={r.id}
                >
                  <td className="data-table__check">
                    <input
                      type="checkbox"
                      aria-label={T.addToGroup(r.name)}
                      checked={inGroup.has(r.id)}
                      onChange={() => {
                        toggleGroupMember(r.id);
                      }}
                    />
                  </td>
                  {columns.map((c) => {
                    if (c.key === 'name')
                      return (
                        <th key={c.key} scope="row">
                          <button
                            type="button"
                            className="link-button data-table__member"
                            aria-current={r.id === selected ? 'true' : undefined}
                            onClick={() => {
                              selectMember(r.id);
                              setRightPanel('member');
                            }}
                          >
                            {r.name}
                          </button>
                        </th>
                      );
                    let text: string;
                    if (c.key === 'group') text = r.group || mapCopy.legend.notRecorded;
                    else if (c.key === 'community')
                      text = r.community === null ? '–' : String(r.community);
                    else if (c.key === 'rank') text = rankInterval(r.rankLow, r.rankHigh);
                    else text = formatted[c.key]?.[k] ?? '';
                    return (
                      <td key={c.key} className={c.numeric ? 'numeric' : undefined}>
                        {text === 'Not defined' ? (
                          <span className="data-table__undefined">{T.notDefined}</span>
                        ) : (
                          text
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
