import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { ConfirmDialog } from '../ui/components/Dialog';
import { missingFeatures } from '../survey/crypto';
import {
  PackageMismatchError,
  parseRespondHash,
  readLink,
  readPackage,
  type Personal,
  type RespondRoute,
  type SurveyPayload,
} from '../survey/payload';
import { encryptResponse, type Answer, type ResponseBody } from '../survey/response';
import { fileTransport, type SubmitResult } from '../survey/transport';
import { respondCopy as C } from './copy';
import {
  clearProgress,
  emptyProgress,
  loadProgress,
  progressKey,
  saveProgress,
  type Progress,
  type Step,
} from './progress';
import { answerLabel, NOT_APPLICABLE, Scale, scaleOptions } from './Scale';
import { useWide } from './useWide';

type Loaded = { payload: SurveyPayload; personal: Personal; packageText?: string };

type State =
  | { kind: 'loading' }
  | { kind: 'unsupported' }
  | { kind: 'invalid' }
  | { kind: 'package'; route: Extract<RespondRoute, { kind: 'package' }>; error: string | null }
  | { kind: 'ready'; survey: Loaded };

// A package link can resume without the file: the package's text is saved with
// the answers. Looked up by the key the answers would have.
function savedPackage(route: Extract<RespondRoute, { kind: 'package' }>): string | null {
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key?.startsWith(`graticule.respond.${route.surveyId}.`)) continue;
      if (!key.endsWith(`.${route.personal.token}`)) continue;
      const p = loadProgress(key);
      if (p?.packageText) return p.packageText;
    }
  } catch {
    // Storage unavailable.
  }
  return null;
}

export function RespondApp() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    const run = { live: true };
    void (async () => {
      if (missingFeatures().length > 0) {
        setState({ kind: 'unsupported' });
        return;
      }
      const route = parseRespondHash(window.location.hash);
      if (!route || route.kind === 'invalid') {
        setState({ kind: 'invalid' });
        return;
      }
      if (route.kind === 'link') {
        try {
          const read = await readLink(route.encoded);
          if (run.live) setState({ kind: 'ready', survey: read });
        } catch {
          if (run.live) setState({ kind: 'invalid' });
        }
        return;
      }
      const text = savedPackage(route);
      if (text) {
        try {
          const payload = await readPackage(text, route);
          if (run.live)
            setState({
              kind: 'ready',
              survey: { payload, personal: route.personal, packageText: text },
            });
          return;
        } catch {
          // Fall through to choosing the file again.
        }
      }
      if (run.live) setState({ kind: 'package', route, error: null });
    })();
    return () => {
      run.live = false;
    };
  }, []);

  if (state.kind === 'loading')
    return (
      <Shell title={null}>
        <p role="status">{C.loading}</p>
      </Shell>
    );
  if (state.kind === 'unsupported')
    return <Message title={C.unsupported.title} body={C.unsupported.body} />;
  if (state.kind === 'invalid') return <Message title={C.invalid.title} body={C.invalid.body} />;
  if (state.kind === 'package')
    return (
      <ChoosePackage
        error={state.error}
        onFile={async (file) => {
          try {
            const text = await file.text();
            const payload = await readPackage(text, state.route);
            setState({
              kind: 'ready',
              survey: { payload, personal: state.route.personal, packageText: text },
            });
          } catch (e) {
            setState({
              ...state,
              error: e instanceof PackageMismatchError ? C.pkg.mismatch : C.pkg.notSurvey,
            });
          }
        }}
      />
    );
  return <Survey loaded={state.survey} />;
}

function Shell({
  title,
  children,
  footer,
}: {
  title: string | null;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="respond">
      <header className="respond__header">
        <p className="respond__brand">Graticule</p>
        {title && <p className="respond__survey">{title}</p>}
      </header>
      <main className="respond__main">{children}</main>
      {footer && <footer className="respond__footer">{footer}</footer>}
    </div>
  );
}

