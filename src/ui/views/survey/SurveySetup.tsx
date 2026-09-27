import { useId, useMemo, useState } from 'react';
import {
  isCategorical,
  type Project,
  type Survey,
  type SurveyKey,
  type SurveyLayer,
} from '../../../data/schema';
import { MIN_PASSPHRASE_LENGTH } from '../../../survey/crypto';
import {
  backupFileName,
  backupText,
  BackupError,
  createSurveyKey,
  verifyBackup,
} from '../../../survey/keys';
import {
  createSurvey,
  DEFAULT_NOMINATION_QUESTION,
  DEFAULT_SURVEY_SETTINGS,
  draftFromSurvey,
  draftProblems,
  estimateMinutes,
  estimateSeconds,
  needsNewVersion,
  newSurveyId,
  surveyLayerFrom,
  updateSurvey,
  type SurveyDraft,
} from '../../../survey/model';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { surveyCopy } from '../../copy/survey';
import { setUnlockedKey } from '../../state/surveyKeys';
import { useMemberNames } from '../../state/names';
import { useAppStore } from '../../state/store';
import { downloadText } from './download';

const S = surveyCopy.setup;
const K = surveyCopy.keys;

function newDraft(project: Project): SurveyDraft {
  return {
    title: project.meta.title,
    layers: project.layers.filter((l) => l.enabled).map(surveyLayerFrom),
    entry: 'nominate',
    nominationQuestion: DEFAULT_NOMINATION_QUESTION,
    texts: { introduction: '', confidentiality: '', return_instructions: '' },
    deadline: null,
    wave: 1,
    settings: { ...DEFAULT_SURVEY_SETTINGS },
    sharedAttributes: [],
    required: [],
  };
}

interface Props {
  project: Project;
  /** Absent when creating a survey. */
  survey?: Survey;
  onDone: (surveyId: string) => void;
  onCancel?: (() => void) | undefined;
}

