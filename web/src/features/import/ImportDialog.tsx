// Dialog „Board importieren“ (docs/features/import.md, Konzept §3.1): Quelle → Verbinden → Boards wählen → Fortschritt
// → Bericht. Wird erst beim Öffnen nachgeladen (entry.tsx). Das Miro-Token lebt nur im Feld und in der einen Anfrage.
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { IMPORT_POLL_MS, type ImportJob, type ImportRemoteBoard, type ImportSources } from '../../../../shared/import';
import { ApiError } from '../../api';
import { boardHref, navigate } from '../../router';
import { Modal } from '../../ui/Modal';
import { IconChevron, IconSearch } from '../../ui/icons';
import { relativeTime } from '../../ui/time';
import { importApi } from './api';
import {
  appendBoards,
  BRAND_NOTE,
  entryText,
  IMPORT_MAX_BOARDS_PER_REQUEST,
  importedList,
  importErrorText,
  isActive,
  jobsHeading,
  mergeJobs,
  MIRO_APPS_URL,
  modifiedLabel,
  oauthErrorText,
  progressOf,
  progressText,
  RECONNECT_CODES,
  reportSummary,
  statusChip,
  toggleSelection,
} from './model';
import './import.css';

/** Womit der Dialog startet (Knopf, Rückkehr von Miro, laufende Importe). */
export type DialogStart =
  | { step: 'source' }
  | { step: 'connect'; error?: string; oauthError?: boolean }
  | { step: 'boards'; conn: string }
  | { step: 'jobs'; jobs: ImportJob[] };

type Step =
  | { kind: 'source' }
  | { kind: 'connect'; error?: string }
  | { kind: 'boards'; conn: string }
  | { kind: 'jobs'; jobs: ImportJob[]; conn?: string };

function initialStep(s: DialogStart): Step {
  switch (s.step) {
    case 'connect':
      return { kind: 'connect', error: s.error && (s.oauthError ? oauthErrorText(s.error) : s.error) };
    case 'boards':
      return { kind: 'boards', conn: s.conn };
    case 'jobs':
      return { kind: 'jobs', jobs: s.jobs };
    default:
      return { kind: 'source' };
  }
}

