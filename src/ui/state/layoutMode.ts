import { createContext, useContext, useEffect, useState } from 'react';
import { durationToken } from '../durations';

// The analyst workspace by screen width (spec §12, CLAUDE.md D112): desktop
// from --workspace-desktop (three columns), tablet from --workspace-tablet
// (controls beside the view, the detail column below), and phone below that,
// where the workspace is read-only. CSS custom properties cannot be used
// inside @media, so the widths are read from the tokens (as respond/useWide.ts).

export type LayoutMode = 'desktop' | 'tablet' | 'phone';

function query(token: string): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  const width = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return width ? window.matchMedia(`(min-width: ${width})`) : null;
}

function current(desktop: MediaQueryList | null, tablet: MediaQueryList | null): LayoutMode {
  if (!desktop || !tablet) return 'desktop';
  return desktop.matches ? 'desktop' : tablet.matches ? 'tablet' : 'phone';
}

export function useLayoutMode(): LayoutMode {
  const [mode, setMode] = useState<LayoutMode>(() =>
    current(query('--workspace-desktop'), query('--workspace-tablet')),
  );
  useEffect(() => {
    const desktop = query('--workspace-desktop');
    const tablet = query('--workspace-tablet');
    // A new layout applies once the width has held for --workspace-settle, so a
    // passing size (a window being dragged, or a browser briefly reporting a
    // 1 px viewport while it saves a download) does not rebuild the workspace
    // and lose state such as a survey being set up.
    let timer = 0;
    const update = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        setMode(current(desktop, tablet));
      }, durationToken('--workspace-settle'));
    };
    update();
    desktop?.addEventListener('change', update);
    tablet?.addEventListener('change', update);
    return () => {
      clearTimeout(timer);
      desktop?.removeEventListener('change', update);
      tablet?.removeEventListener('change', update);
    };
  }, []);
  return mode;
}

/** True on the phone layout: the project can be viewed and explored, not changed. */
export const ReadOnlyContext = createContext(false);

export function useReadOnly(): boolean {
  return useContext(ReadOnlyContext);
}
