import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/tokens.css';
import '../styles/global.css';
import '../styles/respond.css';
import { RespondApp } from './RespondApp';

/** The respondent route (spec §15.4). */
export function start(root: HTMLElement): void {
  document.title = 'Graticule survey';
  createRoot(root).render(
    <StrictMode>
      <RespondApp />
    </StrictMode>,
  );
}
