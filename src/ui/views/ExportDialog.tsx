import { useId, useState } from 'react';
import { Dialog } from '../components/Dialog';
import { Switch } from '../components/Switch';
import { exportCopy as E } from '../copy/export';
import { exclusionApplies } from '../export/scope';
import {
  exportMapFile,
  exportReportFile,
  exportTableFile,
  setExcludeSigned,
  type MapFormat,
  type Resolution,
  type TableKind,
} from '../state/exportActions';
import { setNamesHidden } from '../state/names';
import { useAppStore } from '../state/store';

// The export dialog (spec §11): the two settings every export follows at the
// top (hide names, leave out signed and conflict layers), then the map, the
// tables and the report. One export runs at a time; its result is announced
// in the status line with the button's verb ("Export map" → "Map exported").
export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const project = useAppStore((s) => s.data.project);
  const ready = useAppStore(
    (s) =>
      s.results.current !== null &&
      s.data.project !== null &&
      s.results.current.memberIds.length === s.data.project.members.length,
  );
  const anonymise = useAppStore((s) => s.ui.anonymise);
  const hasFormalInformal = useAppStore(
    (s) => s.results.current?.multiplex?.formalInformal != null,
  );
  const [format, setFormat] = useState<MapFormat>('png');
  const [resolution, setResolution] = useState<Resolution>('x2');
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const id = useId();

  const excludeSigned = project?.settings.exclude_signed_from_exports ?? false;
  const anyExcludable = project ? exclusionApplies(project, true) : false;

  const run = async (key: string, action: () => Promise<string | null>) => {
    setBusy(key);
    setMessage(excludeSigned && anyExcludable ? E.reanalysing : E.busy);
    const file = await action();
    setBusy(null);
    setMessage(file ? '' : (useAppStore.getState().data.status?.text ?? ''));
  };

  const tableButton = (kind: TableKind, label: string, help: string, disabled = false) => (
    <div className="export__item">
      <button
        type="button"
        className="button button--secondary"
        disabled={!ready || busy !== null || disabled}
        aria-describedby={`${id}-${kind}-help`}
        onClick={() => {
          void run(kind, () => exportTableFile(kind));
        }}
      >
        {label}
      </button>
      <p id={`${id}-${kind}-help`} className="field__help">
        {help}
      </p>
    </div>
  );

  return (
    <Dialog
      open={open}
      title={E.dialogTitle}
      onClose={onClose}
      wide
      describedBy={`${id}-intro`}
      actions={
        <button type="button" className="button button--text" onClick={onClose}>
          {E.close}
        </button>
      }
    >
      <p id={`${id}-intro`} className="export__intro">
        {ready ? E.intro : E.noAnalysis}
      </p>

      <section className="export__section" aria-labelledby={`${id}-settings`}>
        <h3 id={`${id}-settings`} className="export__heading">
          {E.settings.heading}
        </h3>
        <div className="export__setting">
          <Switch label={E.settings.hideNames} checked={anonymise} onChange={setNamesHidden} />
          <p className="field__help">{E.settings.hideNamesHelp}</p>
        </div>
        <div className="export__setting">
          <Switch
            label={E.settings.excludeSigned}
            checked={excludeSigned}
            onChange={setExcludeSigned}
          />
          <p className="field__help">
            {anyExcludable ? E.settings.excludeSignedHelp : E.settings.excludeSignedNone}
          </p>
        </div>
      </section>

      <section className="export__section" aria-labelledby={`${id}-map`}>
        <h3 id={`${id}-map`} className="export__heading">
          {E.map.heading}
        </h3>
        <p className="field__help">{E.map.help}</p>
        <div className="export__choices">
          <fieldset className="export__fieldset">
            <legend className="field__label">{E.map.format}</legend>
            <div className="radio-list">
              {(['png', 'svg'] as const).map((f) => (
                <label key={f} className="radio-list__option">
                  <input
                    type="radio"
                    name={`${id}-format`}
                    checked={format === f}
                    onChange={() => {
                      setFormat(f);
                    }}
                  />
                  <span>{f === 'png' ? E.map.png : E.map.svg}</span>
                </label>
              ))}
            </div>
            {format === 'svg' && <p className="field__help">{E.map.svgHelp}</p>}
          </fieldset>
          <fieldset className="export__fieldset" disabled={format !== 'png'}>
            <legend className="field__label">{E.map.resolution}</legend>
            <div className="radio-list">
              {(['x1', 'x2', 'print'] as const).map((r) => (
                <label key={r} className="radio-list__option">
                  <input
                    type="radio"
                    name={`${id}-resolution`}
                    checked={resolution === r}
                    onChange={() => {
                      setResolution(r);
                    }}
                  />
                  <span>{E.map[r]}</span>
                </label>
              ))}
            </div>
            {resolution === 'print' && format === 'png' && (
              <p className="field__help">{E.map.printHelp}</p>
            )}
          </fieldset>
        </div>
        <div className="field">
          <label htmlFor={`${id}-caption`} className="field__label">
            {E.map.caption}
          </label>
          <textarea
            id={`${id}-caption`}
            className="text-input text-input--area export__caption"
            rows={2}
            value={caption}
            aria-describedby={`${id}-caption-help`}
            onChange={(e) => {
              setCaption(e.currentTarget.value);
            }}
          />
          <p id={`${id}-caption-help`} className="field__help">
            {E.map.captionHelp}
          </p>
        </div>
        <button
          type="button"
          className="button button--primary"
          disabled={!ready || busy !== null}
          onClick={() => {
            void run('map', () => exportMapFile(format, resolution, caption));
          }}
        >
          {E.map.export}
        </button>
      </section>

      <section className="export__section" aria-labelledby={`${id}-tables`}>
        <h3 id={`${id}-tables`} className="export__heading">
          {E.tables.heading}
        </h3>
        <p className="field__help">{E.tables.help}</p>
        {tableButton('members', E.tables.members, E.tables.membersHelp)}
        {tableButton('network', E.tables.network, E.tables.networkHelp)}
        {tableButton(
          'formalInformal',
          E.tables.formalInformal,
          hasFormalInformal ? E.tables.formalInformalHelp : E.tables.formalInformalUnavailable,
          !hasFormalInformal,
        )}
      </section>

      <section className="export__section" aria-labelledby={`${id}-report`}>
        <h3 id={`${id}-report`} className="export__heading">
          {E.report.heading}
        </h3>
        <p className="field__help">{E.report.help}</p>
        <button
          type="button"
          className="button button--primary"
          disabled={!ready || busy !== null}
          onClick={() => {
            void run('report', () => exportReportFile(caption));
          }}
        >
          {E.report.export}
        </button>
      </section>

      <p className="export__status" role="status">
        {message}
      </p>
    </Dialog>
  );
}
