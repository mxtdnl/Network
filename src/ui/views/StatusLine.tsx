import { Icon } from '../components/Icon';
import { coverageCopy, percent } from '../copy/data';
import { useAppStore } from '../state/store';
import { useCoverage } from './CoveragePanel';

// The line under the top bar: the persistent coverage warning (design-system
// §5.1: it cannot be dismissed while the condition holds) and the result of the
// last action, announced politely.
export function StatusLine() {
  const status = useAppStore((s) => s.data.status);
  const coverage = useCoverage();
  const warn = coverage?.belowThreshold === true;

  return (
    <div className="status-line">
      {warn && (
        <p className="status-line__warning" role="note">
          <Icon name="warning" />
          {coverageCopy.warning(percent(coverage.rate), percent(coverage.threshold))}
        </p>
      )}
      <p className="status-line__message" role="status">
        {status && (
          <>
            {status.tone === 'error' && <Icon name="warning" />}
            {status.text}
          </>
        )}
      </p>
    </div>
  );
}
