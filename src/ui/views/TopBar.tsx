import { useRef, useState } from 'react';
import { ConfirmDialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { MenuButton } from '../components/MenuButton';
import { Switch } from '../components/Switch';
import { coverageCopy, percent, persistenceCopy, projectCopy } from '../copy/data';
import { shellCopy } from '../copy/shell';
import { clearAllLocalData, setPersistenceOn } from '../state/persistenceSync';
import { loadDemo, openProjectFile, saveProjectFile } from '../state/projectActions';
import { useAppStore } from '../state/store';
import { useCoverage } from './CoveragePanel';

type Pending = 'open' | 'demo' | null;

export function TopBar() {
  const anonymise = useAppStore((s) => s.ui.anonymise);
  const setAnonymise = useAppStore((s) => s.setAnonymise);
  const openNotice = useAppStore((s) => s.openNotice);
  const setImportOpen = useAppStore((s) => s.setImportOpen);
  const project = useAppStore((s) => s.data.project);
  const persistence = useAppStore((s) => s.data.persistence);
  const coverage = useCoverage();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const hasData = project !== null && project.members.length > 0;
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
        <Switch label={shellCopy.hideNames} checked={anonymise} onChange={setAnonymise} />
        <button type="button" className="button button--text" disabled>
          {shellCopy.present}
        </button>
        <MenuButton
          label={projectCopy.menu}
          items={[
            { key: 'open', label: projectCopy.open, onSelect: onOpen },
            { key: 'save', label: projectCopy.save, onSelect: saveProjectFile, disabled: !project },
            {
              key: 'import',
              label: projectCopy.importData,
              onSelect: () => {
                setImportOpen(true);
              },
            },
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
        <MenuButton
          label={shellCopy.help}
          items={[{ key: 'notice', label: shellCopy.helpMenu.notice, onSelect: openNotice }]}
        />
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
        confirm={projectCopy.replaceConfirm}
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
