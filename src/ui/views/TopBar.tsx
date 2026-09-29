import { lazy, Suspense, useRef, useState } from 'react';
import { ConfirmDialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { MenuButton } from '../components/MenuButton';
import { Switch } from '../components/Switch';
import { coverageCopy, percent, persistenceCopy, projectCopy } from '../copy/data';
import { shellCopy } from '../copy/shell';
import { clearAllLocalData, setPersistenceOn } from '../state/persistenceSync';
import { loadDemo, openProjectFile, saveProjectFile } from '../state/projectActions';
import { useReadOnly } from '../state/layoutMode';
import { useAppStore } from '../state/store';
import { useCoverage } from './CoveragePanel';
import { savedViewsCopy } from '../copy/savedViews';
import { setNamesHidden } from '../state/names';
import { startPresentation } from '../state/presentation';
import { exportCopy } from '../copy/export';
import { ExportDialog } from './ExportDialog';
import { helpCopy, type HelpDoc } from '../copy/help';

// The help documents are loaded with the dialog, on first use.
const HelpDialog = lazy(() => import('./HelpDialog').then((m) => ({ default: m.HelpDialog })));

type Pending = 'open' | 'demo' | null;

export function TopBar() {
  const anonymise = useAppStore((s) => s.ui.anonymise);
  const views = useAppStore((s) => s.data.project?.saved_views.length ?? 0);
  const openNotice = useAppStore((s) => s.openNotice);
  const setImportOpen = useAppStore((s) => s.setImportOpen);
  const project = useAppStore((s) => s.data.project);
  const persistence = useAppStore((s) => s.data.persistence);
  const coverage = useCoverage();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [help, setHelp] = useState<HelpDoc | null>(null);
  const [helpDoc, setHelpDoc] = useState<HelpDoc>('guide');
  // The help opens from a menu item that is gone once the menu closes, so
  // closing the help returns focus to the Help button itself.
  const helpMenuRef = useRef<HTMLDivElement>(null);
  const openHelp = (doc: HelpDoc) => {
    setHelpDoc(doc);
    setHelp(doc);
  };

  const hasData = project !== null && project.members.length > 0;
  // Importing changes the project, so the read-only phone layout leaves it out.
  const phone = useReadOnly();
  function chooseProjectFile() {
    fileRef.current?.click();
  }
  function onOpen() {
    if (hasData) setPending('open');
    else chooseProjectFile();
  }
  function onDemo() {
    if (hasData) setPending('demo');
    else void loadDemo();
  }

  const indicator =
    persistence === 'off'
      ? null
      : persistence === 'saving'
        ? persistenceCopy.indicatorSaving
        : persistence === 'error'
          ? persistenceCopy.indicatorError
          : persistenceCopy.indicator;

  return (
    <header className="top-bar">
      <h1 className="top-bar__name">{shellCopy.appName}</h1>
      <p className="top-bar__project">{project ? project.meta.title : shellCopy.noProject}</p>
      {indicator && (
        <p className="top-bar__indicator">
          <Icon name={persistence === 'error' ? 'warning' : 'check'} />
          {indicator}
        </p>
      )}
      <div className="top-bar__actions">
        {coverage && Number.isFinite(coverage.rate) && (
          <p className="top-bar__coverage num">
            {coverage.belowThreshold && <Icon name="warning" />}
            {coverageCopy.topBar(percent(coverage.rate))}
          </p>
        )}
        <Switch label={shellCopy.hideNames} checked={anonymise} onChange={setNamesHidden} />
        <button
          type="button"
          className="button button--text"
          disabled={views === 0}
          title={views === 0 ? savedViewsCopy.presentHelp : undefined}
          onClick={() => {
            startPresentation(0);
          }}
        >
          {shellCopy.present}
        </button>
        <button
          type="button"
          className="button button--text"
          disabled={!hasData}
          onClick={() => {
            setExporting(true);
          }}
        >
          {exportCopy.menu}
        </button>
        <MenuButton
          label={projectCopy.menu}
          items={[
            { key: 'open', label: projectCopy.open, onSelect: onOpen },
            { key: 'save', label: projectCopy.save, onSelect: saveProjectFile, disabled: !project },
            ...(phone
              ? []
              : [
                  {
                    key: 'import',
                    label: projectCopy.importData,
                    onSelect: () => {
                      setImportOpen(true);
                    },
                  },
                ]),
            { key: 'demo', label: projectCopy.loadDemo, onSelect: onDemo },
            {
              key: 'keep',
              label: projectCopy.keepLocal,
              checked: persistence !== 'off',
              onSelect: () => {
                void setPersistenceOn(persistence === 'off');
              },
            },
            {
              key: 'clear',
              label: projectCopy.clearLocal,
              onSelect: () => {
                setConfirmClear(true);
              },
            },
          ]}
        />
        <div ref={helpMenuRef} className="top-bar__help">
          <MenuButton
            label={shellCopy.help}
            items={[
              ...(['guide', 'method', 'respondent', 'licence'] as const).map((doc) => ({
                key: doc,
                label: helpCopy.menu[doc],
                onSelect: () => {
                  openHelp(doc);
                },
              })),
              { key: 'notice', label: shellCopy.helpMenu.notice, onSelect: openNotice },
            ]}
          />
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (file) void openProjectFile(file);
        }}
      />
      <ConfirmDialog
        open={pending !== null}
        title={projectCopy.replaceTitle}
        body={projectCopy.replaceBody}
        confirm={projectCopy.replaceConfirm[pending ?? 'open']}
        cancel={projectCopy.cancel}
        onCancel={() => {
          setPending(null);
        }}
        onConfirm={() => {
          const action = pending;
          setPending(null);
          if (action === 'open') chooseProjectFile();
          else if (action === 'demo') void loadDemo();
        }}
      />
      {help !== null && (
        <Suspense fallback={null}>
          <HelpDialog
            open
            doc={helpDoc}
            onDoc={setHelpDoc}
            onClose={() => {
              setHelp(null);
              // After the dialog has gone: until then the rest of the page is inert.
              requestAnimationFrame(() => {
                helpMenuRef.current?.querySelector('button')?.focus();
              });
            }}
          />
        </Suspense>
      )}
      <ExportDialog
        open={exporting}
        onClose={() => {
          setExporting(false);
        }}
      />
      <ConfirmDialog
        open={confirmClear}
        title={persistenceCopy.clearTitle}
        body={persistenceCopy.clearBody}
        confirm={persistenceCopy.clearConfirm}
        cancel={projectCopy.cancel}
        onCancel={() => {
          setConfirmClear(false);
        }}
        onConfirm={() => {
          setConfirmClear(false);
          void clearAllLocalData();
        }}
      />
    </header>
  );
}