function useFocusHeading(dep: unknown) {
  const ref = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  useEffect(() => {
    // Moving to a new screen puts focus on its heading, so screen readers
    // announce it and keyboard users start at the top.
    if (first.current) {
      first.current = false;
      return;
    }
    ref.current?.focus();
  }, [dep]);
  return ref;
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <Shell title={null}>
      <h1 className="respond__title">{title}</h1>
      <p className="respond__text">{body}</p>
    </Shell>
  );
}

function ChoosePackage({
  error,
  onFile,
}: {
  error: string | null;
  onFile: (f: File) => Promise<void>;
}) {
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  return (
    <Shell title={null}>
      <h1 className="respond__title">{C.pkg.title}</h1>
      <p className="respond__text">{C.pkg.body}</p>
      <label htmlFor={inputId} className="button button--primary respond__file">
        {C.pkg.choose}
      </label>
      <input
        id={inputId}
        type="file"
        className="visually-hidden"
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (!file) return;
          setBusy(true);
          void onFile(file).finally(() => {
            setBusy(false);
          });
        }}
      />
      <p role="status" className="respond__status">
        {busy ? C.pkg.reading : ''}
      </p>
      {error && (
        <p role="alert" className="respond__error">
          {error}
        </p>
      )}
      <h2 className="respond__subheading">{C.pkg.howTo}</h2>
      <ul className="respond__list">
        <li>{C.pkg.iphone}</li>
        <li>{C.pkg.android}</li>
        <li>{C.pkg.computer}</li>
      </ul>
    </Shell>
  );
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function Survey({ loaded }: { loaded: Loaded }) {
  const { payload, personal } = loaded;
  const key = progressKey(payload.surveyId, payload.version, personal.token);
  const [progress, setProgressState] = useState<Progress>(() => {
    const saved = loadProgress(key);
    return (
      saved ?? {
        ...emptyProgress(),
        ...(loaded.packageText ? { packageText: loaded.packageText } : {}),
      }
    );
  });
  const [resumed] = useState(
    () => loadProgress(key) !== null && loadProgress(key)?.step !== 'welcome',
  );
  const [notice, setNotice] = useState<string | null>(resumed ? C.resumed : null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);

  const update = useCallback(
    (fn: (p: Progress) => Progress) => {
      setProgressState((p) => {
        const next = fn(p);
        saveProgress(key, next);
        return next;
      });
    },
    [key],
  );
  const go = (step: Step) => {
    setNotice(null);
    update((p) => ({ ...p, step }));
  };

  const me = payload.roster[personal.position]?.name ?? '';
  const nominate = payload.entry === 'nominate';
  const steps: Step[] = [
    'welcome',
    'consent',
    'identity',
    ...(nominate ? (['nominate'] as const) : []),
    'rate',
    'review',
  ];
  const totalSteps = steps.length + 1; // the final "send back" screen
  const stepIndex = result
    ? totalSteps
    : steps.indexOf(progress.step === 'notMe' ? 'identity' : progress.step) + 1;

  const toRate = useMemo(() => {
    const everyone = payload.roster.map((_, i) => i).filter((i) => i !== personal.position);
    if (!nominate) return everyone;
    // Required colleagues first, then those selected, each in roster order (D103).
    const required = new Set(payload.required);
    const chosen = new Set(progress.nominated ?? []);
    return [
      ...everyone.filter((i) => required.has(i)),
      ...everyone.filter((i) => chosen.has(i) && !required.has(i)),
    ];
  }, [payload.roster, payload.required, personal.position, nominate, progress.nominated]);

  const setAnswer = (layer: string, position: number, value: Answer) => {
    update((p) => ({
      ...p,
      answers: {
        ...p.answers,
        [layer]: { ...(p.answers[layer] ?? {}), [String(position)]: value },
      },
    }));
  };

  const clearAll = () => {
    clearProgress(key);
    setProgressState({
      ...emptyProgress(),
      ...(loaded.packageText ? { packageText: loaded.packageText } : {}),
    });
    setResult(null);
    setNotice(C.clear.done);
  };

  const footer = (
    <>
      <p className="respond__saved">
        {result || progress.step === 'welcome' || progress.step === 'consent' ? '' : C.saved}
      </p>
      <button
        type="button"
        className="button button--text respond__clear"
        onClick={() => {
          setConfirmClear(true);
        }}
      >
        {C.clear.button}
      </button>
      <ConfirmDialog
        open={confirmClear}
        title={C.clear.title}
        body={C.clear.body}
        confirm={C.clear.confirm}
        cancel={C.clear.cancel}
        onCancel={() => {
          setConfirmClear(false);
        }}
        onConfirm={() => {
          setConfirmClear(false);
          clearAll();
        }}
      />
    </>
  );

  const screen = result ? 'done' : progress.step;
  const heading = useFocusHeading(
    `${screen}-${String(progress.person)}-${String(progress.question)}`,
  );

  let body: ReactNode;
  if (result) {
    body = (
      <Done
        heading={heading}
        payload={payload}
        result={result}
        onReturned={() => {
          // The response has left this page: the answers are no longer needed here (D94).
          clearProgress(key);
        }}
      />
    );
  } else if (progress.step === 'welcome') {
    body = (
      <>
        <h1 ref={heading} tabIndex={-1} className="respond__title">
          {payload.title}
        </h1>
        <Paragraphs text={payload.texts.introduction} />
        <p className="respond__facts">
          {C.welcome.time(payload.estimateMinutes)}
          {payload.deadline ? ` ${C.welcome.deadline(formatDate(payload.deadline))}` : ''}
        </p>
        <h2 className="respond__subheading">{C.welcome.whoHeading}</h2>
        <p className="respond__text">{C.welcome.confidential}</p>
        <Paragraphs text={payload.texts.confidentiality} />
        <h2 className="respond__subheading">{C.welcome.howHeading}</h2>
        <p className="respond__text">{C.welcome.how}</p>
        <div className="respond__actions">
          <button
            type="button"
            className="button button--primary"
            onClick={() => {
              go('consent');
            }}
          >
            {C.welcome.continue}
          </button>
        </div>
      </>
    );
  } else if (progress.step === 'consent') {
    body = <Consent heading={heading} progress={progress} update={update} go={go} />;
  } else if (progress.step === 'identity') {
    body = (
      <>
        <h1 ref={heading} tabIndex={-1} className="respond__title">
          {C.identity.title}
        </h1>
        <p className="respond__text respond__text--large">{C.identity.body(me)}</p>
        <div className="respond__actions respond__actions--stack">
          <button
            type="button"
            className="button button--primary"
            onClick={() => {
              go(nominate ? 'nominate' : 'rate');
            }}
          >
            {C.identity.yes(me)}
          </button>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => {
              go('notMe');
            }}
          >
            {C.identity.no}
          </button>
        </div>
      </>
    );
  } else if (progress.step === 'notMe') {
    body = (
      <>
        <h1 ref={heading} tabIndex={-1} className="respond__title">
          {C.identity.notMeTitle}
        </h1>
        <p className="respond__text">{C.identity.notMeBody}</p>
        <div className="respond__actions">
          <button
            type="button"
            className="button button--text"
            onClick={() => {
              go('identity');
            }}
          >
            {C.identity.notMeBack}
          </button>
        </div>
      </>
    );
  } else if (progress.step === 'nominate') {
    body = (
      <Nominate
        heading={heading}
        payload={payload}
        self={personal.position}
        progress={progress}
        update={update}
        go={go}
      />
    );
  } else if (progress.step === 'rate') {
    body = (
      <Rate
        heading={heading}
        payload={payload}
        toRate={toRate}
        progress={progress}
        update={update}
        setAnswer={setAnswer}
        go={go}
        back={nominate ? 'nominate' : 'identity'}
      />
    );
  } else {
    body = (
      <Review
        heading={heading}
        payload={payload}
        toRate={toRate}
        progress={progress}
        nominate={nominate}
        update={update}
        go={go}
        onEncrypted={setResult}
        personal={personal}
      />
    );
  }

  return (
    <Shell title={payload.title} footer={footer}>
      <p className="respond__step">{C.step(stepIndex, totalSteps)}</p>
      <p role="status" className="respond__notice">
        {notice ?? ''}
      </p>
      {body}
    </Shell>
  );
}

