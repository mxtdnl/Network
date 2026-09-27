import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { DEFAULT_WAVE, isCategorical, type LayerDefinition, type Project } from '../../data/schema';
import type { AnalysisResult } from '../engineClient';
import { Icon } from '../components/Icon';
import { formatValue, mapCopy } from '../copy/map';
import { DIRECTED_METRICS, SYMMETRISED_METRICS, flagCopy, metricCopy } from '../copy/metrics';
import { shellCopy } from '../copy/shell';
import { focusMapMember } from '../map/focus';
import { rankInterval, rankOf } from '../map/rank';
import { drawableLayers, useMapData } from '../map/useMapModel';
import { useMemberNames, type MemberNames } from '../state/names';
import { useAppStore, type SizeMetric } from '../state/store';
import { simulateRemoval } from '../state/tools';

const P = mapCopy.panel;

function MetricInfo({ metric, flag }: { metric: SizeMetric; flag: string | null }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const copy = metricCopy[metric];
  return (
    <span className="metric-info">
      <button
        type="button"
        className="metric-info__button"
        aria-label={P.about(copy.label)}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => {
          setOpen((o) => !o);
        }}
        onMouseEnter={() => {
          setOpen(true);
        }}
        onMouseLeave={() => {
          setOpen(false);
        }}
        onFocus={() => {
          setOpen(true);
        }}
        onBlur={() => {
          setOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
      >
        <Icon name="info" />
      </button>
      {open && (
        <span id={id} role="tooltip" className="metric-info__popover">
          <span className="metric-info__meaning">{copy.meaning}</span>
          <span className="metric-info__caveat">{copy.caveat}</span>
          {flag && <span className="metric-info__flag">{flag}</span>}
          <span className="metric-info__technical">{P.technical(copy.technical)}</span>
        </span>
      )}
    </span>
  );
}

interface TieRow {
  id: string;
  name: string;
  /** A number, 'na' for "does not apply" (D102), or null for not rated. */
  given: number | 'na' | null;
  received: number | 'na' | null;
}

const sortable = (v: number | 'na' | null) => (typeof v === 'number' ? v : -Infinity);

function tiesFor(
  project: Project,
  names: MemberNames,
  memberId: string,
  layer: LayerDefinition,
): TieRow[] {
  const known = new Set(project.members.map((m) => m.id));
  const rows = new Map<string, TieRow>();
  const row = (id: string) => {
    let r = rows.get(id);
    if (!r) {
      r = { id, name: names.of(id), given: null, received: null };
      rows.set(id, r);
    }
    return r;
  };
  for (const t of project.ties) {
    if (t.variable !== layer.key || t.wave !== DEFAULT_WAVE) continue;
    const v = typeof t.value === 'number' ? t.value : t.not_applicable ? 'na' : null;
    if (v === null) continue;
    if (t.rater_id === memberId && known.has(t.ratee_id)) row(t.ratee_id).given = v;
    else if (t.ratee_id === memberId && known.has(t.rater_id)) row(t.rater_id).received = v;
  }
  return [...rows.values()].sort(
    (a, b) =>
      sortable(b.given) - sortable(a.given) ||
      sortable(b.received) - sortable(a.received) ||
      a.name.localeCompare(b.name, 'en-GB'),
  );
}

const rating = (v: number | 'na' | null) =>
  v === null ? P.notRated : v === 'na' ? P.notApplicable : formatValue(v);

function TiesByLayer({
  project,
  memberId,
  active,
}: {
  project: Project;
  memberId: string;
  active: string;
}) {
  const layers = project.layers.filter((l) => l.enabled && !isCategorical(l));
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const names = useMemberNames();
  const headingId = useId();
  const firstOpen = layers.some((l) => l.key === active) ? active : layers[0]?.key;
  return (
    <section className="member__section" aria-labelledby={headingId}>
      <h3 id={headingId} className="member__heading">
        {P.ties}
      </h3>
      {layers.map((layer) => {
        const expanded = open[layer.key] ?? layer.key === firstOpen;
        const rows = expanded ? tiesFor(project, names, memberId, layer) : [];
        const panelId = `${headingId}-${layer.key}`;
        return (
          <div key={layer.key} className="member__layer">
            <button
              type="button"
              className="member__disclosure"
              aria-expanded={expanded}
              aria-controls={panelId}
              onClick={() => {
                setOpen((o) => ({ ...o, [layer.key]: !expanded }));
              }}
            >
              <Icon name={expanded ? 'collapse' : 'expand'} />
              {layer.label}
            </button>
            <div id={panelId} hidden={!expanded}>
              {expanded &&
                (rows.length === 0 ? (
                  <p className="member__none">{P.noTies}</p>
                ) : (
                  <table className="member__table">
                    <thead>
                      <tr>
                        <th scope="col">
                          <span className="visually-hidden">{mapCopy.table.member}</span>
                        </th>
                        <th scope="col" className="numeric">
                          {P.given}
                        </th>
                        <th scope="col" className="numeric">
                          {P.received}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id}>
                          <th scope="row">{r.name}</th>
                          <td className="numeric">{rating(r.given)}</td>
                          <td className="numeric">{rating(r.received)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ))}
            </div>
          </div>
        );
      })}
      <p className="member__note">{P.notRatedNote}</p>
    </section>
  );
}

function Position({
  project,
  result,
  memberIndex,
  layer,
  onLayer,
}: {
  project: Project;
  result: AnalysisResult;
  memberIndex: number;
  layer: string;
  onLayer: (layer: string) => void;
}) {
  const headingId = useId();
  const selectId = useId();
  const bootstrap = useAppStore((s) => s.tools.bootstrap);
  const interval =
    bootstrap?.status === 'ready' &&
    bootstrap.ref === layer &&
    bootstrap.inputKey === result.inputKey
      ? bootstrap.result
      : null;
  const ref = result.refs[layer];
  const metrics = (result.view === 'directed' ? DIRECTED_METRICS : SYMMETRISED_METRICS).filter(
    (m) => ref?.node.columns[m] !== undefined,
  );
  const layers = drawableLayers(project, result);
  const label = (key: string) =>
    key === 'composite'
      ? mapCopy.panel.composite
      : (project.layers.find((l) => l.key === key)?.label ?? key);
  return (
    <section className="member__section" aria-labelledby={headingId}>
      <div className="member__heading-row">
        <h3 id={headingId} className="member__heading">
          {P.position}
        </h3>
        <label htmlFor={selectId} className="visually-hidden">
          {mapCopy.controls.layer}
        </label>
        <select
          id={selectId}
          className="select member__layer-select"
          value={layer}
          onChange={(e) => {
            onLayer(e.currentTarget.value);
          }}
        >
          {layers.map((key) => (
            <option key={key} value={key}>
              {label(key)}
            </option>
          ))}
        </select>
      </div>
      <table className="member__table member__metrics">
        <thead>
          <tr>
            <th scope="col">
              <span className="visually-hidden">{mapCopy.table.member}</span>
            </th>
            <th scope="col" className="numeric">
              {P.value}
            </th>
            <th scope="col" className="numeric">
              {P.rank}
            </th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((m) => {
            const column = ref?.node.columns[m];
            if (!column) return null;
            const value = column[memberIndex] as number;
            const flagKey = ref.node.flags[m]?.[memberIndex] ?? null;
            const flag = flagKey ? flagCopy[flagKey] : null;
            return (
              <tr key={m}>
                <th scope="row">
                  <span className="member__metric">
                    {metricCopy[m].label}
                    <MetricInfo metric={m} flag={flag} />
                  </span>
                </th>
                <td className="numeric">{formatValue(value)}</td>
                <td className="numeric">
                  {interval && interval.metric === m
                    ? rankInterval(interval.rankLow[memberIndex], interval.rankHigh[memberIndex])
                    : rankOf(column, memberIndex)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="member__note">
        {interval
          ? P.rankIntervalNote(metricCopy[interval.metric].label, interval.replicates)
          : P.rankNote(result.memberIds.length)}
      </p>
    </section>
  );
}

// Member panel (design-system §5.2): identity, attributes, position in the
// network with plain-English explanations, and ties by layer. Nothing here
// characterises the person (spec §2).
export function MemberPanel() {
  const data = useMapData();
  const memberId = useAppStore((s) => s.selection.member);
  const selectMember = useAppStore((s) => s.selectMember);
  const group = useAppStore((s) => s.selection.group);
  const toggleGroupMember = useAppStore((s) => s.toggleGroupMember);
  const setMap = useAppStore((s) => s.setMap);
  const setRightPanel = useAppStore((s) => s.setRightPanel);
  const setTools = useAppStore((s) => s.setTools);
  const [panelLayer, setPanelLayer] = useState<{ follow: string; layer: string } | null>(null);
  const names = useMemberNames();
  const headingId = useId();
  const member = useMemo(
    () => data?.project.members.find((m) => m.id === memberId) ?? null,
    [data, memberId],
  );

  if (!data || !member)
    return <p className="placeholder">{data ? P.empty : shellCopy.rightEmpty.member}</p>;
  const { project, result, settings } = data;
  const index = project.members.indexOf(member);
  // The panel follows the map's layer until the user picks another here.
  const layer =
    panelLayer && panelLayer.follow === settings.layer ? panelLayer.layer : settings.layer;

  const close = () => {
    selectMember(null);
    focusMapMember(member.id);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  return (
    // Escape anywhere in the panel closes it (keyboard operation, spec §12).
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <article className="member" aria-labelledby={headingId} onKeyDown={onKeyDown}>
      <div className="member__title-row">
        <h2 id={headingId} className="member__name">
          {names.of(member.id)}
        </h2>
        <button
          type="button"
          className="button button--text member__close"
          aria-label={P.close}
          onClick={close}
        >
          <Icon name="close" />
        </button>
      </div>
      <dl className="definition-list member__attributes">
        {project.attribute_definitions
          .filter((a) => a.type !== 'email')
          .map((a) => {
            const v = member.attributes[a.key] ?? null;
            return (
              <div key={a.key} className="definition-list__row">
                <dt>{a.label}</dt>
                <dd>
                  {v === null ? (
                    mapCopy.legend.notRecorded
                  ) : a.type === 'member_ref' && project.members.some((m) => m.id === v) ? (
                    <button
                      type="button"
                      className="link-button"
                      aria-label={P.selectManager(names.of(v))}
                      onClick={() => {
                        selectMember(v);
                      }}
                    >
                      {names.of(v)}
                    </button>
                  ) : (
                    v
                  )}
                </dd>
              </div>
            );
          })}
      </dl>
      <div className="member__actions">
        <button
          type="button"
          className="button button--text"
          onClick={() => {
            setMap({ ego: { member: member.id, depth: settings.ego?.depth ?? 1 } });
          }}
        >
          {P.showEgo}
        </button>
        <button
          type="button"
          className="button button--text"
          onClick={() => {
            toggleGroupMember(member.id);
          }}
        >
          {group.includes(member.id) ? P.leaveGroup : P.joinGroup}
        </button>
        <button
          type="button"
          className="button button--text"
          onClick={() => {
            const removal = useAppStore.getState().tools.removal;
            const ids = removal.includes(member.id) ? removal : [...removal, member.id];
            setTools({ removal: ids });
            simulateRemoval(ids);
            setRightPanel('explore');
          }}
        >
          {P.simulateRemoval}
        </button>
      </div>
      <Position
        project={project}
        result={result}
        memberIndex={index}
        layer={layer}
        onLayer={(l) => {
          setPanelLayer({ follow: settings.layer, layer: l });
        }}
      />
      <TiesByLayer project={project} memberId={member.id} active={layer} />
    </article>
  );
}
