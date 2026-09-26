import { useId } from 'react';
import { projectCopy } from '../copy/data';
import { useAppStore } from '../state/store';
import { EmptyState } from './EmptyState';

// Map tab until the map arrives (Phase 4): what the project holds and where to
// go next.
export function ProjectSummary() {
  const project = useAppStore((s) => s.data.project);
  const setCentreView = useAppStore((s) => s.setCentreView);
  const headingId = useId();
  if (!project || project.members.length === 0) return <EmptyState />;

  const enabled = new Set(project.layers.filter((l) => l.enabled).map((l) => l.key));
  const ratings = project.ties.filter((t) => enabled.has(t.variable) && t.value !== null).length;
  return (
    <section className="empty-state" aria-labelledby={headingId}>
      <h2 id={headingId} className="empty-state__heading">
        {project.meta.title}
      </h2>
      <p className="empty-state__body num">
        {projectCopy.summary(project.members.length, ratings, enabled.size)}
      </p>
      <p className="empty-state__note">{projectCopy.mapLater}</p>
      <div className="empty-state__actions">
        <button
          type="button"
          className="button button--primary"
          onClick={() => {
            setCentreView('matrix');
          }}
        >
          {projectCopy.openMatrix}
        </button>
      </div>
    </section>
  );
}