// Survey setup (spec §15.1) and, for a new survey, its key and backup
// (§15.2): the survey cannot be created until a backup has been downloaded
// and opened with the passphrase (CLAUDE.md D87).
export function SurveySetup({ project, survey, onDone, onCancel }: Props) {
  const updateProjectViews = useAppStore((s) => s.updateProjectViews);
  const setStatus = useAppStore((s) => s.setStatus);
  const [draft, setDraft] = useState<SurveyDraft>(() =>
    survey ? draftFromSurvey(survey) : newDraft(project),
  );
  const [tried, setTried] = useState(false);
  const [versionDialog, setVersionDialog] = useState(false);
  const ids = {
    title: useId(),
    entry: useId(),
    intro: useId(),
    conf: useId(),
    ret: useId(),
    deadline: useId(),
    wave: useId(),
    nq: useId(),
    limit: useId(),
    expected: useId(),
    links: useId(),
    shared: useId(),
  };

  const problems = draftProblems(draft, project);
  const minutes = estimateMinutes(
    estimateSeconds(
      project.members.length,
      draft.layers.length,
      draft.entry,
      draft.settings.expected_nominations,
      draft.required.length,
    ),
  );
  const overLimit = minutes > draft.settings.burden_limit_minutes;
  const set = (patch: Partial<SurveyDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
  };
  const setLayer = (key: string, patch: Partial<SurveyLayer>) => {
    set({ layers: draft.layers.map((l) => (l.key === key ? { ...l, ...patch } : l)) });
  };
  const toggleLayer = (key: string, on: boolean) => {
    const def = project.layers.find((l) => l.key === key);
    if (!def) return;
    const order = new Map(project.layers.map((l, i) => [l.key, i]));
    const layers = on
      ? [...draft.layers, surveyLayerFrom(def)].sort(
          (a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0),
        )
      : draft.layers.filter((l) => l.key !== key);
    set({ layers });
  };
  const sharable = project.attribute_definitions.filter(
    (a) => a.type !== 'member_ref' && a.type !== 'email',
  );
  const available = project.layers.filter((l) => l.enabled);

  const saveEdit = (issue: 'all' | 'new') => {
    if (!survey) return;
    const now = new Date().toISOString();
    const next = updateSurvey(survey, draft, project, now, issue);
    updateProjectViews((p) => ({
      ...p,
      surveys: p.surveys.map((s) => (s.id === survey.id ? next : s)),
    }));
    const created = next.versions.length > survey.versions.length;
    setStatus({ text: created ? S.versionCreated(next.versions.length) : S.saved, tone: 'info' });
    onDone(survey.id);
  };

  const showErrors = tried && problems.length > 0;
  const error = (key: string) =>
    tried && problems.includes(key) ? (
      <p className="field__error">
        <Icon name="warning" />
        {S.missing[key]}
      </p>
    ) : null;

  return (
    <div className="survey-setup">
      <h2 className="survey__heading">{survey ? S.editHeading : S.createHeading}</h2>

      <div className="field">
        <label htmlFor={ids.title} className="field__label">
          {S.title}
        </label>
        <input
          id={ids.title}
          className="text-input"
          value={draft.title}
          aria-invalid={tried && problems.includes('title')}
          onChange={(e) => {
            set({ title: e.currentTarget.value });
          }}
        />
        <p className="field__help">{S.titleHelp}</p>
        {error('title')}
      </div>

      <fieldset className="survey-setup__group">
        <legend className="survey-setup__legend">{S.questions}</legend>
        <p className="field__help">{S.questionsHelp}</p>
        {error('layers')}
        {error('wording')}
        {available.map((def) => {
          const layer = draft.layers.find((l) => l.key === def.key);
          return (
            <div key={def.key} className="survey-setup__layer">
              <label className="radio-list__option">
                <input
                  type="checkbox"
                  checked={!!layer}
                  onChange={(e) => {
                    toggleLayer(def.key, e.currentTarget.checked);
                  }}
                />
                {S.include(def.label)}
              </label>
              {layer && (
                <LayerFields
                  layer={layer}
                  nominate={draft.entry === 'nominate'}
                  onChange={(patch) => {
                    setLayer(def.key, patch);
                  }}
                />
              )}
            </div>
          );
        })}
      </fieldset>

      <fieldset className="survey-setup__group">
        <legend className="survey-setup__legend">{S.entry}</legend>
        <div className="radio-list">
          <label className="radio-list__option">
            <input
              type="radio"
              name={ids.entry}
              checked={draft.entry === 'nominate'}
              onChange={() => {
                set({ entry: 'nominate' });
              }}
            />
            {S.nominate}
          </label>
          <p className="field__help survey-setup__option-help">{S.nominateHelp}</p>
          <label className="radio-list__option">
            <input
              type="radio"
              name={ids.entry}
              checked={draft.entry === 'full'}
              onChange={() => {
                set({ entry: 'full' });
              }}
            />
            {S.full}
          </label>
          <p className="field__help survey-setup__option-help">{S.fullHelp}</p>
        </div>
        {draft.entry === 'nominate' && (
          <div className="field">
            <label htmlFor={ids.nq} className="field__label">
              {S.nominationQuestion}
            </label>
            <input
              id={ids.nq}
              className="text-input survey-setup__wide"
              value={draft.nominationQuestion}
              onChange={(e) => {
                set({ nominationQuestion: e.currentTarget.value });
              }}
            />
            {error('nominationQuestion')}
          </div>
        )}
        {draft.entry === 'nominate' && (
          <RequiredPicker
            project={project}
            required={draft.required}
            onChange={(required) => {
              set({ required });
            }}
          />
        )}
      </fieldset>

      <fieldset className="survey-setup__group">
        <legend className="survey-setup__legend">{S.texts}</legend>
        <TextArea
          id={ids.intro}
          label={S.introduction}
          help={S.introductionHelp}
          value={draft.texts.introduction}
          invalid={tried && problems.includes('introduction')}
          onChange={(v) => {
            set({ texts: { ...draft.texts, introduction: v } });
          }}
        />
        {error('introduction')}
        <TextArea
          id={ids.conf}
          label={S.confidentiality}
          help={S.confidentialityHelp}
          value={draft.texts.confidentiality}
          invalid={tried && problems.includes('confidentiality')}
          onChange={(v) => {
            set({ texts: { ...draft.texts, confidentiality: v } });
          }}
        />
        {error('confidentiality')}
        <TextArea
          id={ids.ret}
          label={S.returnInstructions}
          help={S.returnHelp}
          value={draft.texts.return_instructions}
          invalid={tried && problems.includes('returnInstructions')}
          onChange={(v) => {
            set({ texts: { ...draft.texts, return_instructions: v } });
          }}
        />
        {error('returnInstructions')}
        <div className="survey-setup__row">
          <div className="field">
            <label htmlFor={ids.deadline} className="field__label">
              {S.deadline}
            </label>
            <input
              id={ids.deadline}
              type="date"
              className="text-input"
              value={draft.deadline ?? ''}
              onChange={(e) => {
                set({ deadline: e.currentTarget.value || null });
              }}
            />
          </div>
          <div className="field">
            <label htmlFor={ids.wave} className="field__label">
              {S.wave}
            </label>
            <input
              id={ids.wave}
              type="number"
              min={1}
              step={1}
              className="text-input text-input--number num"
              value={draft.wave}
              onChange={(e) => {
                set({ wave: Number(e.currentTarget.value) });
              }}
            />
            <p className="field__help">{S.waveHelp}</p>
            {error('wave')}
          </div>
        </div>
        {sharable.length > 0 && (
          <fieldset className="survey-setup__subgroup">
            <legend className="field__label">{S.shared}</legend>
            <p className="field__help">{S.sharedHelp}</p>
            {sharable.map((a) => (
              <label key={a.key} className="radio-list__option">
                <input
                  type="checkbox"
                  checked={draft.sharedAttributes.includes(a.key)}
                  onChange={(e) => {
                    const on = e.currentTarget.checked;
                    set({
                      sharedAttributes: on
                        ? [...draft.sharedAttributes, a.key]
                        : draft.sharedAttributes.filter((k) => k !== a.key),
                    });
                  }}
                />
                {a.label}
              </label>
            ))}
          </fieldset>
        )}
      </fieldset>

      <fieldset className="survey-setup__group">
        <legend className="survey-setup__legend">{S.estimate}</legend>
        <p className="survey-setup__estimate num">{S.estimateValue(minutes)}</p>
        <p className="field__help">{S.estimateBasis}</p>
        {overLimit && (
          <p className="survey-setup__warning" role="status">
            <Icon name="warning" />
            {S.burden(minutes, draft.settings.burden_limit_minutes)}
          </p>
        )}
        <div className="survey-setup__row">
          {draft.entry === 'nominate' && (
            <div className="field">
              <label htmlFor={ids.expected} className="field__label">
                {S.expected}
              </label>
              <input
                id={ids.expected}
                type="number"
                min={0}
                step={1}
                className="text-input text-input--number num"
                value={draft.settings.expected_nominations}
                onChange={(e) => {
                  set({
                    settings: {
                      ...draft.settings,
                      expected_nominations: Math.max(0, Math.round(Number(e.currentTarget.value))),
                    },
                  });
                }}
              />
            </div>
          )}
          <div className="field">
            <label htmlFor={ids.limit} className="field__label">
              {S.limit}
            </label>
            <input
              id={ids.limit}
              type="number"
              min={1}
              step={1}
              className="text-input text-input--number num"
              value={draft.settings.burden_limit_minutes}
              onChange={(e) => {
                set({
                  settings: {
                    ...draft.settings,
                    burden_limit_minutes: Math.max(1, Math.round(Number(e.currentTarget.value))),
                  },
                });
              }}
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="survey-setup__group">
        <legend className="survey-setup__legend">{S.links}</legend>
        <div className="radio-list">
          <label className="radio-list__option">
            <input
              type="radio"
              name={ids.links}
              checked={draft.settings.link_mode === 'auto'}
              onChange={() => {
                set({ settings: { ...draft.settings, link_mode: 'auto' } });
              }}
            />
            {S.linkAuto}
          </label>
          <p className="field__help survey-setup__option-help">{S.linkAutoHelp}</p>
          <label className="radio-list__option">
            <input
              type="radio"
              name={ids.links}
              checked={draft.settings.link_mode === 'package'}
              onChange={() => {
                set({ settings: { ...draft.settings, link_mode: 'package' } });
              }}
            />
            {S.linkPackage}
          </label>
          <p className="field__help survey-setup__option-help">{S.linkPackageHelp}</p>
        </div>
      </fieldset>

      {survey ? (
        <div className="survey-setup__actions">
          {onCancel && (
            <button type="button" className="button button--text" onClick={onCancel}>
              {S.cancel}
            </button>
          )}
          <button
            type="button"
            className="button button--primary"
            onClick={() => {
              setTried(true);
              if (problems.length > 0) return;
              if (needsNewVersion(survey, draft, project)) setVersionDialog(true);
              else saveEdit('all');
            }}
          >
            {S.save}
          </button>
          <Dialog
            open={versionDialog}
            title={S.newVersionTitle}
            onClose={() => {
              setVersionDialog(false);
            }}
            actions={
              <div className="dialog__actions-end">
                <button
                  type="button"
                  className="button button--text"
                  onClick={() => {
                    setVersionDialog(false);
                  }}
                >
                  {S.cancel}
                </button>
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => {
                    setVersionDialog(false);
                    saveEdit('new');
                  }}
                >
                  {S.issueNew}
                </button>
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => {
                    setVersionDialog(false);
                    saveEdit('all');
                  }}
                >
                  {S.issueAll}
                </button>
              </div>
            }
          >
            <p>{S.newVersionBody(survey.versions.length + 1)}</p>
          </Dialog>
        </div>
      ) : (
        <KeyStep
          project={project}
          draft={draft}
          ready={problems.length === 0}
          onBlocked={() => {
            setTried(true);
          }}
          onCreated={(created) => {
            updateProjectViews((p) => ({ ...p, surveys: [...p.surveys, created] }));
            setStatus({ text: K.created, tone: 'info' });
            onDone(created.id);
          }}
          onCancel={onCancel}
        />
      )}
      {showErrors && (
        <p className="visually-hidden" role="status">
          {problems.map((p) => S.missing[p]).join(' ')}
        </p>
      )}
    </div>
  );
}

