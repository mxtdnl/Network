import { useId } from 'react';
import { shellCopy } from '../copy/shell';
import { loadDemo } from '../state/projectActions';
import { useReadOnly } from '../state/layoutMode';
import { useAppStore } from '../state/store';

// Shown in the map view until a project has data (spec §12: empty states tell
// the user the next action).
export function EmptyState() {
  const headingId = useId();
  const setImportOpen = useAppStore((s) => s.setImportOpen);
  const setCentreView = useAppStore((s) => s.setCentreView);
  const copy = shellCopy.empty;
  // On a phone the project can be viewed, not built: only the demo and Project → Open remain.
  const readOnly = useReadOnly();
  return (
    <section className="empty-state" aria-labelledby={headingId}>
      <h2 id={headingId} className="empty-state__heading">
        {copy.heading}
      </h2>
      <p className="empty-state__body">{readOnly ? copy.phoneBody : copy.body}</p>
      <div className="empty-state__actions">
        {!readOnly && (
          <>
            <button
              type="button"
              className="button button--primary"
              onClick={() => {
                setCentreView('survey');
              }}
            >
              {copy.runSurvey}
            </button>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => {
                setImportOpen(true);
              }}
            >
              {copy.importData}
            </button>
          </>
        )}
        <button
          type="button"
          className={readOnly ? 'button button--primary' : 'button button--secondary'}
          onClick={() => {
            void loadDemo();
          }}
        >
          {copy.loadDemo}
        </button>
      </div>
      <p className="empty-state__note">{copy.privacy}</p>
    </section>
  );
}