function Paragraphs({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p, i) => (
          <p key={i} className="respond__text">
            {p}
          </p>
        ))}
    </>
  );
}

type Heading = RefObject<HTMLHeadingElement | null>;

function Consent({
  heading,
  progress,
  update,
  go,
}: {
  heading: Heading;
  progress: Progress;
  update: (fn: (p: Progress) => Progress) => void;
  go: (s: Step) => void;
}) {
  const [error, setError] = useState(false);
  const errorId = useId();
  return (
    <>
      <h1 ref={heading} tabIndex={-1} className="respond__title">
        {C.consent.title}
      </h1>
      <p className="respond__text">{C.consent.body}</p>
      <label className="respond__check">
        <input
          type="checkbox"
          checked={progress.consent}
          aria-invalid={error}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => {
            const consent = e.currentTarget.checked;
            setError(false);
            update((p) => ({ ...p, consent }));
          }}
        />
        <span>{C.consent.agree}</span>
      </label>
      {error && (
        <p id={errorId} role="alert" className="respond__error">
          {C.consent.required}
        </p>
      )}
      <div className="respond__actions">
        <button
          type="button"
          className="button button--text"
          onClick={() => {
            go('welcome');
          }}
        >
          {C.consent.back}
        </button>
        <button
          type="button"
          className="button button--primary"
          onClick={() => {
            if (progress.consent) go('identity');
            else setError(true);
          }}
        >
          {C.consent.start}
        </button>
      </div>
    </>
  );
}