export function ImportDialog({
  sources,
  start,
  onSources,
  onImported,
  onClose,
}: {
  sources: ImportSources;
  start: DialogStart;
  onSources: (s: ImportSources) => void;
  onImported: () => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>(() => initialStep(start));
  const miro = sources.miro;

  /** „Aus Miro“: gespeicherte Verbindung → gleich zur Auswahl, sonst verbinden. */
  const chooseMiro = () => setStep(miro.oauth && miro.connected ? { kind: 'boards', conn: 'oauth' } : { kind: 'connect' });
  /** Verbindung abgelaufen/abgelehnt → zurück zum Verbinden, mit Grund. */
  const reconnect = (error: string) => {
    if (miro.connected) onSources({ ...sources, miro: { ...miro, connected: false } });
    setStep({ kind: 'connect', error });
  };

  return (
    <Modal title="Board importieren" onClose={onClose} labelledBy="import-title">
      <div className="import-dialog" data-step={step.kind} data-testid="import-dialog">
        {step.kind !== 'source' && <Steps at={step.kind === 'connect' ? 0 : step.kind === 'boards' ? 1 : 2} />}
        {step.kind === 'source' && (
          <SourceStep
            onMiro={chooseMiro}
            onShow={(j) => setStep({ kind: 'jobs', jobs: [j] })}
            onClose={onClose}
          />
        )}
        {step.kind === 'connect' && (
          <ConnectStep
            sources={sources}
            error={step.error}
            onConn={(conn) => setStep({ kind: 'boards', conn })}
            onBack={() => setStep({ kind: 'source' })}
          />
        )}
        {step.kind === 'boards' && (
          <BoardsStep
            conn={step.conn}
            onBack={() => setStep({ kind: 'source' })}
            onReconnect={reconnect}
            onDisconnected={() => {
              onSources({ ...sources, miro: { ...miro, connected: false } });
              setStep({ kind: 'connect' });
            }}
            onOtherToken={() => setStep({ kind: 'connect' })}
            onStarted={(jobs) => setStep({ kind: 'jobs', jobs, conn: step.conn })}
          />
        )}
        {step.kind === 'jobs' && (
          <JobsStep
            jobs={step.jobs}
            onJobs={(jobs) => setStep((s) => (s.kind === 'jobs' ? { ...s, jobs } : s))}
            onImported={onImported}
            onMore={() => (step.conn ? setStep({ kind: 'boards', conn: step.conn }) : chooseMiro())}
            onClose={onClose}
          />
        )}
        <p className="import-brand">{BRAND_NOTE}</p>
      </div>
    </Modal>
  );
}

/** Kleine Schrittanzeige: Verbinden · Boards wählen · Übernehmen. */
function Steps({ at }: { at: number }) {
  const names = ['Verbinden', 'Boards wählen', 'Übernehmen'];
  return (
    <ol className="import-steps" aria-label="Schritte">
      {names.map((n, i) => (
        <li key={n} className={i === at ? 'is-now' : i < at ? 'is-done' : undefined} aria-current={i === at ? 'step' : undefined}>
          <span className="import-steps__n" aria-hidden="true">
            {i + 1}
          </span>
          <span className="import-steps__t">{n}</span>
        </li>
      ))}
    </ol>
  );
}

/** Fokus beim Schrittwechsel auf das erste sinnvolle Element (Tastatur, Bildschirmleser). */
function useStepFocus() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current?.querySelector<HTMLElement>('h3');
    el?.focus({ preventScroll: true });
  }, []);
  return ref;
}

function Alert({ children }: { children: ReactNode }) {
  return (
    <div className="alert import-alert" role="alert">
      <span>{children}</span>
    </div>
  );
}

// ---- 0. Quelle + letzte Importe -------------------------------------------------------------------------------

