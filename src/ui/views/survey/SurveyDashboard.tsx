import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Project, Survey } from '../../../data/schema';
import { applyImport, planImport, type ImportPlan } from '../../../survey/collect';
import { PassphraseError, unwrapPrivateKey } from '../../../survey/crypto';
import { backupFileName, backupText } from '../../../survey/keys';
import {
  buildLinks,
  currentVersion,
  linksCsv,
  responders,
  surveyStatus,
  type SurveyLinks,
} from '../../../survey/model';
import { pageBase } from '../../../survey/payload';
import { fileTransport, type IncomingText } from '../../../survey/transport';
import { ConfirmDialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { percent } from '../../copy/data';
import { surveyCopy } from '../../copy/survey';
import { useMemberNames } from '../../state/names';
import { useAppStore } from '../../state/store';
import { lockKey, setUnlockedKey, useUnlockedKey } from '../../state/surveyKeys';
import { FileReportSection } from '../ValidationReport';
import { downloadText } from './download';

const D = surveyCopy.dashboard;

// Collection dashboard (spec §15.5): status, links, import and the log.
export function SurveyDashboard({
  project,
  survey,
  onEdit,
}: {
  project: Project;
  survey: Survey;
  onEdit: () => void;
}) {
  const updateProjectViews = useAppStore((s) => s.updateProjectViews);
  const setStatus = useAppStore((s) => s.setStatus);
  const names = useMemberNames();
  const status = surveyStatus(survey);
  const threshold = project.settings.coverage_threshold;
  const [confirmClose, setConfirmClose] = useState(false);
  const version = currentVersion(survey);

  return (
    <div className="survey-dashboard">
      <div className="survey-dashboard__head">
        <h2 className="survey__heading">{survey.title}</h2>
        <p className="survey-dashboard__meta">
          {D.status[survey.status]}, {D.version(version.version).toLowerCase()}
        </p>
        <div className="survey-dashboard__head-actions">
          <button type="button" className="button button--secondary" onClick={onEdit}>
            {D.edit}
          </button>
          <button
            type="button"
            className="button button--text"
            onClick={() => {
              downloadText(
                backupText(survey.id, survey.title, survey.key, new Date().toISOString()),
                backupFileName(survey.id),
                'application/json',
              );
            }}
          >
            {D.backupAgain}
          </button>
          {survey.status === 'open' ? (
            <button
              type="button"
              className="button button--text"
              onClick={() => {
                setConfirmClose(true);
              }}
            >
              {D.close}
            </button>
          ) : (
            <button
              type="button"
              className="button button--text"
              onClick={() => {
                updateProjectViews((p) => ({
                  ...p,
                  surveys: p.surveys.map((s) =>
                    s.id === survey.id ? { ...s, status: 'open' } : s,
                  ),
                }));
                setStatus({ text: D.reopened, tone: 'info' });
              }}
            >
              {D.reopen}
            </button>
          )}
        </div>
      </div>

      <dl className="definition-list definition-list--wide survey-dashboard__status">
        <dt>{D.issued}</dt>
        <dd className="num">{status.issued}</dd>
        <dt>{D.imported}</dt>
        <dd className="num">{status.responded}</dd>
        <dt>{D.rate}</dt>
        <dd className="num">
          {status.rate < threshold && <Icon name="warning" />}
          {D.rateAgainst(percent(status.rate), percent(threshold), status.rate < threshold)}
        </dd>
        <dt>{D.duplicates}</dt>
        <dd className="num">{status.duplicates}</dd>
        <dt>{D.rejected}</dt>
        <dd className="num">{status.rejected.length}</dd>
      </dl>

      {survey.status === 'closed' ? (
        <p className="survey-dashboard__note">{D.closedNote}</p>
      ) : (
        <Collect project={project} survey={survey} />
      )}

      <Links project={project} survey={survey} />

      <section className="survey-dashboard__section" aria-labelledby={`${survey.id}-rejected`}>
        <h3 id={`${survey.id}-rejected`} className="survey-dashboard__subheading">
          {D.rejectedHeading}
        </h3>
        {status.rejected.length === 0 ? (
          <p className="field__help">{D.noRejected}</p>
        ) : (
          <table className="survey-table">
            <thead>
              <tr>
                <th scope="col">{D.rejectedColumns.source}</th>
                <th scope="col">{D.rejectedColumns.receipt}</th>
                <th scope="col">{D.rejectedColumns.reason}</th>
                <th scope="col">{D.rejectedColumns.when}</th>
              </tr>
            </thead>
            <tbody>
              {status.rejected.map((r, i) => (
                <tr key={`${r.source}-${String(i)}`}>
                  <td>{r.source}</td>
                  <td className="num">{r.receipt ?? '–'}</td>
                  <td>{surveyCopy.reason(r.reason)}</td>
                  <td className="num">{r.imported_at.slice(0, 16).replace('T', ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {status.duplicates > 0 && (
          <>
            <h3 className="survey-dashboard__subheading">{D.duplicatesHeading}</h3>
            <ul className="survey-dashboard__list">
              {survey.log.map((e, i) =>
                e.kind === 'duplicate' ? (
                  <li key={i}>{D.duplicate(names.of(e.member_id), e.kept, e.set_aside)}</li>
                ) : null,
              )}
            </ul>
          </>
        )}
      </section>

      <ConfirmDialog
        open={confirmClose}
        title={D.closeTitle}
        body={D.closeBody}
        confirm={D.close}
        cancel={D.cancel}
        onCancel={() => {
          setConfirmClose(false);
        }}
        onConfirm={() => {
          setConfirmClose(false);
          updateProjectViews((p) => ({
            ...p,
            surveys: p.surveys.map((s) => (s.id === survey.id ? { ...s, status: 'closed' } : s)),
          }));
          setStatus({ text: D.closed, tone: 'info' });
        }}
      />
    </div>
  );
}

function Collect({ project, survey }: { project: Project; survey: Survey }) {
  const key = useUnlockedKey(survey.id);
  const updateProject = useAppStore((s) => s.updateProject);
  const names = useMemberNames();
  const [pass, setPass] = useState('');
  const [unlockError, setUnlockError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [files, setFiles] = useState<IncomingText[]>([]);
  const [pasted, setPasted] = useState('');
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [nothing, setNothing] = useState(false);
  const [reminder, setReminder] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<(list: FileList | null) => Promise<void>>(() => Promise.resolve());

  // Dropping files is a pointer shortcut; the "Choose response files" button
  // is the keyboard route. Listeners are native so the drop area stays a
  // plain container for assistive technology.
  useEffect(() => {
    const el = dropRef.current;
    if (!el) return;
    const over = (e: DragEvent) => {
      e.preventDefault();
      setDragging(true);
    };
    const leave = () => {
      setDragging(false);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      void addRef.current(e.dataTransfer?.files ?? null);
    };
    el.addEventListener('dragover', over);
    el.addEventListener('dragleave', leave);
    el.addEventListener('drop', drop);
    return () => {
      el.removeEventListener('dragover', over);
      el.removeEventListener('dragleave', leave);
      el.removeEventListener('drop', drop);
    };
  });
  const passId = useId();
  const fileId = useId();
  const pasteId = useId();

  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    const read = await Promise.all(
      [...list].map(async (f) => ({ source: f.name, text: await f.text() })),
    );
    setFiles((prev) => [...prev, ...read]);
    setNothing(false);
  };
  useEffect(() => {
    addRef.current = addFiles;
  });

  if (!key) {
    return (
      <section className="survey-dashboard__section" aria-labelledby={`${passId}-h`}>
        <h3 id={`${passId}-h`} className="survey-dashboard__subheading">
          {D.unlockHeading}
        </h3>
        <p className="survey-dashboard__text">{D.unlockBody}</p>
        <form
          className="survey-dashboard__unlock"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(D.unlocking);
            setUnlockError(false);
            void unwrapPrivateKey(survey.key.wrapped, pass)
              .then((k) => {
                setUnlockedKey(survey.id, k);
                setPass('');
              })
              .catch((err: unknown) => {
                if (err instanceof PassphraseError) setUnlockError(true);
              })
              .finally(() => {
                setBusy(null);
              });
          }}
        >
          <div className="field">
            <label htmlFor={passId} className="field__label">
              {surveyCopy.keys.passphrase}
            </label>
            <input
              id={passId}
              type="password"
              autoComplete="current-password"
              className="text-input"
              value={pass}
              aria-invalid={unlockError}
              onChange={(e) => {
                setPass(e.currentTarget.value);
              }}
            />
            {unlockError && (
              <p className="field__error" role="alert">
                <Icon name="warning" />
                {D.wrongPassphrase}
              </p>
            )}
          </div>
          <button
            type="submit"
            className="button button--primary"
            disabled={busy !== null || pass === ''}
          >
            {D.unlock}
          </button>
          <p role="status" className="survey-keys__busy">
            {busy ?? ''}
          </p>
        </form>
      </section>
    );
  }

  const read = async () => {
    const items: IncomingText[] = [...files];
    if (pasted.trim() !== '') items.push({ source: D.pastedSource(1), text: pasted });
    if (items.length === 0) {
      setNothing(true);
      return;
    }
    setBusy(D.reading);
    try {
      setPlan(await planImport(project, survey, key, fileTransport.collect(items)));
    } finally {
      setBusy(null);
    }
  };

  const confirm = () => {
    if (!plan) return;
    const count = plan.accepted.length;
    const ratings = plan.ties.length;
    updateProject((p) => applyImport(p, plan, new Date().toISOString()), {
      text: D.done(count, ratings),
      tone: 'info',
    });
    setPlan(null);
    setFiles([]);
    setPasted('');
    if (count + plan.rejected.length > 0) setReminder(D.deleteReminder);
  };

  return (
    <section className="survey-dashboard__section" aria-labelledby={`${fileId}-h`}>
      <div className="survey-dashboard__row">
        <h3 id={`${fileId}-h`} className="survey-dashboard__subheading">
          {D.importHeading}
        </h3>
        <p className="survey-dashboard__unlocked">
          <Icon name="check" />
          {D.unlocked}
        </p>
        <button
          type="button"
          className="button button--text"
          onClick={() => {
            lockKey(survey.id);
            setPlan(null);
          }}
        >
          {D.lock}
        </button>
      </div>

      {reminder && (
        <div className="survey-dashboard__reminder" role="status">
          <Icon name="info" />
          <p>{reminder}</p>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => {
              setReminder(null);
            }}
          >
            {D.dismiss}
          </button>
        </div>
      )}

      {!plan && (
        <>
          <div
            ref={dropRef}
            className={dragging ? 'survey-drop survey-drop--active' : 'survey-drop'}
          >
            <p>{D.drop}</p>
            <label htmlFor={fileId} className="button button--secondary">
              {D.chooseFiles}
            </label>
            <input
              id={fileId}
              type="file"
              multiple
              accept=".txt,text/plain"
              className="visually-hidden"
              onChange={(e) => {
                const list = e.currentTarget.files;
                void addFiles(list).then(() => undefined);
                e.currentTarget.value = '';
              }}
            />
            {files.length > 0 && (
              <ul className="survey-drop__files">
                {files.map((f, i) => (
                  <li key={`${f.source}-${String(i)}`}>{f.source}</li>
                ))}
              </ul>
            )}
          </div>
          <div className="field">
            <label htmlFor={pasteId} className="field__label">
              {D.paste}
            </label>
            <textarea
              id={pasteId}
              className="text-input text-input--area survey-setup__wide survey-paste"
              rows={5}
              value={pasted}
              aria-describedby={`${pasteId}-help`}
              onChange={(e) => {
                setPasted(e.currentTarget.value);
                setNothing(false);
              }}
            />
            <p id={`${pasteId}-help`} className="field__help">
              {D.pasteHelp}
            </p>
          </div>
          {nothing && (
            <p className="field__error" role="alert">
              <Icon name="warning" />
              {D.nothing}
            </p>
          )}
          <button
            type="button"
            className="button button--primary"
            disabled={busy !== null}
            onClick={() => {
              void read();
            }}
          >
            {D.read}
          </button>
        </>
      )}
      <p role="status" className="survey-keys__busy">
        {busy ?? ''}
      </p>

      {plan && (
        <div className="survey-plan">
          <h4 className="survey-dashboard__subheading">{D.planHeading}</h4>
          <ul className="survey-dashboard__list num">
            <li>{D.planAccepted(plan.accepted.length)}</li>
            {plan.replaced.length > 0 && <li>{D.planReplaced(plan.replaced.length)}</li>}
            {plan.duplicates.length > 0 && <li>{D.planDuplicates(plan.duplicates.length)}</li>}
            {plan.alreadyImported.length > 0 && (
              <li>{D.planAlready(plan.alreadyImported.length)}</li>
            )}
            {plan.rejected.length > 0 && <li>{D.planRejected(plan.rejected.length)}</li>}
          </ul>
          {plan.rejected.length > 0 && (
            <ul className="survey-dashboard__list">
              {plan.rejected.map((r, i) => (
                <li key={`${r.source}-${String(i)}`}>
                  <strong>{r.source}</strong>
                  {r.receipt ? ` (${r.receipt})` : ''}: {surveyCopy.reason(r.reason)}
                </li>
              ))}
            </ul>
          )}
          {plan.mapping.length > 0 && (
            <>
              <h4 className="survey-dashboard__subheading">{D.mappingHeading}</h4>
              <ul className="survey-dashboard__list">
                {plan.mapping.map((m) => (
                  <li key={m.receipt}>
                    {D.mapping(m.receipt, m.version)}
                    {m.droppedLayers.length > 0 &&
                      ` ${D.droppedLayers(m.droppedLayers.map((k) => project.layers.find((l) => l.key === k)?.label ?? k).join(', '))}`}
                    {m.droppedColleagues.length > 0 &&
                      ` ${D.droppedColleagues(m.droppedColleagues.map((id) => names.of(id)).join(', '))}`}
                    {m.notAsked.length > 0 &&
                      ` ${D.notAsked(m.notAsked.map((id) => names.of(id)).join(', '))}`}
                  </li>
                ))}
              </ul>
            </>
          )}
          {plan.accepted.length > 0 && <FileReportSection report={plan.report} />}
          <div className="survey-setup__actions">
            <button
              type="button"
              className="button button--text"
              onClick={() => {
                setPlan(null);
              }}
            >
              {D.cancel}
            </button>
            {(plan.accepted.length > 0 || plan.rejected.length > 0) && (
              <button type="button" className="button button--primary" onClick={confirm}>
                {plan.accepted.length > 0 ? D.confirm(plan.accepted.length) : D.confirmNone}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function Links({ project, survey }: { project: Project; survey: Survey }) {
  const names = useMemberNames();
  const setStatus = useAppStore((s) => s.setStatus);
  const [built, setBuilt] = useState<{
    survey: Survey;
    project: Project;
    links: SurveyLinks;
  } | null>(null);
  const links = built?.survey === survey && built.project === project ? built.links : null;
  const done = useMemo(() => responders(survey), [survey]);
  const headingId = useId();

  useEffect(() => {
    const run = { live: true };
    void buildLinks(survey, project, pageBase(window.location.href)).then((l) => {
      if (run.live) setBuilt({ survey, project, links: l });
    });
    return () => {
      run.live = false;
    };
  }, [survey, project]);

  const byMember = new Map(links?.links.map((l) => [l.memberId, l]) ?? []);
  const packages = links ? [...links.packages.entries()] : [];
  const stem = `graticule-survey-${survey.id}`;
  const exportCsv = (only: Set<string> | undefined, file: string) => {
    if (!links) return;
    downloadText(linksCsv(project, links.links, only), file, 'text/csv');
    setStatus({ text: D.exported(file), tone: 'info' });
  };

  return (
    <section className="survey-dashboard__section" aria-labelledby={headingId}>
      <h3 id={headingId} className="survey-dashboard__subheading">
        {D.linksHeading}
      </h3>
      <p className="survey-dashboard__text">{D.linksHelp}</p>
      {!links ? (
        <p role="status">{D.building}</p>
      ) : (
        <>
          {packages.map(([v, pkg]) => (
            <div key={v} className="survey-dashboard__package">
              <p>
                {survey.settings.link_mode === 'package'
                  ? D.packageAlways(pkg.fileName)
                  : D.packageHelp(pkg.fileName)}
              </p>
              <button
                type="button"
                className="button button--secondary"
                onClick={() => {
                  downloadText(pkg.text, pkg.fileName, 'application/json');
                }}
              >
                {D.downloadPackage(v)}
              </button>
            </div>
          ))}
          <div className="survey-dashboard__exports">
            <button
              type="button"
              className="button button--secondary"
              onClick={() => {
                exportCsv(undefined, `${stem}-links.csv`);
              }}
            >
              {D.exportLinks}
            </button>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => {
                exportCsv(
                  new Set(surveyStatus(survey).nonResponders),
                  `${stem}-non-responders.csv`,
                );
              }}
            >
              {D.exportNonResponders}
            </button>
            <p className="field__help">{D.personalData}</p>
          </div>
          <table className="survey-table">
            <thead>
              <tr>
                <th scope="col">{D.columns.name}</th>
                <th scope="col">{D.columns.version}</th>
                <th scope="col">{D.columns.status}</th>
                <th scope="col">{D.columns.link}</th>
              </tr>
            </thead>
            <tbody>
              {survey.respondents.map((r) => {
                const link = byMember.get(r.member_id);
                const name = names.of(r.member_id);
                return (
                  <tr key={r.member_id}>
                    <th scope="row">{name}</th>
                    <td className="num">{r.version}</td>
                    <td>{done.has(r.member_id) ? D.responded : D.waiting}</td>
                    <td>
                      {link && (
                        <button
                          type="button"
                          className="button button--text"
                          aria-label={D.copyFor(name)}
                          onClick={() => {
                            navigator.clipboard.writeText(link.url).then(
                              () => {
                                setStatus({ text: D.copied(name), tone: 'info' });
                              },
                              () => {
                                setStatus({ text: D.copyFailed, tone: 'error' });
                              },
                            );
                          }}
                        >
                          {D.copy}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
