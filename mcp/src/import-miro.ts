// Werkzeug import_miro_board: Board aus Miro über die Import-Endpunkte des Servers übernehmen
// (docs/features/import.md §2, Typen shared/import.ts). Der MCP-Server liest selbst nichts bei Miro: Er reicht das
// persönliche Zugriffstoken einmal an `POST /api/import/miro/token` weiter (der Server hält es nur im Speicher) und
// arbeitet danach mit der Verbindungs-ID `conn`. Das Token wird nie geloggt, gespeichert oder zurückgegeben.
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ImportJob, ImportRemoteBoard, ImportRemoteBoards, ImportReport, ImportTokenResult } from '../../shared/import';
import { IMPORT_POLL_MS } from '../../shared/import';
import { StachelError, type StachelApi } from './stachel/api';
import { ToolError } from './kinds/common';

/** so lange wartet das Werkzeug höchstens auf das Ende eines Imports (danach: Stand melden, Job läuft weiter) */
export const IMPORT_WAIT_MS = 5 * 60_000;
/** Board-Liste ohne `board`: höchstens so viele Seiten zu 50 */
const LIST_PAGES = 4;
const BOARD_ID_RE = /^[A-Za-z0-9_=+-]{4,80}$/;
const JOB_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

export interface ImportArgs {
  token?: string;
  board?: string;
  query?: string;
  keepColors?: boolean;
  description?: boolean;
  wait?: boolean;
  job?: string;
}

