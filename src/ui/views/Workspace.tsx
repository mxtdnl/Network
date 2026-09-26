import { EthicsNotice } from '../components/EthicsNotice';
import { Tabs, type TabItem } from '../components/Tabs';
import { coverageCopy } from '../copy/data';
import { shellCopy } from '../copy/shell';
import { useAppStore, type CentreView, type RightPanel } from '../state/store';
import { CoveragePanel } from './CoveragePanel';
import { ImportDialog } from './ImportDialog';
import { LayerPanel } from './LayerPanel';
import { MapControls } from './MapControls';
import { MapView } from './MapView';
import { MatrixView } from './MatrixView';
import { MemberPanel } from './MemberPanel';
import { StatusLine } from './StatusLine';
import { TopBar } from './TopBar';

function Placeholder({ text }: { text: string }) {
  return <p className="placeholder">{text}</p>;
}

const centreItems: readonly TabItem<CentreView>[] = [
  { key: 'map', label: shellCopy.centreTabs.map, panel: <MapView /> },
  { key: 'matrix', label: shellCopy.centreTabs.matrix, panel: <MatrixView /> },
  {
    key: 'table',
    label: shellCopy.centreTabs.table,
    panel: <Placeholder text={shellCopy.centreEmpty.table} />,
  },
  {
    key: 'compare',
    label: shellCopy.centreTabs.compare,
    panel: <Placeholder text={shellCopy.centreEmpty.compare} />,
  },
];

const rightItems: readonly TabItem<RightPanel>[] = [
  { key: 'member', label: shellCopy.rightTabs.member, panel: <MemberPanel /> },
  {
    key: 'insights',
    label: shellCopy.rightTabs.insights,
    panel: <Placeholder text={shellCopy.rightEmpty.insights} />,
  },
  { key: 'coverage', label: coverageCopy.tab, panel: <CoveragePanel /> },
];

// Analyst workspace, docs/design-system.md §5.1: fixed left column, fluid
// centre, fixed right column, under a top bar and its status line.
export function Workspace() {
  const ui = useAppStore((s) => s.ui);
  const setCentreView = useAppStore((s) => s.setCentreView);
  const setRightPanel = useAppStore((s) => s.setRightPanel);
  const closeNotice = useAppStore((s) => s.closeNotice);
  const hasProject = useAppStore((s) => (s.data.project?.members.length ?? 0) > 0);
  const showMapControls = hasProject && ui.centreView === 'map';

  return (
    <div className="workspace">
      <TopBar />
      <StatusLine />
      <aside className="workspace__left" aria-label={shellCopy.regions.left}>
        {showMapControls && (
          <section className="workspace__section" aria-labelledby="map-controls-heading">
            <h2 id="map-controls-heading" className="panel-heading">
              {shellCopy.left.map}
            </h2>
            <MapControls />
          </section>
        )}
        <section aria-labelledby="layers-heading">
          <h2 id="layers-heading" className="panel-heading">
            {shellCopy.left.heading}
          </h2>
          <LayerPanel />
        </section>
      </aside>
      <main className="workspace__centre" aria-label={shellCopy.regions.centre}>
        <Tabs
          label={shellCopy.regions.centre}
          items={centreItems}
          selected={ui.centreView}
          onSelect={setCentreView}
        />
      </main>
      <aside className="workspace__right" aria-label={shellCopy.regions.right}>
        <Tabs
          label={shellCopy.regions.right}
          items={rightItems}
          selected={ui.rightPanel}
          onSelect={setRightPanel}
        />
      </aside>
      <ImportDialog />
      <EthicsNotice open={ui.noticeOpen} onClose={closeNotice} />
    </div>
  );
}
