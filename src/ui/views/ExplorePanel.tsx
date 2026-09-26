import { useId, useMemo, useState } from 'react';
import type { Project } from '../../data/schema';
import { subgroupDensity, type ResilienceSnapshot } from '../engineClient';
import { Icon } from '../components/Icon';
import { percent } from '../copy/data';
import { exploreCopy } from '../copy/explore';
import { formatValue, formatWeight, mapCopy } from '../copy/map';
import { focusMapMember } from '../map/focus';
import { layerName } from '../map/legend';
import { useMapData, type MapData } from '../map/useMapModel';
import { useMemberNames, type MemberNames } from '../state/names';
import { useAppStore } from '../state/store';
import { clearPath, endSimulation, findPath, simulateRemoval } from '../state/tools';

const E = exploreCopy;

function sortedMembers(project: Project, names: MemberNames) {
  return project.members
    .map((m) => ({ id: m.id, name: names.of(m.id) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en-GB'));
}

function MemberSelect({
  project,
  label,
  value,
  onChange,
  exclude,
}: {
  project: Project;
  label: string;
  value: string;
  onChange: (id: string) => void;
  exclude?: ReadonlySet<string>;
}) {
  const id = useId();
  const names = useMemberNames();
  return (
    <div className="field">
      <label htmlFor={id} className="field__label">
        {label}
      </label>
      <select
        id={id}
        className="select"
        value={value}
        onChange={(e) => {
          onChange(e.currentTarget.value);
        }}
      >
        <option value="">{E.none}</option>
        {sortedMembers(project, names)
          .filter((m) => !exclude?.has(m.id))
          .map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
      </select>
    </div>
  );
}

// The explore tools (spec §8), in the right column: ego view, shortest path,
// subgroup density and the resilience simulation. Each works on the layer the
// map draws ties from, in the current view, and shares the selection with
// every other view.
export function ExplorePanel() {
  const data = useMapData();
  if (!data) return <p className="placeholder">{E.empty}</p>;
  const name =
    data.settings.layer === 'composite' ? mapCopy.controls.composite : layerName(data.model);
  return (
    <div className="explore">
      <p className="explore__layer">{E.onLayer(name)}</p>
      <EgoSection data={data} />
      <PathSection data={data} />
      <GroupSection data={data} />
      <ResilienceSection data={data} />
    </div>
  );
}

function Section({
  title,
  help,
  children,
}: {
  title: string;
  help: string;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <section className="explore__section" aria-labelledby={id}>
      <h3 id={id} className="member__heading">
        {title}
      </h3>
      <p className="field__help">{help}</p>
      {children}
    </section>
  );
}

function EgoSection({ data }: { data: MapData }) {
  const selected = useAppStore((s) => s.selection.member);
  const ego = data.settings.ego;
  const setMap = useAppStore((s) => s.setMap);
  const [member, setMember] = useState('');
  const [depth, setDepth] = useState<1 | 2>(1);
  const depthId = useId();
  const chosen = member || ego?.member || selected || '';
  const shown = data.model.nodes.filter((n) => n.visible).length;
  return (
    <Section title={E.ego.heading} help={E.ego.help}>
      <MemberSelect project={data.project} label={E.member} value={chosen} onChange={setMember} />
      <fieldset className="map-controls__group">
        <legend className="field__label">{E.ego.depth}</legend>
        <div className="segmented">
          {([1, 2] as const).map((d) => (
            <label key={d} className="segmented__option">
              <input
                type="radio"
                className="segmented__input"
                name={`${depthId}-depth`}
                checked={(ego && !member ? ego.depth : depth) === d}
                onChange={() => {
                  setDepth(d);
                  if (ego) setMap({ ego: { member: ego.member, depth: d } });
                }}
              />
              <span className="segmented__label">{d === 1 ? E.ego.one : E.ego.two}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="explore__actions">
        <button
          type="button"
          className="button button--secondary"
          disabled={!chosen}
          onClick={() => {
            setMap({ ego: { member: chosen, depth: ego && !member ? ego.depth : depth } });
            setMember('');
          }}
        >
          {E.ego.show}
        </button>
        {ego && (
          <button
            type="button"
            className="button button--text"
            onClick={() => {
              setMap({ ego: null });
            }}
          >
            {E.ego.clear}
          </button>
        )}
      </div>
      {data.model.ego && (
        <p className="explore__result" role="status">
          {E.ego.active(data.model.ego.name, shown - 1)}
        </p>
      )}
    </Section>
  );
}

function PathSection({ data }: { data: MapData }) {
  const path = useAppStore((s) => s.tools.path);
  const selectMember = useAppStore((s) => s.selectMember);
  const selected = useAppStore((s) => s.selection.member);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const names = useMemberNames();
  const a = from || path?.from || selected || '';
  const b = to || path?.to || '';
  const same = a !== '' && a === b;
  return (
    <Section title={E.path.heading} help={E.path.help}>
      <MemberSelect project={data.project} label={E.path.from} value={a} onChange={setFrom} />
      <MemberSelect project={data.project} label={E.path.to} value={b} onChange={setTo} />
      {same && <p className="field__error">{E.path.same}</p>}
      <div className="explore__actions">
        <button
          type="button"
          className="button button--secondary"
          disabled={!a || !b || same}
          onClick={() => {
            findPath(a, b);
            setFrom('');
            setTo('');
          }}
        >
          {E.path.find}
        </button>
        {path && (
          <button type="button" className="button button--text" onClick={clearPath}>
            {E.path.clear}
          </button>
        )}
      </div>
      <div role="status" className="explore__result">
        {path?.status === 'running' && <p>{E.path.finding}</p>}
        {path?.status === 'error' && <p>{E.path.failed(path.error)}</p>}
        {path?.status === 'ready' && !path.result && (
          <p>{E.path.none(names.of(path.from), names.of(path.to))}</p>
        )}
        {path?.status === 'ready' && path.result && (
          <>
            <dl className="definition-list explore__figures">
              <div className="definition-list__row">
                <dt>{E.path.distance}</dt>
                <dd className="num" data-testid="path-distance">
                  {formatValue(path.result.distance)}
                </dd>
              </div>
              <div className="definition-list__row">
                <dt>{E.path.steps}</dt>
                <dd className="num">{formatValue(path.result.hops)}</dd>
              </div>
              <div className="definition-list__row">
                <dt>{E.path.alternatives}</dt>
                <dd className="num">{formatValue(path.result.shortestPaths)}</dd>
              </div>
            </dl>
            <p className="field__label">{E.path.route}</p>
            <ol className="explore__route">
              {path.result.members.map((id) => (
                <li key={id}>
                  <button
                    type="button"
                    className="link-button"
                    aria-label={E.path.select(names.of(id))}
                    onClick={() => {
                      selectMember(id);
                      focusMapMember(id);
                    }}
                  >
                    {names.of(id)}
                  </button>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </Section>
  );
}

function GroupSection({ data }: { data: MapData }) {
  const group = useAppStore((s) => s.selection.group);
  const selected = useAppStore((s) => s.selection.member);
  const setGroup = useAppStore((s) => s.setGroup);
  const toggle = useAppStore((s) => s.toggleGroupMember);
  const { project, result, settings, model } = data;
  const names = useMemberNames();
  const density = useMemo(() => {
    const weights = result.refs[settings.layer]?.weights;
    if (!weights || group.length === 0) return null;
    const index = new Map(project.members.map((m, i) => [m.id, i]));
    const members = group.map((id) => index.get(id)).filter((i): i is number => i !== undefined);
    const among = model.nodes.filter((n) => n.visible).map((n) => n.index);
    return subgroupDensity(
      weights,
      project.members.length,
      result.view === 'directed',
      members,
      among,
    );
  }, [group, project, result, settings.layer, model]);

  return (
    <Section title={E.group.heading} help={E.group.help}>
      {group.length === 0 ? (
        <p className="explore__result">{E.group.empty}</p>
      ) : (
        <>
          <p className="field__label">{E.group.members(group.length)}</p>
          <ul className="chips">
            {group.map((id) => (
              <li key={id} className="chip">
                <span>{names.of(id)}</span>
                <button
                  type="button"
                  className="chip__remove"
                  aria-label={E.group.remove(names.of(id))}
                  onClick={() => {
                    toggle(id);
                  }}
                >
                  <Icon name="close" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="explore__actions">
        {selected && !group.includes(selected) && (
          <button
            type="button"
            className="button button--secondary"
            onClick={() => {
              toggle(selected);
            }}
          >
            {E.group.addSelected}
          </button>
        )}
        {group.length > 0 && (
          <button
            type="button"
            className="button button--text"
            onClick={() => {
              setGroup([]);
            }}
          >
            {E.group.clear}
          </button>
        )}
      </div>
      {density && (
        <div className="explore__result" data-testid="subgroup-density">
          {density.size < 2 ? (
            <p>{E.group.tooSmall}</p>
          ) : (
            <table className="member__table">
              <caption className="field__label explore__caption">{E.group.density}</caption>
              <tbody>
                <tr>
                  <th scope="row">{E.group.inside}</th>
                  <td className="numeric">{formatWeight(density.internal)}</td>
                  <td className="numeric explore__count">
                    {E.group.ties(density.internalTies, density.internalPossible)}
                  </td>
                </tr>
                <tr>
                  <th scope="row">{E.group.outside}</th>
                  <td className="numeric">
                    {Number.isFinite(density.external)
                      ? formatWeight(density.external)
                      : E.group.notDefined}
                  </td>
                  <td className="numeric explore__count">
                    {E.group.ties(density.externalTies, density.externalPossible)}
                  </td>
                </tr>
                <tr>
                  <th scope="row">{E.group.ei}</th>
                  <td className="numeric">
                    {Number.isFinite(density.ei) ? formatValue(density.ei) : E.group.notDefined}
                  </td>
                  <td />
                </tr>
              </tbody>
            </table>
          )}
          <p className="field__help">{E.group.eiHelp}</p>
          <button
            type="button"
            className="button button--text"
            onClick={() => {
              simulateRemoval(group);
            }}
          >
            {E.group.simulate}
          </button>
        </div>
      )}
    </Section>
  );
}

function snapshotRows(s: ResilienceSnapshot, directed: boolean) {
  return {
    components: directed ? (s.components.weak ?? NaN) : (s.components.connected ?? NaN),
    strong: s.components.strong ?? NaN,
    largest: s.components.largest,
    reachability: s.reachability,
    distance: s.averageDistance,
    steps: s.averageHops,
  };
}

const signed = (v: number, format: (x: number) => string) =>
  !Number.isFinite(v) ? '–' : v > 0 ? `+${format(v)}` : v < 0 ? `−${format(-v)}` : format(0);

function ResilienceSection({ data }: { data: MapData }) {
  const removal = useAppStore((s) => s.tools.removal);
  const simulation = useAppStore((s) => s.tools.resilience);
  const group = useAppStore((s) => s.selection.group);
  const setTools = useAppStore((s) => s.setTools);
  const [candidate, setCandidate] = useState('');
  const { project, result } = data;
  const names = useMemberNames();
  const chosen = new Set(removal);
  const setRemoval = (ids: string[]) => {
    setTools({ removal: [...new Set(ids)] });
  };
  const directed = result.view === 'directed';
  const r = simulation?.status === 'ready' ? simulation.result : null;

  return (
    <Section title={E.resilience.heading} help={E.resilience.help}>
      <div className="explore__inline">
        <MemberSelect
          project={project}
          label={E.resilience.toRemove}
          value={candidate}
          onChange={setCandidate}
          exclude={chosen}
        />
        <button
          type="button"
          className="button button--secondary"
          disabled={!candidate}
          onClick={() => {
            setRemoval([...removal, candidate]);
            setCandidate('');
          }}
        >
          {E.resilience.add}
        </button>
      </div>
      {group.length > 0 && group.some((id) => !chosen.has(id)) && (
        <button
          type="button"
          className="button button--text"
          onClick={() => {
            setRemoval([...removal, ...group]);
          }}
        >
          {E.resilience.addGroup}
        </button>
      )}
      {removal.length === 0 ? (
        <p className="explore__result">{E.resilience.none}</p>
      ) : (
        <ul className="chips">
          {removal.map((id) => (
            <li key={id} className="chip">
              <span>{names.of(id)}</span>
              <button
                type="button"
                className="chip__remove"
                aria-label={E.resilience.remove(names.of(id))}
                onClick={() => {
                  setRemoval(removal.filter((m) => m !== id));
                }}
              >
                <Icon name="close" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="explore__actions">
        <button
          type="button"
          className="button button--secondary"
          disabled={removal.length === 0}
          onClick={() => {
            simulateRemoval();
          }}
        >
          {E.resilience.run}
        </button>
        {simulation && (
          <button type="button" className="button button--text" onClick={endSimulation}>
            {E.resilience.end}
          </button>
        )}
      </div>
      <div role="status" className="explore__result">
        {simulation?.status === 'running' && <p>{E.resilience.running}</p>}
        {simulation?.status === 'error' && <p>{E.resilience.failed(simulation.error)}</p>}
      </div>
      {r && (
        <ResilienceTable
          before={snapshotRows(r.before, directed)}
          after={snapshotRows(r.after, directed)}
          directed={directed}
        />
      )}
      {r && <p className="field__help">{E.resilience.caveat}</p>}
    </Section>
  );
}

function ResilienceTable({
  before,
  after,
  directed,
}: {
  before: ReturnType<typeof snapshotRows>;
  after: ReturnType<typeof snapshotRows>;
  directed: boolean;
}) {
  const R = E.resilience;
  const rows: { key: keyof typeof before; label: string; format: (x: number) => string }[] = [
    { key: 'components', label: R.components, format: formatValue },
    ...(directed
      ? [{ key: 'strong' as const, label: R.componentsStrong, format: formatValue }]
      : []),
    { key: 'largest', label: R.largest, format: formatValue },
    { key: 'reachability', label: R.reachability, format: (x: number) => percent(x) },
    { key: 'distance', label: R.distance, format: formatValue },
    { key: 'steps', label: R.steps, format: formatValue },
  ];
  return (
    <table className="member__table explore__resilience" data-testid="resilience-table">
      <thead>
        <tr>
          <th scope="col">{R.measure}</th>
          <th scope="col" className="numeric">
            {R.before}
          </th>
          <th scope="col" className="numeric">
            {R.after}
          </th>
          <th scope="col" className="numeric">
            {R.change}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const b = before[row.key];
          const a = after[row.key];
          return (
            <tr key={row.key}>
              <th scope="row">{row.label}</th>
              <td className="numeric">{Number.isFinite(b) ? row.format(b) : '–'}</td>
              <td className="numeric">{Number.isFinite(a) ? row.format(a) : '–'}</td>
              <td className="numeric">{signed(a - b, row.format)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
