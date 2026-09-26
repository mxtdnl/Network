import { EthicsNotice } from '../components/EthicsNotice';
import { Tabs, type TabItem } from '../components/Tabs';
import { shellCopy } from '../copy/shell';
import { useAppStore, type CentreView, type RightPanel } from '../state/store';
import { EmptyState } from './EmptyState';
import { TopBar } from './TopBar';

function Placeholder({ text }: { text: string }) {
  return <p className="placeholder">{text}</p>;
}

const centreItems: readonly TabItem<CentreView>[] = [
  { key: 'map', label: shellCopy.centreTabs.map, panel: <EmptyState /> },
  {
    key: 'matrix',
    label: shellCopy.centreTabs.matrix,
    panel: <Placeholder text={shellCopy.centreEmpty.matrix} />,
  },
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
  {
    key: 'member',
    label: shellCopy.rightTabs.member,
    panel: <Placeholder text={shellCopy.rightEmpty.member} />,
  },
  {
    key: 'insights',
    label: shellCopy.rightTabs.insights,
    panel: <Placeholder text={shellCopy.rightEmpty.insights} />,
  },
];

// Analyst workspace, docs/design-system.md §5.1: fixed left column, fluid
// centre, fixed right column, under a top bar.
export function Workspace() {
  const ui = useAppStore((s) => s.ui);
  const setCentreView = useAppStore((s) => s.setCentreView);
  const setRightPanel = useAppStore((s) => s.setRightPanel);
  const closeNotice = useAppStore((s) => s.closeNotice);

  return (
    <div className="workspace">
      <TopBar />
      <aside className="workspace__left" aria-label={shellCopy.regions.left}>
        <h2 className="panel-heading">{shellCopy.left.heading}</h2>
        <p className="placeholder">{shellCopy.left.empty}</p>
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
      <EthicsNotice open={ui.noticeOpen} onClose={closeNotice} />
    </div>
  );
}