function SourceStep({ onMiro, onShow, onClose }: { onMiro: () => void; onShow: (j: ImportJob) => void; onClose: () => void }) {
  const ref = useStepFocus();
  const [recent, setRecent] = useState<ImportJob[] | null>(null);
  useEffect(() => {
    let live = true;
    importApi
      .jobs()
      .then((j) => live && setRecent(j))
      .catch(() => live && setRecent([]));
    return () => {
      live = false;
    };
  }, []);
  return (
    <div className="import-step" ref={ref}>
      <p className="import-lead">Hol dir Boards aus einem anderen Whiteboard. Das Original bleibt, wie es ist.</p>
      <h3 className="import-h">Woher?</h3>
      <ul className="import-sources">
        <li>
          <button className="import-source" onClick={onMiro} data-autofocus data-testid="import-source-miro">
            <span className="import-source__text">
              <b>Aus Miro</b>
              <small>Boards mit Notizen, Formen, Texten, Verbindern, Rahmen und Bildern übernehmen</small>
            </span>
            <IconChevron size={22} className="import-source__go" />
          </button>
        </li>
      </ul>
      {recent && recent.length > 0 && (
        <section className="import-recent" aria-labelledby="import-recent-h">
          <h3 className="import-h" id="import-recent-h">
            Letzte Importe
          </h3>
          <ul>
            {recent.map((j) => {
              const chip = statusChip(j);
              return (
                <li key={j.id}>
                  <button className="import-recent__row" onClick={() => onShow(j)}>
                    <span className="import-recent__name">{j.sourceName}</span>
                    <span className="import-recent__when">{relativeTime(j.finishedAt ?? j.createdAt)}</span>
                    <span className={`import-chip import-chip--${chip.tone}`}>{chip.text}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <div className="modal-actions">
        <button className="btn btn--ghost btn--sm" onClick={onClose}>
          Schließen
        </button>
      </div>
    </div>
  );
}

// ---- 1. Verbinden ---------------------------------------------------------------------------------------------

function ConnectStep({ sources, error, onConn, onBack }: { sources: ImportSources; error?: string; onConn: (conn: string) => void; onBack: () => void }) {
  const ref = useStepFocus();
  const { oauth, token: tokenAllowed } = sources.miro;
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState<'oauth' | 'token' | null>(null);
  const [err, setErr] = useState<string | null>(error ?? null);
  const tokenId = useId();
  const noteId = useId();

  const connectOauth = async () => {
    setBusy('oauth');
    setErr(null);
    try {
      const url = await importApi.oauthStart();
      window.location.assign(url);
    } catch (e) {
      setErr(importErrorText(e));
      setBusy(null);
    }
  };
  const submitToken = async (e: FormEvent) => {
    e.preventDefault();
    const t = token.trim();
    if (!t) return setErr('Bitte füge zuerst das Token aus Miro ein.');
    setBusy('token');
    setErr(null);
    try {
      const r = await importApi.token(t);
      setToken('');
      onConn(r.conn);
    } catch (e2) {
      setErr(importErrorText(e2));
      setBusy(null);
    }
  };

  return (
    <div className="import-step" ref={ref}>
      <h3 className="import-h" tabIndex={-1}>
        Zugang zu Miro
      </h3>
      {err && <Alert>{err}</Alert>}
      {oauth && (
        <div className="import-oauth">
          <p className="import-lead">Du meldest dich bei Miro an und erlaubst Stachel, deine Boards zu lesen. In Miro ändert sich nichts.</p>
          <button className="btn btn--primary import-oauth__btn" onClick={connectOauth} disabled={busy !== null} data-autofocus data-testid="import-oauth">
            {busy === 'oauth' ? 'Öffnet Miro …' : 'Mit Miro verbinden'}
          </button>
        </div>
      )}
      {oauth && tokenAllowed && (
        <div className="import-or" role="separator">
          <span>oder</span>
        </div>
      )}
      {tokenAllowed && (
        <form className="import-token" onSubmit={submitToken} autoComplete="off">
          <div className="field">
            <label htmlFor={tokenId}>Zugriffstoken einfügen</label>
            <input
              id={tokenId}
              className="input"
              type="password"
              name="miro-access-token"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Token aus Miro"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              aria-describedby={noteId}
              data-autofocus={oauth ? undefined : true}
              data-lpignore="true"
              data-1p-ignore
            />
          </div>
          <p className="import-note" id={noteId}>
            Das Token bleibt nur kurz auf dem Server und wird nicht gespeichert. Danach kannst du die App in Miro wieder löschen.
          </p>
          <details className="import-howto">
            <summary>So bekommst du ein Token</summary>
            <ol>
              <li>
                Öffne in Miro dein Profil → Einstellungen → „Your apps“ (
                <a href={MIRO_APPS_URL} target="_blank" rel="noopener noreferrer">
                  miro.com/app/settings/user-profile/apps
                </a>
                ).
              </li>
              <li>Klick auf „Create new app“ und gib ihr einen Namen, zum Beispiel „Stachel-Import“.</li>
              <li>Setz bei den Berechtigungen nur den Haken bei „boards:read“.</li>
              <li>Klick auf „Install app and get OAuth token“.</li>
              <li>Wähl das Team, in dem deine Boards liegen.</li>
              <li>Kopier das Token und füg es oben ein.</li>
            </ol>
          </details>
          <div className="modal-actions">
            <button type="button" className="btn btn--ghost btn--sm" onClick={onBack}>
              Zurück
            </button>
            <button type="submit" className="btn btn--primary btn--sm" disabled={busy !== null} data-testid="import-token-submit">
              {busy === 'token' ? 'Prüft …' : 'Weiter'}
            </button>
          </div>
        </form>
      )}
      {!tokenAllowed && (
        <div className="modal-actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={onBack}>
            Zurück
          </button>
        </div>
      )}
    </div>
  );
}

// ---- 2. Boards wählen -----------------------------------------------------------------------------------------

const SEARCH_DELAY_MS = 300;

function BoardsStep({
  conn,
  onBack,
  onReconnect,
  onDisconnected,
  onOtherToken,
  onStarted,
}: {
  conn: string;
  onBack: () => void;
  onReconnect: (error: string) => void;
  onDisconnected: () => void;
  onOtherToken: () => void;
  onStarted: (jobs: ImportJob[]) => void;
}) {
  const ref = useStepFocus();
  const [query, setQuery] = useState('');
  const [boards, setBoards] = useState<ImportRemoteBoard[] | null>(null);
  const [next, setNext] = useState<number | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [keepColors, setKeepColors] = useState(false);
  const [description, setDescription] = useState(true);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const searchId = useId();

  const fail = (e: unknown) => {
    if (e instanceof ApiError && RECONNECT_CODES.has(e.code)) onReconnect(importErrorText(e));
    else setError(importErrorText(e));
  };

  const load = (q: string, offset?: number) => {
    const my = ++seq.current;
    setLoading(true);
    setError(null);
    importApi
      .boards(conn, q, offset)
      .then((r) => {
        if (my !== seq.current) return;
        setBoards((list) => (offset === undefined || !list ? r.boards : appendBoards(list, r.boards)));
        setNext(r.next);
      })
      .catch((e) => my === seq.current && fail(e))
      .finally(() => my === seq.current && setLoading(false));
  };

  // erste Seite sofort, Suche verzögert (der Server sucht in Miro)
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      load('');
      return;
    }
    const t = setTimeout(() => load(query.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const disconnect = async () => {
    try {
      await importApi.disconnect();
      onDisconnected();
    } catch (e) {
      setError(importErrorText(e));
    }
  };

  const start = async () => {
    if (selected.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      onStarted(await importApi.start(conn, selected, { keepColors, description }));
    } catch (e) {
      fail(e);
      setBusy(false);
    }
  };

  const full = selected.length >= IMPORT_MAX_BOARDS_PER_REQUEST;
  const names = new Map((boards ?? []).map((b) => [b.id, b.name]));
  return (
    <div className="import-step" ref={ref}>
      <div className="import-conn">
        <span className="import-conn__dot" aria-hidden="true" />
        <span>{conn === 'oauth' ? 'Mit Miro verbunden' : 'Mit deinem Token verbunden'}</span>
        {conn === 'oauth' ? (
          <button className="import-link" onClick={disconnect} data-testid="import-disconnect">
            Verbindung zu Miro trennen
          </button>
        ) : (
          <button className="import-link" onClick={onOtherToken}>
            Anderes Token
          </button>
        )}
      </div>
      <h3 className="import-h" tabIndex={-1}>
        Welche Boards?
      </h3>
      <label className="import-search" htmlFor={searchId}>
        <IconSearch size={20} />
        <span className="sr-only">Boards in Miro suchen</span>
        <input
          id={searchId}
          type="search"
          placeholder="In Miro suchen"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          data-autofocus
        />
      </label>
      {error && <Alert>{error}</Alert>}
      <div className="import-list" aria-busy={loading || undefined}>
        {boards === null && loading && <p className="import-empty">Boards werden geladen …</p>}
        {boards && boards.length === 0 && !loading && (
          <p className="import-empty">{query.trim() ? `Kein Board in Miro passt zu „${query.trim()}“.` : 'In diesem Miro-Zugang gibt es keine Boards.'}</p>
        )}
        {boards && boards.length > 0 && (
          <ul aria-label="Boards in Miro">
            {boards.map((b) => {
              const on = selected.includes(b.id);
              return (
                <li key={b.id}>
                  <label className={`import-board${on ? ' is-on' : ''}${!on && full ? ' is-off' : ''}`}>
                    <input type="checkbox" checked={on} disabled={!on && full} onChange={() => setSelected((s) => toggleSelection(s, b.id))} />
                    <span className="import-board__text">
                      <span className="import-board__name">{b.name || 'Ohne Namen'}</span>
                      {b.modifiedAt && <small>{modifiedLabel(b.modifiedAt)}</small>}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        {next !== undefined && boards && (
          <button className="btn btn--ghost btn--sm import-more" onClick={() => load(query.trim(), next)} disabled={loading}>
            {loading ? 'Lädt …' : 'Mehr laden'}
          </button>
        )}
      </div>
      <p className="import-count" role="status">
        {selected.length === 0
          ? `Wähle bis zu ${IMPORT_MAX_BOARDS_PER_REQUEST} Boards.`
          : `${selected.length} ausgewählt${full ? ` – mehr als ${IMPORT_MAX_BOARDS_PER_REQUEST} gehen nicht auf einmal` : ''}`}
      </p>
      <fieldset className="import-options">
        <legend className="sr-only">Optionen</legend>
        <label>
          <input type="checkbox" checked={keepColors} onChange={(e) => setKeepColors(e.target.checked)} />
          <span>
            Originalfarben der Notizen behalten
            <small>Sonst bekommt jede Notiz die ähnlichste Stachel-Farbe.</small>
          </span>
        </label>
        <label>
          <input type="checkbox" checked={description} onChange={(e) => setDescription(e.target.checked)} />
          <span>
            Board-Beschreibung als Text
            <small>Steht dann oben links auf dem Board.</small>
          </span>
        </label>
      </fieldset>
      <div className="modal-actions">
        <button className="btn btn--ghost btn--sm" onClick={onBack}>
          Zurück
        </button>
        <button
          className="btn btn--primary btn--sm"
          onClick={start}
          disabled={busy || selected.length === 0}
          data-testid="import-start"
          title={selected.length ? selected.map((id) => names.get(id) ?? id).join(', ') : undefined}
        >
          {busy ? 'Startet …' : selected.length > 1 ? `${selected.length} Boards importieren` : 'Importieren'}
        </button>
      </div>
    </div>
  );
}

// ---- 3./4. Fortschritt und Bericht ----------------------------------------------------------------------------

function JobsStep({
  jobs,
  onJobs,
  onImported,
  onMore,
  onClose,
}: {
  jobs: ImportJob[];
  onJobs: (jobs: ImportJob[]) => void;
  onImported: () => void;
  onMore: () => void;
  onClose: () => void;
}) {
  const ref = useStepFocus();
  const [error, setError] = useState<string | null>(null);
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  const active = jobs.some(isActive);

  useEffect(() => {
    if (!active) return;
    let live = true;
    const poll = async () => {
      const before = jobsRef.current;
      try {
        const list = await importApi.jobs();
        // nicht in der Liste (z. B. älter als 7 Tage oder gerade erst angelegt): einzeln fragen
        const missing = before.filter((j) => isActive(j) && !list.some((x) => x.id === j.id));
        const single = await Promise.all(missing.map((j) => importApi.job(j.id).catch(() => j)));
        if (!live) return;
        const merged = mergeJobs(before, [...list, ...single]);
        if (merged.some((j) => j.status === 'done' && before.find((b) => b.id === j.id)?.status !== 'done')) onImported();
        setError(null);
        onJobs(merged);
      } catch (e) {
        if (live) setError(importErrorText(e));
      }
    };
    const t = setInterval(() => void poll(), IMPORT_POLL_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const cancel = async (j: ImportJob) => {
    try {
      await importApi.cancel(j.id);
      onJobs(jobsRef.current.map((x) => (x.id === j.id ? { ...x, status: 'canceled' } : x)));
    } catch (e) {
      setError(importErrorText(e));
    }
  };

  return (
    <div className="import-step" ref={ref}>
      <h3 className="import-h" tabIndex={-1}>
        {jobsHeading(jobs)}
      </h3>
      {active && <p className="import-lead">Du kannst den Dialog schließen – der Import läuft im Hintergrund weiter.</p>}
      {error && <Alert>{error}</Alert>}
      <ul className="import-jobs">
        {jobs.map((j) => (
          <JobCard key={j.id} job={j} single={jobs.length === 1} onCancel={() => void cancel(j)} />
        ))}
      </ul>
      <div className="modal-actions">
        {!active && (
          <button className="btn btn--ghost btn--sm" onClick={onMore}>
            Weitere importieren
          </button>
        )}
        <button className={`btn btn--sm ${active ? 'btn--primary' : 'btn--ghost'}`} onClick={onClose} data-autofocus={active || undefined}>
          {active ? 'Im Hintergrund weiter' : 'Schließen'}
        </button>
      </div>
    </div>
  );
}

function JobCard({ job, single, onCancel }: { job: ImportJob; single: boolean; onCancel: () => void }) {
  const p = progressOf(job);
  const running = isActive(job);
  const chip = statusChip(job);
  return (
    <li className={`import-job import-job--${job.status}`} data-testid="import-job">
      <div className="import-job__head">
        <span className="import-job__name">{job.sourceName || 'Board aus Miro'}</span>
        {!running && <span className={`import-chip import-chip--${chip.tone}`}>{chip.text}</span>}
      </div>
      {running && (
        <>
          <div
            className={`import-bar${p === null ? ' is-wait' : ''}`}
            role="progressbar"
            aria-label={`Fortschritt ${job.sourceName}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={p === null ? undefined : Math.round(p * 100)}
            aria-valuetext={progressText(job)}
          >
            <span style={p === null ? undefined : { width: `${Math.max(3, p * 100)}%` }} />
          </div>
          <div className="import-job__line">
            <span data-testid="import-phase">{progressText(job)}</span>
            <button className="import-link" onClick={onCancel}>
              Abbrechen
            </button>
          </div>
        </>
      )}
      {job.status === 'failed' && <p className="import-job__error">{job.error || 'Der Import ist fehlgeschlagen. Versuch es noch einmal.'}</p>}
      {job.status === 'canceled' && <p className="import-job__muted">Abgebrochen – es wurde kein Board angelegt.</p>}
      {job.status === 'done' && (
        <>
          {job.report && (
            <details className="import-report" open={single}>
              <summary>{reportSummary(job.report)}</summary>
              <Report job={job} />
            </details>
          )}
          {job.boardId && (
            <div className="import-job__open">
              <button className="btn btn--primary btn--sm" onClick={() => navigate(boardHref(job.boardId!))} data-testid="import-open-board">
                Board öffnen
              </button>
            </div>
          )}
        </>
      )}
    </li>
  );
}

function Report({ job }: { job: ImportJob }) {
  const r = job.report!;
  const got = importedList(r);
  return (
    <div className="import-report__body" data-testid="import-report">
      <h4>Übernommen</h4>
      {got.length ? (
        <ul className="import-counts">
          {got.map((g) => (
            <li key={g.type}>{g.label}</li>
          ))}
        </ul>
      ) : (
        <p className="import-job__muted">Nichts – das Board war leer.</p>
      )}
      {r.adjusted?.length > 0 && (
        <>
          <h4>Angepasst</h4>
          <ul className="import-entries">
            {r.adjusted.map((e) => (
              <li key={e.code}>{entryText(e)}</li>
            ))}
          </ul>
        </>
      )}
      {r.skipped?.length > 0 && (
        <>
          <h4>Nicht übernommen</h4>
          <ul className="import-entries import-entries--skip">
            {r.skipped.map((e) => (
              <li key={e.code}>{entryText(e)}</li>
            ))}
          </ul>
        </>
      )}
      {r.notes?.length > 0 && (
        <>
          <h4>Gut zu wissen</h4>
          <ul className="import-entries import-entries--note">
            {r.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
