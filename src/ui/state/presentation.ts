// Presentation mode (spec §8): full screen, controls hidden, stepping through
// the saved views in their saved order. Entering remembers the analyst's own
// state as an unsaved view and leaving restores it, so presenting does not
// disturb the workspace.

import type { SavedView } from '../../data/schema';
import { captureView, restoreView } from './savedViews';
import { useAppStore } from './store';

let before: SavedView | null = null;

function views(): SavedView[] {
  return useAppStore.getState().data.project?.saved_views ?? [];
}

/** Shows the view at `index` (clamped); false when there is none. */
export function showStep(index: number): boolean {
  const list = views();
  if (list.length === 0) return false;
  const i = Math.max(0, Math.min(list.length - 1, index));
  const view = list[i];
  if (!view) return false;
  restoreView(view);
  useAppStore.getState().setPresentation({ index: i });
  return true;
}

export function startPresentation(index = 0): void {
  const s = useAppStore.getState();
  if (s.ui.presentation || views().length === 0) return;
  before = captureView('');
  showStep(index);
  // Full screen needs a user gesture, which the Present button provides. If
  // the browser refuses, presentation mode still fills the window.
  const root = document.documentElement;
  if (!document.fullscreenElement && typeof root.requestFullscreen === 'function') {
    root.requestFullscreen().catch(() => undefined);
  }
}

export function step(delta: number): void {
  const current = useAppStore.getState().ui.presentation;
  if (!current) return;
  const target = current.index + delta;
  if (target < 0 || target >= views().length) return;
  showStep(target);
}

export function goTo(index: number): void {
  if (useAppStore.getState().ui.presentation) showStep(index);
}

export function stopPresentation(): void {
  const s = useAppStore.getState();
  if (!s.ui.presentation) return;
  s.setPresentation(null);
  if (before) restoreView(before);
  before = null;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
}
