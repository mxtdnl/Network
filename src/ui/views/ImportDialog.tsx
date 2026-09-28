import { useId, useState } from 'react';
import { defaultLayers } from '../../data/defaults';
import { addImportedTies, existingTieKeys, projectFromImport } from '../../data/import/apply';
import {
  validateMembers,
  validateTies,
  type MembersResult,
  type TiesResult,
} from '../../data/import/validate';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { importCopy } from '../copy/import';
import { readImportFile } from '../state/projectActions';
import { useAppStore } from '../state/store';
import { FileReportSection } from './ValidationReport';

interface CheckResult {
  members: MembersResult | null;
  ties: TiesResult | null;
  /** The ties file waits for a members file that can be imported. */
  tiesDeferred: boolean;
  readErrors: string[];
}

const ACCEPT =
  '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const templateUrl = (name: string) => `${import.meta.env.BASE_URL}templates/${name}`;

function FileField({
  label,
  help,
  file,
  onChange,
}: {
  label: string;
  help: string;
  file: File | null;
  onChange: (file: File | null) => void;
}) {
  const id = useId();
  return (
    <div className="field">
      <span id={id} className="field__label">
        {label}
      </span>
      <p id={`${id}-help`} className="field__help">
        {help}
      </p>
      {/* The native button reads "Choose File" in title case, so the input is
          hidden visually and a sentence-case label acts as its button. */}
      <div className="file-field">
        <input
          id={`${id}-input`}
          type="file"
          accept={ACCEPT}
          className="visually-hidden file-field__input"
          aria-labelledby={`${id} ${id}-name`}
          aria-describedby={`${id}-help`}
          onChange={(e) => {
            onChange(e.currentTarget.files?.[0] ?? null);
          }}
        />
        <label htmlFor={`${id}-input`} className="button button--secondary file-field__button">
          {importCopy.chooseFile}
        </label>
        <span id={`${id}-name`} className="file-field__name">
          {file ? file.name : importCopy.noFile}
        </span>
      </div>
    </div>
  );
}

export function ImportDialog() {
  const open = useAppStore((s) => s.ui.importOpen);
  const setImportOpen = useAppStore((s) => s.setImportOpen);
  const project = useAppStore((s) => s.data.project);

  return (
    <Dialog
      open={open}
      title={importCopy.title}
      wide
      onClose={() => {
        setImportOpen(false);
      }}
    >
      <ImportFlow
        hasProject={project !== null && project.members.length > 0}
        onDone={() => {
          setImportOpen(false);
        }}
      />
    </Dialog>
  );
}

