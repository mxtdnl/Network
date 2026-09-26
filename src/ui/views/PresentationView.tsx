import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { Switch } from '../components/Switch';
import { percent } from '../copy/data';
import { mapCopy } from '../copy/map';
import { presentationCopy as P } from '../copy/savedViews';
import { shellCopy } from '../copy/shell';
import { durationToken } from '../durations';
import { readMapTheme, type MapTheme } from '../map/theme';
import { useMapData } from '../map/useMapModel';
import { setNamesHidden, useMemberNames } from '../state/names';
import { goTo, step, stopPresentation } from '../state/presentation';
import { useAppStore } from '../state/store';
import { MapLegend } from './MapLegend';
import { MapCanvas, legendExtras } from './MapView';

const NEXT = new Set(['ArrowRight', 'ArrowDown', 'PageDown', ' ']);
const PREVIOUS = new Set(['ArrowLeft', 'ArrowUp', 'PageUp']);

// Presentation mode (spec §8; docs/design-system.md §5.3): full screen, the
// saved view's name as the title, the map with its legend in a column beside
// it, the caption beneath and "3 of 7" at the bottom right. Controls are
// hidden; moving the pointer or tabbing shows a small bar (previous, next,
// hide names, leave) until the pointer rests for --presentation-idle, when the
// bar and the cursor hide again. Names, captions and legends pass through the
// names layer, so anonymisation applies here as everywhere.
export function PresentationView() {
  const project = useAppStore((s) => s.data.project);
  const index = useAppStore((s) => s.ui.presentation?.index ?? 0);
  const anonymise = useAppStore((s) => s.ui.anonymise);
  const running = useAppStore((s) => s.results.status === 'running');
  const data = useMapData();
  const names = useMemberNames();
  const rootRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<MapTheme | null>(null);
  const [active, setActive] = useState(false);
  const timer = useRef(0);
  const instructionsId = useId();
  const titleId = useId();

  const views = project?.saved_views ?? [];
  const view = views[index];

  // The canvas reads its label sizes from the presentation's tokens.
  useLayoutEffect(() => {
    if (rootRef.current) setTheme(readMapTheme(rootRef.current));
  }, []);

  useLayoutEffect(() => {
    rootRef.current?.focus();
  }, []);

  const wake = useCallback(() => {
    setActive(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setActive(false);
    }, durationToken('--presentation-idle'));
  }, []);
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
    },
    [],
  );

  // Keys work wherever focus is. Escape usually leaves full screen before the
  // page sees it, so leaving full screen also ends the presentation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      const onControl = target?.closest('button, input, textarea, select, dialog') !== null;
      if (e.key === 'Escape') {
        if (target?.closest('dialog')) return;
        e.preventDefault();
        stopPresentation();
      } else if (NEXT.has(e.key) && !(e.key === ' ' && onControl)) {
        e.preventDefault();
        step(1);
      } else if (PREVIOUS.has(e.key)) {
        e.preventDefault();
        step(-1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        goTo(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        goTo(Number.MAX_SAFE_INTEGER);
      }
    };
    let wasFullscreen = document.fullscreenElement !== null;
    const onFullscreen = () => {
      const now = document.fullscreenElement !== null;
      if (wasFullscreen && !now) stopPresentation();
      wasFullscreen = now;
    };
    // A click on the map steps forward, as the right arrow does.
    const onClick = (e: MouseEvent) => {
      if (mapRef.current?.contains(e.target as Node)) step(1);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointermove', wake);
    window.addEventListener('focusin', wake);
    window.addEventListener('click', onClick);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('focusin', wake);
      window.removeEventListener('click', onClick);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, [wake]);

  if (!project || !view) {
    return (
      <div ref={rootRef} className="presentation" tabIndex={-1}>
        <p className="presentation__caption">{P.noViews}</p>
      </div>
    );
  }

  const coverage = data?.result.coverage;
  return (
    // The region takes focus on entry so screen readers announce it; keys are
    // handled on the window (above).
    <div
      ref={rootRef}
      className={active ? 'presentation' : 'presentation presentation--idle'}
      role="region"
      aria-labelledby={titleId}
      aria-describedby={instructionsId}
      tabIndex={-1}
    >
      <p id={instructionsId} className="visually-hidden">
        {P.instructions}
      </p>
      <h1 id={titleId} className="presentation__title">
        {names.text(view.name)}
      </h1>
      <div className="presentation__body">
        <div ref={mapRef} className="presentation__map">
          {data && theme ? (
            <MapCanvas data={data} presentation={{ theme }} />
          ) : (
            <p className="map__message" role="status">
              {mapCopy.calculating}
            </p>
          )}
          {running && data && (
            <p className="presentation__status" role="status">
              {mapCopy.calculating}
            </p>
          )}
        </div>
        <aside className="presentation__legend" aria-label={mapCopy.legend.heading}>
          {data && theme && (
            <MapLegend model={data.mapModel} theme={theme} extras={legendExtras(data, 0, false)} />
          )}
          {coverage?.belowThreshold && (
            <p className="presentation__coverage" role="note">
              <Icon name="warning" />
              {mapCopy.coverage(percent(coverage.rate), percent(coverage.threshold))}
            </p>
          )}
        </aside>
      </div>
      <p className="presentation__caption">{names.text(view.caption)}</p>
      <p className="presentation__counter num" aria-live="polite">
        {P.counter(index + 1, views.length)}
      </p>
      <div className="presentation__controls" role="group" aria-label={P.controls}>
        <button
          type="button"
          className="button button--text"
          disabled={index === 0}
          onClick={() => {
            step(-1);
          }}
        >
          {P.previous}
        </button>
        <button
          type="button"
          className="button button--text"
          disabled={index === views.length - 1}
          onClick={() => {
            step(1);
          }}
        >
          {P.next}
        </button>
        <Switch label={shellCopy.hideNames} checked={anonymise} onChange={setNamesHidden} />
        <button type="button" className="button button--text" onClick={stopPresentation}>
          {P.exit}
        </button>
      </div>
    </div>
  );
}
