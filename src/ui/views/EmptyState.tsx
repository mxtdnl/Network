import { useId } from 'react';
import { shellCopy } from '../copy/shell';

// Shown in the map view until a project has data (spec §12: empty states tell
// the user the next action).
export function EmptyState() {
  const unavailableId = useId();
  const copy = shellCopy.empty;
  return (
    <section className="empty-state" aria-labelledby={`${unavailableId}-heading`}>
      <h2 id={`${unavailableId}-heading`} className="empty-state__heading">
        {copy.heading}
      </h2>
      <p className="empty-state__body">{copy.body}</p>
      <div className="empty-state__actions">
        <button
          type="button"
          className="button button--primary"
          disabled
          aria-describedby={unavailableId}
        >
          {copy.importData}
        </button>
        <button
          type="button"
          className="button button--secondary"
          disabled
          aria-describedby={unavailableId}
        >
          {copy.loadDemo}
        </button>
      </div>
      <p id={unavailableId} className="empty-state__note">
        {copy.unavailable}
      </p>
      <p className="empty-state__note">{copy.privacy}</p>
    </section>
  );
}