function TextArea({
  id,
  label,
  help,
  value,
  invalid,
  onChange,
}: {
  id: string;
  label: string;
  help: string;
  value: string;
  invalid: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className="field">
      <label htmlFor={id} className="field__label">
        {label}
      </label>
      <textarea
        id={id}
        className="text-input text-input--area survey-setup__wide"
        rows={4}
        value={value}
        aria-invalid={invalid}
        aria-describedby={`${id}-help`}
        onChange={(e) => {
          onChange(e.currentTarget.value);
        }}
      />
      <p id={`${id}-help`} className="field__help">
        {help}
      </p>
    </div>
  );
}

function LayerFields({
  layer,
  nominate,
  onChange,
}: {
  layer: SurveyLayer;
  nominate: boolean;
  onChange: (patch: Partial<SurveyLayer>) => void;
}) {
  const wordingId = useId();
  const labelId = useId();
  const ruleId = useId();
  const categorical = isCategorical({
    ...layer,
    default_weight: 0,
    enabled: true,
    core: false,
    builtin: false,
  });
  const points = useMemo(() => {
    const out: number[] = [];
    if (!categorical) for (let v = layer.min; v <= layer.max; v++) out.push(v);
    return out;
  }, [layer.min, layer.max, categorical]);
  const lowest = layer.scale_labels?.[String(layer.min)];
  return (
    <div className="survey-setup__layer-fields">
      <div className="field">
        <label htmlFor={labelId} className="field__label">
          {S.shortName}
        </label>
        <input
          id={labelId}
          className="text-input"
          value={layer.label}
          aria-describedby={`${labelId}-help`}
          onChange={(e) => {
            onChange({ label: e.currentTarget.value });
          }}
        />
        <p id={`${labelId}-help`} className="field__help">
          {S.shortNameHelp}
        </p>
      </div>
      <div className="field">
        <label htmlFor={wordingId} className="field__label">
          {S.wording}
        </label>
        <textarea
          id={wordingId}
          className="text-input text-input--area survey-setup__wide"
          rows={2}
          value={layer.question_wording}
          onChange={(e) => {
            onChange({ question_wording: e.currentTarget.value });
          }}
        />
      </div>
      {points.length > 0 && (
        <fieldset className="survey-setup__subgroup">
          <legend className="field__label">{S.scaleLabels}</legend>
          <div className="survey-setup__points">
            {points.map((v) => {
              const mark = v > 0 && layer.signed ? `+${String(v)}` : String(v);
              return (
                <label key={v} className="survey-setup__point">
                  <span className="num survey-setup__point-mark">{mark}</span>
                  <input
                    className="text-input"
                    aria-label={S.scalePoint(mark)}
                    value={layer.scale_labels?.[String(v)] ?? ''}
                    onChange={(e) => {
                      const text = e.currentTarget.value;
                      const others = Object.entries(layer.scale_labels ?? {}).filter(
                        ([k]) => k !== String(v),
                      );
                      onChange({
                        scale_labels: Object.fromEntries(
                          text === '' ? others : [...others, [String(v), text]],
                        ),
                      });
                    }}
                  />
                </label>
              );
            })}
          </div>
        </fieldset>
      )}
      {nominate && !categorical && (
        <div className="field">
          <label htmlFor={ruleId} className="field__label">
            {S.unselected}
          </label>
          <select
            id={ruleId}
            className="select"
            value={layer.unselected}
            onChange={(e) => {
              onChange({
                unselected: e.currentTarget.value === 'zero' ? 'zero' : 'not_applicable',
              });
            }}
          >
            <option value="zero">
              {S.unselectedZero(lowest ? `${String(layer.min)} (${lowest})` : String(layer.min))}
            </option>
            <option value="not_applicable">{S.unselectedNone}</option>
          </select>
        </div>
      )}
      <label className="radio-list__option">
        <input
          type="checkbox"
          checked={layer.offer_not_applicable}
          aria-describedby={`${ruleId}-na`}
          onChange={(e) => {
            onChange({ offer_not_applicable: e.currentTarget.checked });
          }}
        />
        {S.offerNa}
      </label>
      <p id={`${ruleId}-na`} className="field__help survey-setup__option-help">
        {S.offerNaHelp}
      </p>
    </div>
  );
}

