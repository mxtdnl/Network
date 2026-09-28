import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/tokens.css';
import '../styles/global.css';
import '../styles/shell.css';
import '../styles/data.css';
import '../styles/map.css';
import '../styles/explore.css';
import '../styles/present.css';
import '../styles/survey.css';
import '../styles/export.css';
import '../styles/help.css';
import '../styles/layout.css';
import { startAnalysisSync } from './state/analysisSync';
import { restoreLocalProject } from './state/persistenceSync';
import { Workspace } from './views/Workspace';

/** The analyst workspace. */
export function start(root: HTMLElement): void {
  createRoot(root).render(
    <StrictMode>
      <Workspace />
    </StrictMode>,
  );
  startAnalysisSync();
  void restoreLocalProject();
}
