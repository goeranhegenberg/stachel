// Eintrag „Board importieren“ auf der Board-Übersicht: nur sichtbar, wenn die Instanz den Import anbietet. Erkennt die
// Rückkehr von Miro (`?import=miro[&error=…]`) und behält laufende Importe im Blick, auch wenn der Dialog zu ist.
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { IMPORT_POLL_MS, type ImportJob, type ImportSources } from '../../../../shared/import';
import { appHref } from '../../router';
import { importApi, importOffered } from './api';
import { isActive, parseImportReturn } from './model';
import type { DialogStart } from './ImportDialog';
import './entry.css';

const ImportDialog = lazy(() => import('./ImportDialog').then((m) => ({ default: m.ImportDialog })));

/** Pfeil in eine Ablage (eigenes Symbol, kein Fremd-Logo). */
export const IconImport = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3.5v11" />
    <path d="m7.5 10 4.5 4.5 4.5-4.5" />
    <path d="M4 15.5v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </svg>
);

export function ImportEntry({ onImported }: { onImported?: () => void }) {
  const [sources, setSources] = useState<ImportSources | null>(null);
  const [start, setStart] = useState<DialogStart | null>(null);
  // laufende Importe, während der Dialog zu ist (Knopf zeigt „läuft“, danach Liste neu laden)
  const [running, setRunning] = useState<ImportJob[]>([]);
  const runningRef = useRef(running);
  runningRef.current = running;
  const onImportedRef = useRef(onImported);
  onImportedRef.current = onImported;

  const refreshRunning = useCallback(() => {
    importApi
      .jobs()
      .then((jobs) => {
        // ein Import ist inzwischen fertig → Board-Liste neu laden
        if (runningRef.current.some((b) => jobs.some((j) => j.id === b.id && j.status === 'done'))) onImportedRef.current?.();
        setRunning(jobs.filter(isActive));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let live = true;
    // Rückkehr von der Miro-Freigabeseite: Parameter sofort aus der Adresse nehmen (Neuladen öffnet nicht erneut)
    const back = parseImportReturn(location.search);
    if (back.open) {
      history.replaceState(history.state, '', appHref(back.rest));
      setStart(back.error ? { step: 'connect', error: back.error, oauthError: true } : { step: 'boards', conn: 'oauth' });
    }
    importApi
      .sources()
      .then((s) => {
        if (!live) return;
        setSources(s);
        if (importOffered(s)) refreshRunning();
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [refreshRunning]);

  const active = running.some(isActive);
  useEffect(() => {
    if (!active || start) return;
    const t = setInterval(refreshRunning, IMPORT_POLL_MS);
    return () => clearInterval(t);
  }, [active, start, refreshRunning]);

  if (!importOffered(sources)) return null;
  return (
    <>
      <button
        className="btn btn--ghost import-entry"
        data-testid="import-open"
        onClick={() => setStart(active ? { step: 'jobs', jobs: running } : { step: 'source' })}
      >
        <IconImport /> Board importieren
        {active && (
          <span className="import-entry__run" title="Ein Import läuft im Hintergrund">
            läuft
          </span>
        )}
      </button>
      {start && sources && (
        <Suspense fallback={null}>
          <ImportDialog
            sources={sources}
            start={start}
            onSources={setSources}
            onImported={() => onImportedRef.current?.()}
            onClose={() => {
              setStart(null);
              refreshRunning();
            }}
          />
        </Suspense>
      )}
    </>
  );
}