// Colleagues every respondent is asked about, whether or not they select them
// (D103): a searchable checklist of the roster.
function RequiredPicker({
  project,
  required,
  onChange,
}: {
  project: Project;
  required: string[];
  onChange: (ids: string[]) => void;
}) {
  const names = useMemberNames();
  const [query, setQuery] = useState('');
  const searchId = useId();
  const chosen = new Set(required);
  const q = query.trim().toLowerCase();
  const shown = project.members.filter((m) => q === '' || names.of(m.id).toLowerCase().includes(q));
  const toggle = (id: string, on: boolean) => {
    onChange(on ? [...required, id] : required.filter((x) => x !== id));
  };
  return (
    <fieldset className="survey-setup__subgroup survey-required">
      <legend className="field__label">{S.required}</legend>
      <p className="field__help">{S.requiredHelp}</p>
      <div className="survey-required__bar">
        <label htmlFor={searchId} className="visually-hidden">
          {S.requiredSearch}
        </label>
        <input
          id={searchId}
          type="search"
          className="text-input"
          placeholder={S.requiredSearch}
          value={query}
          onChange={(e) => {
            setQuery(e.currentTarget.value);
          }}
        />
        <p className="num" role="status">
          {S.requiredCount(chosen.size)}
        </p>
        {chosen.size > 0 && (
          <button
            type="button"
            className="button button--text"
            onClick={() => {
              onChange([]);
            }}
          >
            {S.requiredClear}
          </button>
        )}
      </div>
      <ul className="survey-required__list">
        {shown.map((m) => (
          <li key={m.id}>
            <label className="radio-list__option">
              <input
                type="checkbox"
                checked={chosen.has(m.id)}
                onChange={(e) => {
                  toggle(m.id, e.currentTarget.checked);
                }}
              />
              {names.of(m.id)}
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

// Passphrase → key → backup download → backup check → create (spec §15.2).
function KeyStep({
  project,
  draft,
  ready,
  onBlocked,
  onCreated,
  onCancel,
}: {
  project: Project;
  draft: SurveyDraft;
  ready: boolean;
  onBlocked: () => void;
  onCreated: (s: Survey) => void;
  onCancel?: (() => void) | undefined;
}) {
  const [surveyId] = useState(newSurveyId);
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [key, setKey] = useState<{ key: SurveyKey; privateKey: CryptoKey } | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [verified, setVerified] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const passId = useId();
  const againId = useId();
  const fileId = useId();
  const short = pass.length < MIN_PASSPHRASE_LENGTH;
  const differ = pass !== again;

  return (
    <section className="survey-setup__group survey-keys" aria-labelledby={`${passId}-h`}>
      <h3 id={`${passId}-h`} className="survey-setup__legend">
        {K.heading}
      </h3>
      <p className="survey-keys__text">{K.body}</p>
      <p className="survey-setup__warning">
        <Icon name="warning" />
        {K.lossWarning}
      </p>
      <div className="field">
        <label htmlFor={passId} className="field__label">
          {K.passphrase}
        </label>
        <input
          id={passId}
          type="password"
          autoComplete="new-password"
          className="text-input"
          value={pass}
          disabled={!!key}
          aria-invalid={tried && short}
          onChange={(e) => {
            setPass(e.currentTarget.value);
          }}
        />
        <p className="field__help">{K.passphraseHelp}</p>
        {tried && short && (
          <p className="field__error">
            <Icon name="warning" />
            {K.tooShort}
          </p>
        )}
      </div>
      <div className="field">
        <label htmlFor={againId} className="field__label">
          {K.confirm}
        </label>
        <input
          id={againId}
          type="password"
          autoComplete="new-password"
          className="text-input"
          value={again}
          disabled={!!key}
          aria-invalid={tried && !short && differ}
          onChange={(e) => {
            setAgain(e.currentTarget.value);
          }}
        />
        {tried && !short && differ && (
          <p className="field__error">
            <Icon name="warning" />
            {K.mismatch}
          </p>
        )}
      </div>
      {!key && (
        <button
          type="button"
          className="button button--secondary"
          disabled={busy !== null}
          onClick={() => {
            setTried(true);
            if (short || differ) return;
            setBusy(K.creating);
            void createSurveyKey(pass)
              .then(setKey)
              .finally(() => {
                setBusy(null);
              });
          }}
        >
          {K.create}
        </button>
      )}
      {key && (
        <>
          <h4 className="survey-keys__step">{K.backupHeading}</h4>
          <p className="survey-keys__text">{K.backupBody}</p>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => {
              downloadText(
                backupText(surveyId, draft.title, key.key, new Date().toISOString()),
                backupFileName(surveyId),
                'application/json',
              );
              setDownloaded(true);
            }}
          >
            {K.download}
          </button>
        </>
      )}
      {key && downloaded && (
        <>
          <h4 className="survey-keys__step">{K.checkHeading}</h4>
          <p className="survey-keys__text">{K.checkBody}</p>
          {verified ? (
            <p className="survey-keys__ok">
              <Icon name="check" />
              {K.verified}
            </p>
          ) : (
            <>
              <label htmlFor={fileId} className="button button--secondary survey-keys__file">
                {K.choose}
              </label>
              <input
                id={fileId}
                type="file"
                accept=".json,application/json"
                className="visually-hidden"
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0];
                  e.currentTarget.value = '';
                  if (!file) return;
                  setBusy(K.checking);
                  setCheckError(null);
                  void file
                    .text()
                    .then((text) => verifyBackup(text, pass, key.key))
                    .then(() => {
                      setVerified(true);
                    })
                    .catch((err: unknown) => {
                      const reason = err instanceof BackupError ? err.reason : 'notBackup';
                      setCheckError(
                        reason === 'otherSurvey'
                          ? K.otherSurvey
                          : reason === 'passphrase'
                            ? K.passphraseWrong
                            : K.notBackup,
                      );
                    })
                    .finally(() => {
                      setBusy(null);
                    });
                }}
              />
            </>
          )}
          {checkError && (
            <p className="field__error" role="alert">
              <Icon name="warning" />
              {checkError}
            </p>
          )}
        </>
      )}
      <p role="status" className="survey-keys__busy">
        {busy ?? ''}
      </p>
      <div className="survey-setup__actions">
        {onCancel && (
          <button type="button" className="button button--text" onClick={onCancel}>
            {S.cancel}
          </button>
        )}
        <button
          type="button"
          className="button button--primary"
          disabled={!verified}
          onClick={() => {
            if (!ready || !key) {
              onBlocked();
              return;
            }
            const created = createSurvey(
              draft,
              project,
              key.key,
              new Date().toISOString(),
              surveyId,
            );
            setUnlockedKey(created.id, key.privateKey);
            onCreated(created);
          }}
        >
          {K.finish}
        </button>
      </div>
    </section>
  );
}
