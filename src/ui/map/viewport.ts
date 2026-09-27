// Lets the map export read the view on screen (zoom and canvas size), so an
// exported map shows what the analyst sees. Only the workspace map registers;
// when it is not showing, the export fits the map to a default size.

import type { Transform } from './scene';

export interface Viewport {
  transform: Transform;
  width: number;
  height: number;
}

let provider: (() => Viewport) | null = null;

export function registerMapViewport(p: (() => Viewport) | null): void {
  provider = p;
}

/** The workspace map's view, or null when the map is not showing. */
export function currentMapViewport(): Viewport | null {
  const v = provider?.();
  return v && v.width > 0 && v.height > 0 ? v : null;
}
