import { useId } from 'react';
import { adjacencyCopy } from '../copy/adjacency';
import { mapCopy } from '../copy/map';
import { useMapData } from '../map/useMapModel';
import { useReadOnly } from '../state/layoutMode';
import { useAppStore, type MatrixMode } from '../state/store';
import { AdjacencyView } from './AdjacencyView';
import { EmptyState } from './EmptyState';
import { MatrixView } from './MatrixView';

const MODES: readonly MatrixMode[] = ['explore', 'enter'];

// The Matrix tab: the adjacency matrix of the analysis (spec §8), linked to
// the other views, or the rating grid for data entry (spec §5).
export function MatrixTab() {
  const project = useAppStore((s) => s.data.project);
  const readOnly = useReadOnly();
  // Rating entry changes the project, so the read-only phone layout shows the adjacency matrix only.
  const mode = useAppStore((s) => (readOnly ? 'explore' : s.ui.matrixMode));
  const setMode = useAppStore((s) => s.setMatrixMode);
  const data = useMapData();
  const name = useId();
  if (!project || project.members.length === 0) return <EmptyState />;
  return (
    <div className="matrix-tab">
      {!readOnly && (
        <fieldset className="view-toolbar view-toolbar--modes">
          <legend className="visually-hidden">{adjacencyCopy.modeLabel}</legend>
          <div className="segmented">
            {MODES.map((m) => (
              <label key={m} className="segmented__option">
                <input
                  type="radio"
                  className="segmented__input"
                  name={`${name}-mode`}
                  checked={mode === m}
                  onChange={() => {
                    setMode(m);
                  }}
                />
                <span className="segmented__label">{adjacencyCopy.modes[m]}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {mode === 'enter' ? (
        <MatrixView />
      ) : data ? (
        <AdjacencyView data={data} />
      ) : (
        <p className="placeholder">{mapCopy.calculating}</p>
      )}
    </div>
  );
}
