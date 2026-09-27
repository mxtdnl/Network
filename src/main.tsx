// Entry point. The respondent route (#/respond/…, spec §15.4) loads its own
// bundle without the analyst workspace: a participant's phone downloads only
// what the survey needs, and never reads the analyst's stored project. All of
// the chosen bundle is loaded before anything is shown, so a loaded survey
// needs no network (CLAUDE.md D90).

import './styles/fonts.css';

const RESPOND = '#/respond/';
const isRespond = () => window.location.hash.startsWith(RESPOND);

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root is missing from index.html.');

// Each route has its own function and import site. Written as one
// conditional, the build merged both imports into a single preload call with
// the workspace's stylesheet, so the survey loaded unstyled.
async function startRespond(el: HTMLElement) {
  const m = await import('./respond/start');
  m.start(el);
}
async function startWorkspace(el: HTMLElement) {
  const m = await import('./ui/start');
  m.start(el);
}

const respond = isRespond();
if (respond) void startRespond(root);
else void startWorkspace(root);

// Moving between the analyst workspace and a survey link in one tab reloads,
// so each starts clean.
window.addEventListener('hashchange', () => {
  if (isRespond() !== respond) window.location.reload();
});
