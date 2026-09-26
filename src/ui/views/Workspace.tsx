import { EthicsNotice } from '../components/EthicsNotice';
import { Tabs, type TabItem } from '../components/Tabs';
import { coverageCopy } from '../copy/data';
import { shellCopy } from '../copy/shell';
import { useAppStore, type CentreView, type RightPanel } from '../state/store';
import { CoveragePanel } from './CoveragePanel';
import { ImportDialog } from './ImportDialog';
import { LayerPanel } from './LayerPanel';
import { MapControls } from './MapControls';
import { CompareView } from './CompareView';
import { ExplorePanel } from './ExplorePanel';
import { MapView } from './MapView';
import { MatrixTab } from './MatrixTab';
import { MemberPanel } from './MemberPanel';
import { StatusLine } from './StatusLine';
import { TableView } from './TableView';
import { TopBar } from './TopBar';
import { WeightPanel } from './WeightPanel';
import { exploreCopy } from '../copy/explore';
import { savedViewsCopy } from '../copy/savedViews';
import { InsightsPanel } from './InsightsPanel';
import { PresentationView } from './PresentationView';
import { SavedViewsPanel } from './SavedViewsPanel';
import { weightsCopy } from '../copy/weights';

const centreItems: readonly TabItem<CentreView>[] = [
  { key: 'map', label: shellCopy.centreTabs.map, panel: <MapView /> },
  { key: 'matrix', label: shellCopy.centreTabs.matrix, panel: <MatrixTab /> },
  { key: 'table', label: shellCopy.centreTabs.table, panel: <TableView /> },
  { key: 'compare', label: shellCopy.centreTabs.compare, panel: <CompareView /> },
];

const rightItems: readonly TabItem<RightPanel>[] = [
  { key: 'member', label: shellCopy.rightTabs.member, panel: <MemberPanel /> },
  { key: 'explore', label: exploreCopy.tab, panel: <ExplorePanel /> },
  { key: 'insights', label: shellCopy.rightTabs.insights, panel: <InsightsPanel /> },
  { key: 'views', label: savedViewsCopy.tab, panel: <SavedViewsPanel /> },
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

  if (ui.presentation) {
    return (
      <>
        <PresentationView />
        <EthicsNotice open={ui.noticeOpen} onClose={closeNotice} />
      </>
    );
  }

  return (
    <div className="workspace">
      <TopBar />
      <StatusLine />
      <aside className="workspace__left" aria-label={shellCopy.regions.left}>
        {hasProject && (
          <section className="workspace__section" aria-labelledby="weights-heading">
            <h2 id="weights-heading" className="panel-heading">
              {weightsCopy.heading}
            </h2>
            <WeightPanel />
          </section>
        )}
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