function Nominate({
  heading,
  payload,
  self,
  progress,
  update,
  go,
}: {
  heading: Heading;
  payload: SurveyPayload;
  self: number;
  progress: Progress;
  update: (fn: (p: Progress) => Progress) => void;
  go: (s: Step) => void;
}) {
  const [query, setQuery] = useState('');
  const [warned, setWarned] = useState(false);
  const searchId = useId();
  const chosen = new Set(progress.nominated ?? []);
  const required = new Set(payload.required.filter((i) => i !== self));
  const q = query.trim().toLowerCase();
  const people = payload.roster
    .map((r, i) => ({ ...r, i }))
    .filter((r) => r.i !== self && !required.has(r.i))
    .filter((r) => q === '' || r.name.toLowerCase().includes(q));
  const detail = (attributes: (string | null)[]) =>
    attributes.some((a) => a) ? (
      <span className="respond__person-detail">
        {attributes.filter((a): a is string => !!a).join(', ')}
      </span>
    ) : null;
  const zero = payload.layers.filter(
    (l) => l.unselected === 'zero' && l.scale_type !== 'categorical',
  );
  const blank = payload.layers.filter((l) => !zero.includes(l));
  const toggle = (i: number) => {
    update((p) => {
      const set = new Set(p.nominated ?? []);
      if (set.has(i)) set.delete(i);
      else set.add(i);
      return { ...p, nominated: [...set].sort((a, b) => a - b) };
    });
  };
  return (
    <>
      <h1 ref={heading} tabIndex={-1} className="respond__title">
        {C.nominate.title}
      </h1>
      <p className="respond__text respond__text--large">{payload.nominationQuestion}</p>
      <p className="respond__text">{C.nominate.askedAbout}</p>
      <div className="respond__rule">
        <p>{C.nominate.unselectedIntro}</p>
        <ul className="respond__list">
          {zero.map((l) => (
            <li key={l.key}>{C.nominate.unselectedValue(l.label, answerLabel(l, l.min))}</li>
          ))}
          {blank.map((l) => (
            <li key={l.key}>{C.nominate.unselectedValue(l.label, C.rate.notApplicable)}</li>
          ))}
        </ul>
      </div>
      {required.size > 0 && (
        <section className="respond__required" aria-labelledby="required-heading">
          <h2 id="required-heading" className="respond__subheading">
            {C.nominate.requiredHeading}
          </h2>
          <p className="respond__text">{C.nominate.requiredBody}</p>
          <ul className="respond__list">
            {[...required].map((i) => {
              const r = payload.roster[i];
              return r ? (
                <li key={i}>
                  {r.name}
                  {detail(r.attributes)}
                </li>
              ) : null;
            })}
          </ul>
          <h2 className="respond__subheading">{C.nominate.othersHeading}</h2>
        </section>
      )}
      <label htmlFor={searchId} className="respond__label">
        {C.nominate.search}
      </label>
      <input
        id={searchId}
        type="search"
        className="respond__input"
        value={query}
        autoComplete="off"
        onChange={(e) => {
          setQuery(e.currentTarget.value);
        }}
      />
      <p className="respond__count num" role="status">
        {C.nominate.selectedCount(chosen.size)}
      </p>
      <fieldset className="respond__roster">
        <legend className="visually-hidden">{C.nominate.listLabel}</legend>
        {people.length === 0 && <p className="respond__text">{C.nominate.noMatch(query.trim())}</p>}
        <ul className="respond__people">
          {people.map((r) => (
            <li key={r.i}>
              <label className="respond__person">
                <input
                  type="checkbox"
                  checked={chosen.has(r.i)}
                  onChange={() => {
                    toggle(r.i);
                  }}
                />
                <span className="respond__person-name">{r.name}</span>
                {detail(r.attributes)}
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      {warned && chosen.size === 0 && required.size === 0 && (
        <p role="alert" className="respond__error">
          {C.nominate.noneSelected}
        </p>
      )}
      <div className="respond__actions respond__actions--sticky">
        <button
          type="button"
          className="button button--text"
          onClick={() => {
            go('identity');
          }}
        >
          {C.nominate.back}
        </button>
        <button
          type="button"
          className="button button--primary"
          onClick={() => {
            if (chosen.size === 0 && required.size === 0 && !warned) {
              setWarned(true);
              return;
            }
            update((p) => ({ ...p, nominated: p.nominated ?? [], person: 0, question: 0 }));
            go('rate');
          }}
        >
          {C.nominate.continue}
        </button>
      </div>
    </>
  );
}

/** Moves focus to the first unanswered question on screen after a blocked "Next". */
function focusFirstMissing() {
  requestAnimationFrame(() => {
    const target = document.querySelector<HTMLInputElement>('[data-missing] input');
    target?.focus();
  });
}

function Rate({
  heading,
  payload,
  toRate,
  progress,
  update,
  setAnswer,
  go,
  back,
}: {
  heading: Heading;
  payload: SurveyPayload;
  toRate: number[];
  progress: Progress;
  update: (fn: (p: Progress) => Progress) => void;
  setAnswer: (layer: string, position: number, value: Answer) => void;
  go: (s: Step) => void;
  back: Step;
}) {
  const wide = useWide();
  // Set when the respondent tries to move on with questions unanswered; the
  // key names the screen, so the message does not follow them to the next one.
  const [blocked, setBlocked] = useState<string | null>(null);
  const value = (layer: string, i: number): Answer => progress.answers[layer]?.[String(i)] ?? null;

  if (toRate.length === 0) {
    return (
      <>
        <h1 ref={heading} tabIndex={-1} className="respond__title">
          {C.review.title}
        </h1>
        <p className="respond__text">{C.rate.noneToRate}</p>
        <div className="respond__actions">
          <button
            type="button"
            className="button button--text"
            onClick={() => {
              go(back);
            }}
          >
            {C.rate.back}
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => {
              go('review');
            }}
          >
            {C.rate.review}
          </button>
        </div>
      </>
    );
  }

  if (wide) {
    const qi = Math.min(progress.question, payload.layers.length - 1);
    const layer = payload.layers[qi];
    if (!layer) return null;
    const options = scaleOptions(layer);
    const last = qi === payload.layers.length - 1;
    const screen = `q${String(qi)}`;
    const missing = toRate.filter((i) => value(layer.key, i) === null);
    const showMissing = blocked === screen && missing.length > 0;
    return (
      <>
        <p className="respond__position num">{C.rate.question(qi + 1, payload.layers.length)}</p>
        <h1 ref={heading} tabIndex={-1} className="respond__title respond__question">
          {layer.question_wording}
        </h1>
        <p className="respond__hint">
          {layer.offer_not_applicable ? C.rate.everyQuestionNa : C.rate.everyQuestion}
        </p>
        <table className="rate-table">
          <caption className="visually-hidden">{layer.question_wording}</caption>
          <thead>
            <tr>
              <th scope="col" className="rate-table__name">
                {C.rate.colleague}
              </th>
              {options.map((o) => (
                <th
                  key={String(o.value)}
                  scope="col"
                  className={o.na ? 'rate-table__point rate-table__point--na' : 'rate-table__point'}
                >
                  <span className="rate-table__mark num">{o.mark}</span>
                  {o.label && <span className="rate-table__label">{o.label}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {toRate.map((i) => {
              const person = payload.roster[i];
              const rowMissing = showMissing && value(layer.key, i) === null;
              return (
                <tr
                  key={i}
                  className={rowMissing ? 'rate-table__row--missing' : undefined}
                  data-missing={rowMissing ? '' : undefined}
                >
                  <th scope="row" className="rate-table__name">
                    {person?.name}
                    {person?.attributes.some((a) => a) && (
                      <span className="respond__person-detail">
                        {person.attributes.filter((a): a is string => !!a).join(', ')}
                      </span>
                    )}
                    {rowMissing && (
                      <span className="rate-table__missing">{C.rate.notAnswered}</span>
                    )}
                  </th>
                  {options.map((o) => (
                    <td
                      key={String(o.value)}
                      className={
                        o.na ? 'rate-table__cell rate-table__cell--na' : 'rate-table__cell'
                      }
                    >
                      <label className="rate-table__hit">
                        <input
                          type="radio"
                          name={`${layer.key}-${String(i)}`}
                          aria-label={`${person?.name ?? ''}: ${C.rate.option(o.mark, o.label)}`}
                          checked={value(layer.key, i) === o.value}
                          onChange={() => {
                            setAnswer(layer.key, i, o.value);
                          }}
                        />
                      </label>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        {showMissing && (
          <p role="alert" className="respond__error">
            {C.rate.questionMissing(missing.length)}
          </p>
        )}
        <div className="respond__actions respond__actions--sticky">
          <button
            type="button"
            className="button button--text"
            onClick={() => {
              setBlocked(null);
              if (qi === 0) go(back);
              else update((p) => ({ ...p, question: qi - 1 }));
            }}
          >
            {qi === 0 ? C.rate.back : C.rate.previousQuestion}
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => {
              if (missing.length > 0) {
                setBlocked(screen);
                focusFirstMissing();
                return;
              }
              setBlocked(null);
              if (last) go('review');
              else update((p) => ({ ...p, question: qi + 1 }));
            }}
          >
            {last ? C.rate.review : C.rate.nextQuestion}
          </button>
        </div>
      </>
    );
  }

  const pi = Math.min(progress.person, toRate.length - 1);
  const position = toRate[pi] ?? 0;
  const person = payload.roster[position];
  const last = pi === toRate.length - 1;
  const screen = `p${String(position)}`;
  const missing = payload.layers.filter((l) => value(l.key, position) === null);
  const showMissing = blocked === screen && missing.length > 0;
  return (
    <>
      <p className="respond__position num">{C.rate.person(pi + 1, toRate.length)}</p>
      <h1 ref={heading} tabIndex={-1} className="respond__title">
        {person?.name}
      </h1>
      {person?.attributes.some((a) => a) && (
        <p className="respond__person-detail">
          {person.attributes.filter((a): a is string => !!a).join(', ')}
        </p>
      )}
      <p className="respond__hint">
        {payload.layers.some((l) => l.offer_not_applicable)
          ? C.rate.everyQuestionNa
          : C.rate.everyQuestion}
      </p>
      {payload.layers.map((layer) => (
        <Scale
          key={`${layer.key}-${String(position)}`}
          layer={layer}
          name={`${layer.key}-${String(position)}`}
          legend={layer.question_wording}
          value={value(layer.key, position)}
          missing={showMissing && value(layer.key, position) === null}
          missingText={C.rate.notAnswered}
          onChange={(v) => {
            setAnswer(layer.key, position, v);
          }}
        />
      ))}
      {showMissing && (
        <p role="alert" className="respond__error">
          {C.rate.personMissing(missing.length, person?.name ?? '')}
        </p>
      )}
      <div className="respond__actions respond__actions--sticky">
        <button
          type="button"
          className="button button--text"
          onClick={() => {
            setBlocked(null);
            if (pi === 0) go(back);
            else update((p) => ({ ...p, person: pi - 1 }));
          }}
        >
          {pi === 0 ? C.rate.back : C.rate.previousPerson}
        </button>
        <button
          type="button"
          className="button button--primary"
          onClick={() => {
            if (missing.length > 0) {
              setBlocked(screen);
              focusFirstMissing();
              return;
            }
            setBlocked(null);
            if (last) go('review');
            else update((p) => ({ ...p, person: pi + 1 }));
          }}
        >
          {last ? C.rate.review : C.rate.nextPerson}
        </button>
      </div>
    </>
  );
}

function Review({
  heading,
  payload,
  toRate,
  progress,
  nominate,
  update,
  go,
  onEncrypted,
  personal,
}: {
  heading: Heading;
  payload: SurveyPayload;
  toRate: number[];
  progress: Progress;
  nominate: boolean;
  update: (fn: (p: Progress) => Progress) => void;
  go: (s: Step) => void;
  onEncrypted: (r: SubmitResult) => void;
  personal: Personal;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const value = (layer: string, i: number): Answer => progress.answers[layer]?.[String(i)] ?? null;
  const unanswered = toRate.reduce(
    (n, i) => n + payload.layers.filter((l) => value(l.key, i) === null).length,
    0,
  );
  const notSelected = payload.roster.length - 1 - toRate.length;

  async function encrypt() {
    setBusy(true);
    setFailed(false);
    try {
      const answers: Record<string, Answer[]> = {};
      const notApplicable: Record<string, number[]> = {};
      const rated = new Set(toRate);
      for (const l of payload.layers) {
        answers[l.key] = payload.roster.map((_, i) => {
          const v = rated.has(i) ? value(l.key, i) : null;
          return v === NOT_APPLICABLE ? null : v;
        });
        notApplicable[l.key] = toRate.filter((i) => value(l.key, i) === NOT_APPLICABLE);
      }
      const body: ResponseBody = {
        survey_id: payload.surveyId,
        version: payload.version,
        position: personal.position,
        token: personal.token,
        submitted_at: new Date().toISOString(),
        nominated: nominate ? [...(progress.nominated ?? [])] : null,
        answers,
        not_applicable: notApplicable,
      };
      const envelope = await encryptResponse(body, payload.publicKey, payload.keyFingerprint);
      onEncrypted(await fileTransport.submit(envelope));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 ref={heading} tabIndex={-1} className="respond__title">
        {C.review.title}
      </h1>
      <p className="respond__text">{C.review.body}</p>
      <p className={unanswered > 0 ? 'respond__error num' : 'respond__text num'}>
        {unanswered > 0 ? C.review.unanswered(unanswered) : C.review.allAnswered}
      </p>
      <ul className="review">
        {toRate.map((i, index) => {
          const person = payload.roster[i];
          return (
            <li key={i} className="review__person">
              <h2 className="review__name">{person?.name}</h2>
              <dl className="review__answers">
                {payload.layers.map((l) => (
                  <div key={l.key} className="review__row">
                    <dt>{l.label}</dt>
                    <dd className={value(l.key, i) === null ? 'review__missing' : undefined}>
                      {answerLabel(l, value(l.key, i))}
                    </dd>
                  </div>
                ))}
              </dl>
              <button
                type="button"
                className="button button--text review__change"
                onClick={() => {
                  update((p) => ({ ...p, person: index, question: 0 }));
                  go('rate');
                }}
              >
                {C.review.change(person?.name ?? '')}
              </button>
            </li>
          );
        })}
      </ul>
      {nominate && (
        <div className="review__not-selected">
          <p className="respond__text num">{C.review.notSelected(notSelected)}</p>
          <button
            type="button"
            className="button button--text"
            onClick={() => {
              go('nominate');
            }}
          >
            {C.review.changeSelection}
          </button>
        </div>
      )}
      <p role="status" className="respond__status">
        {busy ? C.review.encrypting : ''}
      </p>
      {failed && (
        <p role="alert" className="respond__error">
          {C.review.failed}
        </p>
      )}
      <div className="respond__actions respond__actions--sticky">
        <button
          type="button"
          className="button button--text"
          onClick={() => {
            go('rate');
          }}
        >
          {C.review.back}
        </button>
        <button
          type="button"
          className="button button--primary"
          disabled={busy || unanswered > 0}
          aria-describedby={unanswered > 0 ? 'review-blocked' : undefined}
          onClick={() => {
            void encrypt();
          }}
        >
          {C.review.encrypt}
        </button>
      </div>
      {unanswered > 0 && (
        <p id="review-blocked" className="respond__hint">
          {C.review.blocked}
        </p>
      )}
    </>
  );
}

function Done({
  heading,
  payload,
  result,
  onReturned,
}: {
  heading: Heading;
  payload: SurveyPayload;
  result: SubmitResult;
  onReturned: () => void;
}) {
  const wide = useWide();
  const [status, setStatus] = useState<string | null>(null);
  const [cleared, setCleared] = useState(false);
  const textId = useId();
  const textRef = useRef<HTMLTextAreaElement>(null);
  if (result.kind !== 'manual') return null;

  const returned = (message: string) => {
    setStatus(message);
    if (!cleared) {
      onReturned();
      setCleared(true);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.text);
      returned(C.done.copied);
    } catch {
      textRef.current?.select();
      setStatus(C.done.copyFailed);
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([result.text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = result.fileName;
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    returned(C.done.downloaded(result.fileName));
  };
  const copyButton = (
    <button
      type="button"
      className={wide ? 'button button--secondary' : 'button button--primary'}
      onClick={() => {
        void copy();
      }}
    >
      {C.done.copy}
    </button>
  );
  const downloadButton = (
    <button
      type="button"
      className={wide ? 'button button--primary' : 'button button--secondary'}
      onClick={download}
    >
      {C.done.download}
    </button>
  );
  return (
    <>
      <h1 ref={heading} tabIndex={-1} className="respond__title">
        {C.done.title}
      </h1>
      <p className="respond__text">{C.done.encrypted}</p>
      <ol className="respond__steps">
        <li>
          <p>{C.done.stepOne}</p>
          <div className="respond__actions respond__actions--stack">
            {wide ? (
              <>
                {downloadButton}
                {copyButton}
              </>
            ) : (
              <>
                {copyButton}
                {downloadButton}
              </>
            )}
          </div>
          <p role="status" className="respond__status">
            {status ?? ''}
            {cleared ? ` ${C.done.cleared}` : ''}
          </p>
        </li>
        <li>
          <p>{C.done.stepTwo}</p>
          <Paragraphs text={payload.texts.return_instructions} />
        </li>
      </ol>
      <h2 className="respond__subheading">{C.done.receiptHeading}</h2>
      <p className="respond__receipt num">{result.receipt}</p>
      <p className="respond__text">{C.done.receiptHelp}</p>
      <p className="respond__text">{C.done.latestCounts}</p>
      <label htmlFor={textId} className="respond__label">
        {C.done.textLabel}
      </label>
      <textarea
        id={textId}
        ref={textRef}
        className="respond__block"
        readOnly
        value={result.text}
        rows={6}
      />
    </>
  );
}