function ImportFlow({ hasProject, onDone }: { hasProject: boolean; onDone: () => void }) {
  const [membersFile, setMembersFile] = useState<File | null>(null);
  const [tiesFile, setTiesFile] = useState<File | null>(null);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  const setProject = useAppStore((s) => s.setProject);

  const canCheck = !checking && (membersFile !== null || (hasProject && tiesFile !== null));

  async function check() {
    setChecking(true);
    const readErrors: string[] = [];
    const read = async (file: File | null) => {
      if (!file) return null;
      try {
        return await readImportFile(file);
      } catch (e) {
        readErrors.push(
          importCopy.unreadable(file.name, e instanceof Error ? e.message : String(e)),
        );
        return null;
      }
    };
    const [membersTable, tiesTable] = await Promise.all([read(membersFile), read(tiesFile)]);
    const current = useAppStore.getState().data.project;
    const members = membersTable ? validateMembers(membersTable) : null;

    let ties: TiesResult | null = null;
    let tiesDeferred = false;
    if (tiesTable) {
      if (members && !members.report.blocked) {
        ties = validateTies(tiesTable, {
          memberIds: new Set(members.members.map((m) => m.id)),
          skippedMemberIds: members.skippedIds,
          layers: current?.layers ?? defaultLayers(),
        });
      } else if (!membersFile && current) {
        ties = validateTies(tiesTable, {
          memberIds: new Set(current.members.map((m) => m.id)),
          layers: current.layers,
          existingKeys: existingTieKeys(current),
        });
      } else tiesDeferred = true;
    }
    setResult({ members, ties, tiesDeferred, readErrors });
    setChecking(false);
  }

  function importValid() {
    if (!result) return;
    const now = new Date().toISOString();
    const current = useAppStore.getState().data.project;
    const { members, ties } = result;
    const rows = (members?.report.validRows ?? 0) + (ties?.report.validRows ?? 0);
    const skipped = (members?.report.skippedRows ?? 0) + (ties?.report.skippedRows ?? 0);
    const status = { text: importCopy.imported(rows, skipped), tone: 'info' as const };
    if (members && !members.report.blocked) {
      const title = membersFile?.name.replace(/\.(csv|xlsx)$/i, '') ?? importCopy.untitled;
      const next = projectFromImport(title, now, members, ties);
      // Imported layer settings follow the project that was open, if any.
      if (current) next.layers = current.layers;
      setProject(next, status);
    } else if (ties && current) {
      setProject(addImportedTies(current, ties, now), status);
    }
    onDone();
  }

  if (result) {
    const importable =
      (result.members !== null &&
        !result.members.report.blocked &&
        result.members.report.validRows > 0) ||
      (result.members === null && result.ties !== null && result.ties.report.validRows > 0);
    const validRows =
      (result.members?.report.blocked ? 0 : (result.members?.report.validRows ?? 0)) +
      (result.ties?.report.validRows ?? 0);
    return (
      <div className="report">
        <h3 className="report__title">{importCopy.reportTitle}</h3>
        <p className="report__intro">{importCopy.rowNumbers}</p>
        {result.readErrors.map((message) => (
          <p key={message} className="report__line" role="alert">
            <Icon name="warning" />
            {message}
          </p>
        ))}
        {result.members && <FileReportSection report={result.members.report} />}
        {result.ties && <FileReportSection report={result.ties.report} />}
        {result.tiesDeferred && (
          <p className="report__line">
            <Icon name="info" />
            {importCopy.tiesDeferred}
          </p>
        )}
        <div className="dialog__actions">
          <button type="button" className="button button--text" onClick={onDone}>
            {importCopy.cancel}
          </button>
          <button
            type="button"
            className="button button--text"
            onClick={() => {
              setResult(null);
            }}
          >
            {importCopy.back}
          </button>
          {importable ? (
            <button type="button" className="button button--primary" onClick={importValid}>
              {importCopy.importValid(validRows)}
            </button>
          ) : (
            <p className="report__line">{importCopy.nothingToImport}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="import">
      <p className="import__intro">{importCopy.intro}</p>
      {hasProject && <p className="import__intro">{importCopy.replaceWarning}</p>}
      <FileField
        label={importCopy.membersLabel}
        help={importCopy.membersHelp}
        file={membersFile}
        onChange={setMembersFile}
      />
      <FileField
        label={importCopy.tiesLabel}
        help={
          hasProject ? `${importCopy.tiesHelp} ${importCopy.tiesOnlyHelp}` : importCopy.tiesHelp
        }
        file={tiesFile}
        onChange={setTiesFile}
      />
      <div className="import__templates">
        <h3 className="import__templates-heading">{importCopy.templates}</h3>
        <ul className="import__template-list">
          <li>
            <a href={templateUrl('members.csv')} download>
              {importCopy.templateMembers}
            </a>
          </li>
          <li>
            <a href={templateUrl('ties.csv')} download>
              {importCopy.templateTies}
            </a>
          </li>
          <li>
            <a href={templateUrl('members.xlsx')} download>
              {importCopy.templateMembersXlsx}
            </a>
          </li>
          <li>
            <a href={templateUrl('ties.xlsx')} download>
              {importCopy.templateTiesXlsx}
            </a>
          </li>
        </ul>
      </div>
      {!membersFile && !hasProject && <p className="field__help">{importCopy.needMembers}</p>}
      <div className="dialog__actions">
        <button type="button" className="button button--text" onClick={onDone}>
          {importCopy.cancel}
        </button>
        <button
          type="button"
          className="button button--primary"
          disabled={!canCheck}
          onClick={() => {
            void check();
          }}
        >
          {checking ? importCopy.checking : importCopy.check}
        </button>
      </div>
    </div>
  );
}
