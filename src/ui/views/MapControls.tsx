import { useId, useState } from 'react';
import { Icon } from '../components/Icon';
import { Switch } from '../components/Switch';
import { formatWeight, mapCopy } from '../copy/map';
import { DIRECTED_METRICS, SYMMETRISED_METRICS, metricCopy } from '../copy/metrics';
import { focusMapMember } from '../map/focus';
import {
  NOT_RECORDED,
  attributeValues,
  groupAttributes,
  toggleLayers,
  isToggledOn,
} from '../map/model';
import { drawableLayers, useMapData } from '../map/useMapModel';
import { useAppStore, type MapSettings, type SizeMetric } from '../state/store';

const C = mapCopy.controls;
const MAX_MATCHES = 8;

// Map controls (left column, design-system §5.1 "Show" group): the layer the
// map draws, layer toggles, direction and symmetrisation, the tie-strength
// threshold, node encodings, attribute filters and search.
export function MapControls() {
  const data = useMapData();
  const setMap = useAppStore((s) => s.setMap);
  const selectMember = useAppStore((s) => s.selectMember);
  const setRightPanel = useAppStore((s) => s.setRightPanel);
  const raw = useAppStore((s) => s.map);
  const ids = {
    layer: useId(),
    layerHelp: useId(),
    show: useId(),
    combine: useId(),
    threshold: useId(),
    size: useId(),
    fill: useId(),
    filter: useId(),
    filterAttr: useId(),
    filterValue: useId(),
    search: useId(),
    searchHelp: useId(),
  };
  const [filterAttr, setFilterAttr] = useState<string>('');
  const [filterValue, setFilterValue] = useState<string>('');

  if (!data) return <p className="placeholder">{mapCopy.calculating}</p>;
  const { project, result, settings, model } = data;
  const layers = drawableLayers(project, result);
  const layerLabel = (key: string) =>
    key === 'composite' ? C.composite : (project.layers.find((l) => l.key === key)?.label ?? key);
  const toggles = toggleLayers(project);
  const columns = result.refs[settings.layer]?.node.columns ?? {};
  const metrics = (settings.view === 'directed' ? DIRECTED_METRICS : SYMMETRISED_METRICS).filter(
    (m) => m in columns,
  );
  const attrs = groupAttributes(project);
  const attrLabel = (key: string) => attrs.find((a) => a.key === key)?.label ?? key;
  const valueLabel = (v: string) => (v === NOT_RECORDED ? C.notRecorded : v);
  const activeAttr = filterAttr || attrs[0]?.key || '';
  const valueOptions = activeAttr
    ? [
        ...attributeValues(project, activeAttr),
        ...(project.members.some((m) => (m.attributes[activeAttr] ?? null) === null)
          ? [NOT_RECORDED]
          : []),
      ]
    : [];
  const activeValue = valueOptions.includes(filterValue) ? filterValue : (valueOptions[0] ?? '');
  const chips = settings.filters.flatMap((f) => f.values.map((v) => ({ key: f.key, value: v })));

  const addFilter = () => {
    if (!activeAttr || !activeValue) return;
    const existing = raw.filters.find((f) => f.key === activeAttr);
    const filters: MapSettings['filters'] = existing
      ? raw.filters.map((f) =>
          f.key === activeAttr && !f.values.includes(activeValue)
            ? { ...f, values: [...f.values, activeValue] }
            : f,
        )
      : [...raw.filters, { key: activeAttr, values: [activeValue] }];
    setMap({ filters });
  };
  const removeFilter = (key: string, value: string) => {
    setMap({
      filters: raw.filters
        .map((f) => (f.key === key ? { ...f, values: f.values.filter((v) => v !== value) } : f))
        .filter((f) => f.values.length > 0),
    });
  };

  const matches = model.searchMatches ? [...model.searchMatches] : [];
  const fillValue = settings.fill.kind === 'community' ? '__community' : settings.fill.key;

  return (
    <div className="map-controls">
      <div className="field">
        <label htmlFor={ids.layer} className="field__label">
          {C.layer}
        </label>
        <select
          id={ids.layer}
          className="select"
          value={settings.layer}
          aria-describedby={ids.layerHelp}
          onChange={(e) => {
            setMap({ layer: e.currentTarget.value });
          }}
        >
          {layers.map((key) => (
            <option key={key} value={key}>
              {layerLabel(key)}
            </option>
          ))}
        </select>
        <p id={ids.layerHelp} className="field__help">
          {C.layerHelp}
        </p>
      </div>

      {toggles.length > 0 && (
        <fieldset className="map-controls__group">
          <legend className="field__label">{C.show}</legend>
          <ul className="layer-list">
            {toggles.map((layer) => (
              <li key={layer.key} className="layer-list__item">
                <Switch
                  label={layer.label}
                  hiddenSuffix={C.onMap}
                  checked={isToggledOn(settings, layer.key)}
                  onChange={(on) => {
                    setMap({ layerToggles: { ...raw.layerToggles, [layer.key]: on } });
                  }}
                />
              </li>
            ))}
          </ul>
          <p className="field__help">
            {toggles.some((l) => l.role) && `${C.styleHelp} `}
            {toggles.some((l) => l.signed) && C.colourHelp}
          </p>
        </fieldset>
      )}

      <fieldset className="map-controls__group">
        <legend className="field__label">{C.direction}</legend>
        <div className="segmented">
          {(['directed', 'symmetrised'] as const).map((view) => (
            <label key={view} className="segmented__option">
              <input
                type="radio"
                className="segmented__input"
                name={`${ids.show}-view`}
                checked={settings.view === view}
                onChange={() => {
                  setMap({ view });
                }}
              />
              <span className="segmented__label">
                {view === 'directed' ? C.directed : C.symmetrised}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {settings.view === 'symmetrised' && (
        <div className="field">
          <label htmlFor={ids.combine} className="field__label">
            {C.combine}
          </label>
          <select
            id={ids.combine}
            className="select"
            value={settings.symmetrise}
            onChange={(e) => {
              setMap({ symmetrise: e.currentTarget.value as MapSettings['symmetrise'] });
            }}
          >
            <option value="mean">{C.mean}</option>
            <option value="min">{C.min}</option>
            <option value="max">{C.max}</option>
          </select>
        </div>
      )}

      <div className="field">
        <div className="field__row">
          <label htmlFor={ids.threshold} className="field__label">
            {C.threshold}
          </label>
          <output htmlFor={ids.threshold} className="field__value">
            {formatWeight(settings.threshold)}
          </output>
        </div>
        <input
          id={ids.threshold}
          type="range"
          className="range"
          min={0}
          max={1}
          step={0.05}
          value={settings.threshold}
          aria-valuetext={formatWeight(settings.threshold)}
          onChange={(e) => {
            setMap({ threshold: Number(e.currentTarget.value) });
          }}
        />
      </div>

      <div className="field">
        <label htmlFor={ids.size} className="field__label">
          {C.size}
        </label>
        <select
          id={ids.size}
          className="select"
          value={settings.sizeMetric}
          onChange={(e) => {
            setMap({ sizeMetric: e.currentTarget.value as SizeMetric });
          }}
        >
          {metrics.map((m) => (
            <option key={m} value={m}>
              {metricCopy[m].label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor={ids.fill} className="field__label">
          {C.fill}
        </label>
        <select
          id={ids.fill}
          className="select"
          value={fillValue}
          onChange={(e) => {
            const v = e.currentTarget.value;
            setMap({
              fill: v === '__community' ? { kind: 'community' } : { kind: 'attribute', key: v },
            });
          }}
        >
          {attrs.map((a) => (
            <option key={a.key} value={a.key}>
              {a.label}
            </option>
          ))}
          <option value="__community">{C.community}</option>
        </select>
      </div>

      {attrs.length > 0 && (
        <fieldset className="map-controls__group">
          <legend className="field__label">{C.filter}</legend>
          {chips.length > 0 && (
            <ul className="chips">
              {chips.map((chip) => {
                const label = C.filterChip(attrLabel(chip.key), valueLabel(chip.value));
                return (
                  <li key={`${chip.key}\u0000${chip.value}`} className="chip">
                    <span>{label}</span>
                    <button
                      type="button"
                      className="chip__remove"
                      aria-label={C.removeFilter(label)}
                      onClick={() => {
                        removeFilter(chip.key, chip.value);
                      }}
                    >
                      <Icon name="close" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="filter-add">
            <label htmlFor={ids.filterAttr} className="visually-hidden">
              {C.filterAttribute}
            </label>
            <select
              id={ids.filterAttr}
              className="select"
              value={activeAttr}
              onChange={(e) => {
                setFilterAttr(e.currentTarget.value);
                setFilterValue('');
              }}
            >
              {attrs.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.label}
                </option>
              ))}
            </select>
            <label htmlFor={ids.filterValue} className="visually-hidden">
              {C.filterValue}
            </label>
            <select
              id={ids.filterValue}
              className="select"
              value={activeValue}
              onChange={(e) => {
                setFilterValue(e.currentTarget.value);
              }}
            >
              {valueOptions.map((v) => (
                <option key={v} value={v}>
                  {valueLabel(v)}
                </option>
              ))}
            </select>
            <button type="button" className="button button--secondary" onClick={addFilter}>
              {C.addFilter}
            </button>
          </div>
        </fieldset>
      )}

      <div className="field">
        <label htmlFor={ids.search} className="field__label">
          {C.search}
        </label>
        <input
          id={ids.search}
          type="search"
          className="text-input"
          value={settings.search}
          aria-describedby={ids.searchHelp}
          autoComplete="off"
          onChange={(e) => {
            setMap({ search: e.currentTarget.value });
          }}
        />
        <p id={ids.searchHelp} className="field__help" aria-live="polite">
          {model.searchMatches ? C.matches(matches.length) : C.searchHelp}
        </p>
        {matches.length > 0 && (
          <ul className="search-results">
            {matches.slice(0, MAX_MATCHES).map((i) => {
              const node = model.nodes[i];
              if (!node) return null;
              return (
                <li key={node.id}>
                  <button
                    type="button"
                    className="button button--text search-results__item"
                    onClick={() => {
                      selectMember(node.id);
                      setRightPanel('member');
                      focusMapMember(node.id);
                    }}
                  >
                    {node.name}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
