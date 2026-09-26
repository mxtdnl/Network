// Applying an insight's view configuration (spec §9: each observation "links
// to the view that shows it"). The engine names the ties to draw, the node
// size, the layout, filters and the members to highlight; this turns them
// into map settings. Weights and the analysis view stay as they are, because
// the observation was computed with them.

import type { InsightView, Observation } from '../engineClient';
import { insightsCopy, questionText, type InsightContext } from '../copy/insights';
import { saveCurrentView, setViewCaption } from './savedViews';
import { metricForView, useAppStore, type MapSettings, type SizeMetric } from './store';

export function insightMapPatch(view: InsightView, map: MapSettings): Partial<MapSettings> {
  const toggles = { ...map.layerToggles };
  for (const key of view.show) toggles[key] = true;
  return {
    layer: view.layer,
    sizeMetric: metricForView(view.sizeMetric as SizeMetric, map.view),
    layout: view.layout,
    groupBy: view.groupBy ?? map.groupBy,
    filters: view.filters.map((f) => ({ key: f.key, values: [...f.values] })),
    highlight: [...view.highlight],
    layerToggles: toggles,
    ego: null,
    search: '',
  };
}

export function showInsight(o: Observation): void {
  const s = useAppStore.getState();
  s.setMap(insightMapPatch(o.view, s.map));
  s.setTools({ path: null });
  s.setCentreView('map');
  s.setStatus({ text: insightsCopy.shown(insightsCopy.titles[o.rule]), tone: 'info' });
}

/** Shows the insight, then saves the map as a view captioned with the insight's question. */
export function saveInsightAsView(o: Observation, ctx: InsightContext): void {
  showInsight(o);
  // Positions are captured once the map has drawn the new configuration.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const view = saveCurrentView(insightsCopy.titles[o.rule]);
      if (view) setViewCaption(view.id, questionText(o, ctx));
    });
  });
}
