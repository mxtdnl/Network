import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/global.css';
import './styles/shell.css';
import './styles/data.css';
import { restoreLocalProject } from './ui/state/persistenceSync';
import { Workspace } from './ui/views/Workspace';

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root is missing from index.html.');

createRoot(root).render(
  <StrictMode>
    <Workspace />
  </StrictMode>,
);

void restoreLocalProject();
