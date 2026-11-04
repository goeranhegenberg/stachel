// Import-Aufträge (docs/features/import.md §3, §6): Warteschlange mit höchstens einem laufenden Import je Person und
// STACHEL_IMPORT_CONCURRENCY je Instanz, Tabelle `import_jobs` (Bericht für die Person, 7 Tage sichtbar, nach 30 Tagen
// gelöscht), Fortschritt im Speicher, Abbruch über AbortController, Tages- und Board-Grenzen. Der Miro-Zugang eines
// Auftrags liegt nur im Speicher: Nach einem Neustart sind offene Aufträge `failed` („Bitte erneut verbinden“).
// Logs nur mit Job-ID, Zahlen und Fehlerklasse – keine Inhalte, Tokens oder Adressen.
import crypto from 'node:crypto';
import type { ImportJob, ImportJobStatus, ImportOptions, ImportPhase, ImportReport, ImportReportEntry } from '../../../shared/import.js';
import { nowIso, type Db } from '../db.js';
import type { ImportConfig } from '../config.js';
import type { UploadLimits } from '../upload-limits.js';
import type { BoardEvents } from '../board-events.js';
import { AssetError, loadAsset, type DownloadOptions } from './assets.js';
import { buildBoard, removeFiles, storeFile, type StoredFile } from './build.js';
import { ImportAbortError, MiroApiError, MiroAuthError, MiroClient, type MiroAuth } from './miro/client.js';
import { fetchBoard, pool } from './miro/fetch-board.js';
import type { MapOptions, MappedBoard, MiroBoardData } from './miro/types.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS import_jobs (
  id TEXT PRIMARY KEY,
  user_key TEXT NOT NULL,
  source TEXT NOT NULL,            -- miro
  source_board TEXT NOT NULL,      -- Board-ID in der Quelle
  source_name TEXT NOT NULL,       -- Name in der Quelle (nach dem Lesen)
  board_id TEXT,                   -- angelegtes Stachel-Board
  status TEXT NOT NULL,            -- queued | running | done | failed | canceled
  phase TEXT NOT NULL,             -- queued | read | images | build | done
  done INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  options TEXT NOT NULL,           -- ImportOptions (JSON)
  report TEXT,                     -- ImportReport (JSON), ohne Tokens/Adressen
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS import_jobs_user ON import_jobs(user_key, created_at);
`;

const DAY = 24 * 3600_000;
/** eigene Aufträge so lange sichtbar */
export const JOB_VISIBLE_DAYS = 7;
/** danach gelöscht (Löschfrist) */
export const JOB_RETENTION_DAYS = 30;
const PARALLEL_DOWNLOADS = 4;

export const JOB_ERRORS = {
  restart: 'Der Import wurde durch einen Neustart des Servers unterbrochen. Bitte erneut verbinden und den Import noch einmal starten.',
  auth: 'Die Verbindung zu Miro ist abgelaufen oder wurde getrennt. Bitte verbinde Stachel erneut mit Miro und starte den Import noch einmal.',
  forbidden: 'Stachel darf dieses Board in Miro nicht lesen. Prüfe, ob dein Miro-Zugang das Board sehen darf, und versuche es noch einmal.',
  notFound: 'Dieses Board gibt es in Miro nicht (mehr). Prüfe in Miro, ob es gelöscht oder verschoben wurde.',
  unavailable: 'Miro ist gerade nicht erreichbar oder bremst die Anfragen. Bitte versuche es in ein paar Minuten noch einmal.',
  boardLimit: (max: number) => `Du hast schon ${max} Boards (auch im Papierkorb). Lösche alte Boards und leere den Papierkorb, dann starte den Import noch einmal.`,
  internal: 'Der Import ist fehlgeschlagen. Bitte versuche es noch einmal; klappt es wieder nicht, melde dich beim Betrieb dieser Instanz.',
} as const;

interface JobRow {
  id: string;
  user_key: string;
  source: string;
  source_board: string;
  source_name: string;
  board_id: string | null;
  status: ImportJobStatus;
  phase: ImportPhase;
  done: number;
  total: number;
  options: string;
  report: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface JobDeps {
  db: Db;
  imagesDir: string;
  cfg: ImportConfig;
  uploads: Pick<UploadLimits, 'fits' | 'boards' | 'limits'>;
  events?: BoardEvents;
  saveVersion?: (boardId: string, name: string, by: { key: string; name: string }) => Promise<unknown>;
  /** Abbildung Miro → Stachel (miro/map.ts) */
  mapBoard: (data: MiroBoardData, opts?: MapOptions) => MappedBoard;
  /** Datei-Download ohne Signal (Hosts, Größe; Tests: DNS) */
  download: Omit<DownloadOptions, 'signal'>;
  /** Client-Optionen (Tests: Uhr, Warten) */
  client?: { sleep?: (ms: number, signal?: AbortSignal) => Promise<void>; now?: () => number };
  log?: (msg: string) => void;
  now?: () => number;
}

interface Running {
  userKey: string;
  ac: AbortController;
  done: number;
  total: number;
  phase: ImportPhase;
  promise?: Promise<void>;
}

export type CreateResult = { ok: true; jobs: ImportJob[] } | { ok: false; status: number; error: string; message: string };

export class ImportJobs {
  private readonly queue: string[] = [];
  private readonly auths = new Map<string, { auth: MiroAuth; user: { key: string; name: string } }>();
  private readonly running = new Map<string, Running>();
  private readonly now: () => number;
  private closed = false;

  constructor(private readonly d: JobDeps) {
    d.db.exec(SCHEMA);
    this.now = d.now ?? Date.now;
    // Neustart: der Zugang zu Miro ist weg → offene Aufträge scheitern
    d.db
      .prepare("UPDATE import_jobs SET status = 'failed', error = ?, finished_at = ? WHERE status IN ('queued', 'running')")
      .run(JOB_ERRORS.restart, nowIso());
  }

  private row(id: string): JobRow | undefined {
    return this.d.db.prepare('SELECT * FROM import_jobs WHERE id = ?').get(id) as JobRow | undefined;
  }

  private toJob(r: JobRow): ImportJob {
    const live = this.running.get(r.id);
    let report: ImportReport | undefined;
    try {
      report = r.report ? (JSON.parse(r.report) as ImportReport) : undefined;
    } catch {
      report = undefined;
    }
    return {
      id: r.id,
      source: 'miro',
      sourceBoard: r.source_board,
      sourceName: r.source_name,
      status: r.status,
      phase: live?.phase ?? r.phase,
      done: live?.done ?? r.done,
      total: live?.total ?? r.total,
      ...(r.board_id ? { boardId: r.board_id } : {}),
      ...(r.error ? { error: r.error } : {}),
      ...(report ? { report } : {}),
      createdAt: r.created_at,
      ...(r.finished_at ? { finishedAt: r.finished_at } : {}),
    };
  }

  /** Aufträge der letzten 24 h (vor dem Start abgebrochene zählen nicht) */
  countToday(userKey: string): number {
    const cutoff = new Date(this.now() - DAY).toISOString();
    return Number(
      (
        this.d.db
          .prepare("SELECT COUNT(*) AS n FROM import_jobs WHERE user_key = ? AND created_at > ? AND NOT (status = 'canceled' AND started_at IS NULL)")
          .get(userKey, cutoff) as { n: number }
      ).n,
    );
  }

  /** offene Aufträge der Person (wartend oder laufend) */
  openCount(userKey: string): number {
    return Number((this.d.db.prepare("SELECT COUNT(*) AS n FROM import_jobs WHERE user_key = ? AND status IN ('queued', 'running')").get(userKey) as { n: number }).n);
  }

  /** Aufträge anlegen (Grenzen geprüft), dann Warteschlange anstoßen. */
  create(user: { key: string; name: string }, auth: MiroAuth, boards: string[], options: ImportOptions, nameOf: (board: string) => string = () => ''): CreateResult {
    const { cfg } = this.d;
    if (cfg.perDay && this.countToday(user.key) + boards.length > cfg.perDay) {
      return {
        ok: false,
        status: 429,
        error: 'import_limit',
        message: `Du kannst höchstens ${cfg.perDay} Boards am Tag importieren. Versuche es morgen noch einmal oder wähle weniger Boards.`,
      };
    }
    const max = this.d.uploads.limits.maxBoardsPerUser;
    if (max && this.d.uploads.boards(user.key) + this.openCount(user.key) + boards.length > max) {
      return { ok: false, status: 403, error: 'board_limit', message: JOB_ERRORS.boardLimit(max) };
    }
    const created = nowIso();
    const ins = this.d.db.prepare(
      "INSERT INTO import_jobs (id, user_key, source, source_board, source_name, status, phase, options, created_at) VALUES (?, ?, 'miro', ?, ?, 'queued', 'queued', ?, ?)",
    );
    const ids: string[] = [];
    for (const b of boards) {
      const id = `ij_${crypto.randomBytes(12).toString('base64url')}`;
      ins.run(id, user.key, b, nameOf(b).slice(0, 200), JSON.stringify(options), created);
      this.auths.set(id, { auth, user });
      this.queue.push(id);
      ids.push(id);
    }
    queueMicrotask(() => this.pump());
    return { ok: true, jobs: ids.map((id) => this.toJob(this.row(id)!)) };
  }

  list(userKey: string): ImportJob[] {
    const cutoff = new Date(this.now() - JOB_VISIBLE_DAYS * DAY).toISOString();
    const rows = this.d.db.prepare('SELECT * FROM import_jobs WHERE user_key = ? AND created_at > ? ORDER BY created_at DESC, rowid DESC').all(userKey, cutoff) as unknown as JobRow[];
    return rows.map((r) => this.toJob(r));
  }

  get(userKey: string, id: string): ImportJob | null {
    const r = typeof id === 'string' && id.length <= 64 ? this.row(id) : undefined;
    return r && r.user_key === userKey ? this.toJob(r) : null;
  }

  /** abbrechen; null = nicht gefunden */
  cancel(userKey: string, id: string): ImportJob | null {
    const r = typeof id === 'string' && id.length <= 64 ? this.row(id) : undefined;
    if (!r || r.user_key !== userKey) return null;
    if (r.status === 'queued') {
      this.finish(id, { status: 'canceled' });
      this.dropQueued(id);
    } else if (r.status === 'running') {
      this.running.get(id)?.ac.abort();
    }
    return this.toJob(this.row(id)!);
  }

  private dropQueued(id: string) {
    const i = this.queue.indexOf(id);
    if (i >= 0) this.queue.splice(i, 1);
    this.auths.delete(id);
  }

  /** Konto löschen: laufende abbrechen, Zeilen weg */
  async forgetUser(userKey: string): Promise<void> {
    for (const id of [...this.queue]) if (this.auths.get(id)?.user.key === userKey) this.dropQueued(id);
    const mine = [...this.running.entries()].filter(([, r]) => r.userKey === userKey);
    for (const [, r] of mine) r.ac.abort();
    await Promise.all(mine.map(([, r]) => r.promise?.catch(() => {})));
    this.d.db.prepare('DELETE FROM import_jobs WHERE user_key = ?').run(userKey);
  }

  /** Löschfrist 30 Tage */
  purge(now = this.now()): number {
    const cutoff = new Date(now - JOB_RETENTION_DAYS * DAY).toISOString();
    return Number(this.d.db.prepare("DELETE FROM import_jobs WHERE created_at < ? AND status NOT IN ('queued', 'running')").run(cutoff).changes);
  }

  /** Server beenden: alles abbrechen und warten */
  async close(): Promise<void> {
    this.closed = true;
    this.queue.length = 0;
    for (const r of this.running.values()) r.ac.abort();
    await Promise.all([...this.running.values()].map((r) => r.promise?.catch(() => {})));
  }

  /** Tests: bis nichts mehr läuft oder wartet */
  async idle(timeoutMs = 20_000): Promise<void> {
    const end = Date.now() + timeoutMs;
    while (this.running.size || this.queue.length) {
      if (Date.now() > end) throw new Error('Import läuft noch');
      await Promise.all([...this.running.values()].map((r) => r.promise?.catch(() => {})));
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  private pump() {
    if (this.closed) return;
    const busy = new Set([...this.running.values()].map((r) => r.userKey));
    for (let i = 0; i < this.queue.length && this.running.size < this.d.cfg.concurrency; ) {
      const id = this.queue[i]!;
      const a = this.auths.get(id);
      if (!a) {
        this.queue.splice(i, 1);
        continue;
      }
      if (busy.has(a.user.key)) {
        i++;
        continue;
      }
      this.queue.splice(i, 1);
      this.auths.delete(id);
      busy.add(a.user.key);
      const run: Running = { userKey: a.user.key, ac: new AbortController(), done: 0, total: 0, phase: 'read' };
      this.running.set(id, run);
      run.promise = this.run(id, a.user, a.auth, run).finally(() => {
        this.running.delete(id);
        this.pump();
      });
    }
  }

  private setPhase(id: string, run: Running, phase: ImportPhase, total = 0) {
    run.phase = phase;
    run.done = 0;
    run.total = total;
    this.d.db.prepare('UPDATE import_jobs SET phase = ?, done = 0, total = ? WHERE id = ?').run(phase, total, id);
  }

  private finish(id: string, p: { status: ImportJobStatus; error?: string; boardId?: string; report?: ImportReport; phase?: ImportPhase }) {
    this.d.db
      .prepare(
        "UPDATE import_jobs SET status = ?, phase = COALESCE(?, phase), done = CASE WHEN ? = 'done' THEN total ELSE done END, error = ?, board_id = COALESCE(?, board_id), report = COALESCE(?, report), finished_at = ? WHERE id = ?",
      )
      .run(p.status, p.phase ?? null, p.status, p.error ?? null, p.boardId ?? null, p.report ? JSON.stringify(p.report) : null, nowIso(), id);
  }

  private log(msg: string) {
    this.d.log?.(`import ${msg}`);
  }

  private async run(id: string, user: { key: string; name: string }, auth: MiroAuth, run: Running): Promise<void> {
    const { db, cfg } = this.d;
    const row = this.row(id)!;
    const signal = run.ac.signal;
    const started = this.now();
    const stored: string[] = [];
    let built = false;
    let options: ImportOptions = {};
    try {
      options = JSON.parse(row.options) as ImportOptions;
    } catch {
      options = {};
    }
    db.prepare("UPDATE import_jobs SET status = 'running', started_at = ? WHERE id = ?").run(nowIso(), id);
    try {
      // 1. lesen
      this.setPhase(id, run, 'read');
      const client = new MiroClient({
        base: cfg.apiBase,
        auth,
        signal,
        onWait: (reason, ms) => this.log(`${id}: Miro ${reason === 'credits' ? 'Credits knapp' : reason || 'nicht erreichbar'}, warte ${ms} ms`),
        ...(this.d.client ?? {}),
      });
      const data = await fetchBoard(client, row.source_board, {
        maxObjects: cfg.maxObjects,
        signal,
        onProgress: (done, total) => {
          run.done = done;
          run.total = total;
        },
      });
      db.prepare('UPDATE import_jobs SET source_name = ? WHERE id = ?').run(data.board.name.slice(0, 200), id);
      if (signal.aborted) throw new ImportAbortError();

      // 2. abbilden
      const mapped = this.d.mapBoard(data, {
        keepColors: options.keepColors === true,
        description: options.description !== false,
        maxObjects: cfg.maxObjects,
        maxImages: cfg.maxImages,
      });
      const report = withWarnings(mapped.report, data.warnings);

      // 3. Bilder und Dokumente
      const needs = mapped.assets.slice(0, cfg.maxImages);
      this.setPhase(id, run, 'images', needs.length);
      const files = new Map<string, StoredFile | null>();
      const failed = new Map<string, number>();
      let reserved = 0;
      let converted = 0;
      await pool(
        needs,
        PARALLEL_DOWNLOADS,
        async (need) => {
          try {
            const a = await loadAsset(client, need, { ...this.d.download, signal });
            if (!this.d.uploads.fits(user.key, reserved + a.buf.length).ok) throw new AssetError('quota');
            reserved += a.buf.length;
            const fid = await storeFile(this.d.imagesDir, a.buf);
            stored.push(fid);
            files.set(need.objectId, { id: fid, mime: a.mime, width: a.width, height: a.height, bytes: a.buf.length });
            if (a.converted) converted++;
          } catch (e) {
            if (e instanceof ImportAbortError || e instanceof MiroAuthError || signal.aborted) throw signal.aborted ? new ImportAbortError() : e;
            const reason = e instanceof AssetError ? e.reason : 'broken';
            files.set(need.objectId, null);
            const key = `${need.kind}:${reason === 'quota' ? 'quota' : reason === 'type' || reason === 'pixels' ? 'type' : 'failed'}`;
            failed.set(key, (failed.get(key) ?? 0) + 1);
          } finally {
            run.done++;
          }
        },
        signal,
      );
      // über der Bildgrenze: wie fehlgeschlagen (Platzhalter)
      for (const need of mapped.assets.slice(cfg.maxImages)) {
        files.set(need.objectId, null);
        failed.set(`${need.kind}:limit`, (failed.get(`${need.kind}:limit`) ?? 0) + 1);
      }
      applyAssetReport(report, failed, converted);
      if (signal.aborted) throw new ImportAbortError();

      // 4. bauen
      this.setPhase(id, run, 'build', 1);
      const max = this.d.uploads.limits.maxBoardsPerUser;
      if (max && this.d.uploads.boards(user.key) >= max) {
        await removeFiles(this.d.imagesDir, stored);
        this.finish(id, { status: 'failed', error: JOB_ERRORS.boardLimit(max), report });
        this.log(`${id}: fehlgeschlagen (board_limit)`);
        return;
      }
      const { boardId } = await buildBoard(
        { db, imagesDir: this.d.imagesDir, ...(this.d.events ? { events: this.d.events } : {}), ...(this.d.saveVersion ? { saveVersion: this.d.saveVersion } : {}) },
        user,
        { ...mapped, report },
        files,
      );
      built = true;
      this.finish(id, { status: 'done', phase: 'done', boardId, report });
      run.done = 1;
      const objects = Object.values(report.imported ?? {}).reduce((a, b) => a + b, 0);
      this.log(`${id}: fertig (${objects} Objekte, ${files.size} Dateien, ${this.now() - started} ms)`);
    } catch (e) {
      if (!built) await removeFiles(this.d.imagesDir, stored).catch(() => {});
      if (e instanceof ImportAbortError || signal.aborted) {
        this.finish(id, { status: 'canceled' });
        this.log(`${id}: abgebrochen`);
        return;
      }
      const error =
        e instanceof MiroAuthError
          ? JOB_ERRORS.auth
          : e instanceof MiroApiError
            ? e.status === 403
              ? JOB_ERRORS.forbidden
              : e.status === 404
                ? JOB_ERRORS.notFound
                : e.status === 0 || e.status === 429 || e.status >= 500
                  ? JOB_ERRORS.unavailable
                  : JOB_ERRORS.internal
            : JOB_ERRORS.internal;
      this.finish(id, { status: 'failed', error });
      const cls = e instanceof Error ? e.name : 'Error';
      this.log(`${id}: fehlgeschlagen (${cls}${e instanceof MiroApiError ? ` ${e.status}` : ''})`);
    }
  }
}

/** Hinweise aus dem Lesen in den Bericht (nur, was map.ts nicht schon übernommen hat; feste Hinweise setzt map.ts). */
export function withWarnings(r: ImportReport, warnings: ImportReportEntry[]): ImportReport {
  const report: ImportReport = { imported: { ...(r.imported ?? {}) }, adjusted: [...(r.adjusted ?? [])], skipped: [...(r.skipped ?? [])], notes: [...(r.notes ?? [])] };
  const known = new Set([...report.adjusted, ...report.skipped].map((e) => e.code));
  for (const w of warnings) if (!known.has(w.code)) report.skipped.push({ ...w });
  return report;
}

const ASSET_TEXTS: Record<string, string> = {
  'image:quota': 'Bilder nicht übernommen: Dein Speicherplatz ist voll (graues Rechteck an ihrer Stelle).',
  'image:type': 'Bilder in einem nicht unterstützten Format oder mit zu vielen Pixeln (graues Rechteck an ihrer Stelle).',
  'image:failed': 'Bilder ließen sich nicht laden (graues Rechteck an ihrer Stelle).',
  'image:limit': 'Bilder über der Grenze je Board (graues Rechteck an ihrer Stelle).',
  'document:quota': 'Dokumente nicht übernommen: Dein Speicherplatz ist voll.',
  'document:type': 'Dateien, die keine PDF sind, wurden nicht übernommen.',
  'document:failed': 'Dokumente ließen sich nicht laden.',
  'document:limit': 'Dokumente über der Grenze je Board.',
};

/** fehlgeschlagene Dateien: aus `imported` heraus, Einträge in `skipped`; umgewandelte Bilder in `adjusted`. */
export function applyAssetReport(report: ImportReport, failed: ReadonlyMap<string, number>, converted: number) {
  for (const [key, n] of failed) {
    const [kind] = key.split(':') as ['image' | 'document'];
    if (report.imported[kind]) report.imported[kind] = Math.max(0, report.imported[kind]! - n);
    report.skipped.push({ code: key.replace(':', '_'), text: ASSET_TEXTS[key] ?? 'Dateien nicht übernommen.', count: n });
  }
  if (converted) report.adjusted.push({ code: 'image_converted', text: 'Bilder in PNG umgewandelt (SVG, HEIC, TIFF …).', count: converted });
}