export interface ImportEnv {
  api: StachelApi;
  /** Adresse der Web-App für den Board-Link */
  webUrl: string;
  /** nach einem neuen Board die Board-Liste des Agenten neu laden */
  onBoardCreated?: () => void;
  pollMs?: number;
  maxWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Board-ID aus einer ID oder einem Board-Link (`https://miro.com/app/board/<id>/`, auch mit `?share_link_id=…` oder
 * URL-kodiertem `=`). Andere Hosts als miro.com lehnt es ab, damit niemand versehentlich eine fremde Adresse übergibt.
 */
export function parseMiroBoard(input: string): string {
  const s = input.trim();
  let id = s;
  if (/^https?:\/\//i.test(s) || /^(www\.)?miro\.com\//i.test(s)) {
    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    } catch {
      throw new ToolError(`„${s.slice(0, 120)}“ ist kein gültiger Board-Link. Erwartet: https://miro.com/app/board/<id>/ oder nur die Board-ID.`);
    }
    const host = url.hostname.toLowerCase();
    if (host !== 'miro.com' && !host.endsWith('.miro.com')) {
      throw new ToolError(`Der Link zeigt nicht auf miro.com (${host}). Erwartet: https://miro.com/app/board/<id>/ oder nur die Board-ID.`);
    }
    const m = /\/app\/board\/([^/?#]+)/.exec(url.pathname);
    if (!m) throw new ToolError('Im Link steht keine Board-ID. Erwartet: https://miro.com/app/board/<id>/ (Board in Miro öffnen und die Adresse kopieren).');
    id = m[1]!;
  }
  try {
    id = decodeURIComponent(id);
  } catch {
    // bleibt wie eingegeben
  }
  if (!BOARD_ID_RE.test(id)) throw new ToolError(`„${id.slice(0, 120)}“ ist keine gültige Miro-Board-ID (z. B. „uXjVO1a2b3c=“). Ohne board liefert das Werkzeug die Liste der Boards.`);
  return id;
}

function cleanToken(token: string | undefined): string {
  const t = (token ?? '').trim().replace(/^Bearer\s+/i, '');
  if (!t) throw new ToolError('Es fehlt das persönliche Miro-Zugriffstoken (token). Anleitung: In Miro eine eigene App anlegen, im Team installieren und das Zugriffstoken kopieren (Stachel → „Board importieren“ → „Aus Miro“ erklärt die Schritte).');
  if (t.length < 8 || t.length > 2048 || /\s/.test(t)) throw new ToolError('Das Miro-Zugriffstoken hat kein gültiges Format (ein Wort ohne Leerzeichen). Bitte das Token aus Miro vollständig kopieren.');
  return t;
}

/** Fehler der Import-Endpunkte mit Hinweis, wenn die Instanz den Import (noch) nicht kennt. */
function rethrow(e: unknown): never {
  if (e instanceof StachelError && e.status === 404 && (e.code === 'not_found' || e.code === 'http_404')) {
    throw new StachelError(404, 'import_unavailable', 'Diese Stachel-Instanz bietet den Import aus Miro nicht an (ältere Version oder vom Betreiber abgeschaltet).');
  }
  throw e;
}

const fmtBoard = (b: ImportRemoteBoard) => JSON.stringify(Object.fromEntries(Object.entries({ id: b.id, name: b.name, modifiedAt: b.modifiedAt, description: b.description?.slice(0, 120) }).filter(([, v]) => v !== undefined && v !== '')));

export function formatReport(r: ImportReport | undefined): string {
  if (!r) return '';
  const out: string[] = [];
  const imported = Object.entries(r.imported ?? {}).filter(([, n]) => n > 0);
  if (imported.length) out.push(`Übernommen: ${imported.map(([k, n]) => `${n} × ${k}`).join(', ')}`);
  if (r.adjusted?.length) out.push(`Angepasst:\n${r.adjusted.slice(0, 15).map((e) => `- ${e.text}${e.count > 1 ? ` (${e.count})` : ''}`).join('\n')}`);
  if (r.skipped?.length) out.push(`Nicht übernommen:\n${r.skipped.slice(0, 15).map((e) => `- ${e.text}${e.count > 1 ? ` (${e.count})` : ''}`).join('\n')}`);
  if (r.notes?.length) out.push(`Hinweise:\n${r.notes.slice(0, 10).map((n) => `- ${n}`).join('\n')}`);
  return out.join('\n');
}

const PHASE_DE: Record<string, string> = { queued: 'wartet', read: 'liest Objekte', images: 'lädt Bilder und Dokumente', build: 'legt das Board an', done: 'fertig' };

function jobResult(job: ImportJob, env: ImportEnv): CallToolResult {
  const report = formatReport(job.report);
  if (job.status === 'done') {
    env.onBoardCreated?.();
    const link = job.boardId ? `${env.webUrl.replace(/\/+$/, '')}/b/${encodeURIComponent(job.boardId)}` : undefined;
    const head = `Import fertig: neues Stachel-Board ${JSON.stringify(Object.fromEntries(Object.entries({ id: job.boardId, title: job.sourceName, link }).filter(([, v]) => v)))}`;
    return { content: [{ type: 'text', text: `${head}${report ? `\n${report}` : ''}\nWeiter z. B. mit get_board_overview (board = id).` }] };
  }
  if (job.status === 'failed') return { isError: true, content: [{ type: 'text', text: `Import von „${job.sourceName}“ fehlgeschlagen: ${job.error ?? 'unbekannter Fehler'}${report ? `\n${report}` : ''}` }] };
  if (job.status === 'canceled') return { isError: true, content: [{ type: 'text', text: `Import von „${job.sourceName}“ wurde abgebrochen. Es wurde kein Board angelegt.` }] };
  const pct = job.total > 0 ? ` (${job.done}/${job.total})` : '';
  return {
    content: [
      {
        type: 'text',
        text: `Import von „${job.sourceName}“ läuft noch: ${PHASE_DE[job.phase] ?? job.phase}${pct}. Job ${job.id}. Den Stand fragst du mit import_miro_board und job = "${job.id}" ab (ohne token); das Board erscheint erst am Ende.`,
      },
    ],
  };
}

async function waitFor(api: StachelApi, id: string, env: ImportEnv): Promise<ImportJob> {
  const sleep = env.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = Date.now() + (env.maxWaitMs ?? IMPORT_WAIT_MS);
  for (;;) {
    const { job } = await api.req<{ job: ImportJob }>('GET', `/api/import/jobs/${encodeURIComponent(id)}`);
    if (job.status === 'done' || job.status === 'failed' || job.status === 'canceled') return job;
    if (Date.now() >= deadline) return job;
    await sleep(env.pollMs ?? IMPORT_POLL_MS);
  }
}

export async function importMiroBoard(args: ImportArgs, env: ImportEnv): Promise<CallToolResult> {
  const { api } = env;
  // Stand eines laufenden Imports
  if (args.job) {
    if (!JOB_ID_RE.test(args.job)) throw new ToolError(`„${args.job.slice(0, 80)}“ ist keine Job-ID. Sie steht in der Antwort eines früheren Imports.`);
    const job = await (args.wait === false ? api.req<{ job: ImportJob }>('GET', `/api/import/jobs/${encodeURIComponent(args.job)}`).then((r) => r.job) : waitFor(api, args.job, env)).catch(rethrow);
    return jobResult(job, env);
  }

  const boardId = args.board ? parseMiroBoard(args.board) : undefined;
  const token = cleanToken(args.token);
  const { conn } = await api.req<ImportTokenResult>('POST', '/api/import/miro/token', { token }).catch(rethrow);

  if (!boardId) {
    const all: ImportRemoteBoard[] = [];
    let offset: number | undefined = 0;
    for (let page = 0; page < LIST_PAGES && offset !== undefined; page++) {
      const q = new URLSearchParams({ conn, offset: String(offset) });
      if (args.query) q.set('query', args.query);
      const r: ImportRemoteBoards = await api.req<ImportRemoteBoards>('GET', `/api/import/miro/boards?${q}`).catch(rethrow);
      all.push(...r.boards);
      offset = r.next;
    }
    if (!all.length) return { content: [{ type: 'text', text: args.query ? `Keine Miro-Boards mit „${args.query}“ gefunden, die dieses Token sehen darf.` : 'Das Token sieht keine Boards. In Miro muss die App in dem Team installiert sein, dessen Boards übernommen werden sollen.' }] };
    const more = offset !== undefined ? `\n… weitere vorhanden – mit query eingrenzen.` : '';
    return {
      content: [
        {
          type: 'text',
          text: `${all.length} Miro-Board(s), die das Token sehen darf. Frag die Person, welches übernommen werden soll, und rufe das Werkzeug dann mit board = id erneut auf (mit demselben token):\n${all.map(fmtBoard).join('\n')}${more}`,
        },
      ],
    };
  }

  const options = Object.fromEntries(Object.entries({ keepColors: args.keepColors, description: args.description }).filter(([, v]) => v !== undefined));
  const { jobs } = await api.req<{ jobs: ImportJob[] }>('POST', '/api/import/miro/jobs', { conn, boards: [boardId], options }).catch(rethrow);
  const job = jobs[0];
  if (!job) throw new StachelError(502, 'no_job', 'Stachel hat den Import angenommen, aber keinen Auftrag zurückgegeben. Bitte in Stachel unter „Board importieren“ nachsehen.');
  if (args.wait === false) return jobResult(job, env);
  return jobResult(await waitFor(api, job.id, env), env);
}

export function registerImportTool(server: McpServer, env: () => ImportEnv, wrap: <A>(fn: (a: A) => Promise<CallToolResult>) => (a: A) => Promise<CallToolResult>) {
  server.registerTool(
    'import_miro_board',
    {
      title: 'Board aus Miro importieren',
      description:
        'Importiert ein Board aus Miro über die Miro-REST-API (persönliches Zugriffstoken) als neues Stachel-Board. Ohne board: Liste der Miro-Boards, die das Token sehen darf (dann die Person fragen, welches). Mit board (ID oder Link https://miro.com/app/board/<id>/): Import starten und standardmäßig bis zu 5 Minuten auf das Ergebnis warten; Antwort mit id, Titel und Link des neuen Boards sowie einem Bericht (übernommen, angepasst, nicht übernommen). Läuft er länger, Stand mit job abfragen. Das Token wird nur an diese Stachel-Instanz weitergegeben und nirgends gespeichert.',
      inputSchema: {
        token: z.string().max(2048).optional().describe('persönliches Miro-Zugriffstoken der Person (Pflicht, außer beim Abfragen mit job)'),
        board: z.string().max(400).optional().describe('Miro-Board-ID oder Board-Link; weglassen = Board-Liste'),
        query: z.string().max(120).optional().describe('nur für die Board-Liste: Suchbegriff im Board-Namen'),
        keepColors: z.boolean().optional().describe('Notizfarben im Original übernehmen statt auf die nächste Stachel-Farbe (Standard false)'),
        description: z.boolean().optional().describe('Board-Beschreibung als Text oben links einfügen (Standard true)'),
        wait: z.boolean().optional().describe('auf das Ende warten, höchstens 5 Minuten (Standard true)'),
        job: z.string().max(80).optional().describe('Stand eines laufenden Imports abfragen (Job-ID aus einer früheren Antwort)'),
      },
      annotations: { openWorldHint: true },
    },
    wrap(async (a: ImportArgs) => importMiroBoard(a, env())),
  );
}
