// Moderation einer Stachel-Instanz über die Admin-API (server/src/moderation.ts, Anleitung docs/ops/moderation.md):
// Meldungen ansehen und entscheiden (mit Begründung nach DSA Art. 17, Benachrichtigung beider Seiten), Boards sperren
// (nur ansehen / ausgeblendet) und löschen, Konten sperren. Läuft überall mit Node ≥ 22 (nur fetch, keine Abhängigkeiten):
//
//   server/node_modules/.bin/tsx tools/admin.mts --url https://stachel.intsode.com reports
//
// Token: STACHEL_ADMIN_TOKEN (Umgebung) oder --token-file <datei>; Adresse: STACHEL_ADMIN_URL oder --url.
import fs from 'node:fs';

const HELP = `Stachel-Moderation (Admin-API)

Aufruf: tsx tools/admin.mts [--url <instanz>] [--token-file <datei>] <befehl> …

Meldungen
  reports [--all|--closed]              offene (bzw. alle/erledigte) Meldungen
  report <R-…>                          eine Meldung mit Beleg und Board-Stand
  decide <R-…> <entscheidung> --statement "<Begründung>" [--ground "<Grundlage>"]
         [--affected <schlüssel>] [--no-apply] [--no-notify]
      entscheidung: no_action | content_removed | board_readonly | board_hidden | board_deleted | account_locked
      Führt die Maßnahme aus (außer --no-apply) und schreibt meldender und betroffener Person (außer --no-notify).
  notify <R-…>                          Entscheidung erneut an beide Seiten schicken
  reopen <R-…>                          Meldung wieder öffnen

Boards
  board <id>                            Titel, Besitzer:in, Sperre, Personen
  lock-board <id> --reason "<Grund>" [--hidden]    nur ansehen (Standard) bzw. für alle ausblenden
  unlock-board <id>
  delete-board <id> --yes               endgültig löschen (ohne Papierkorb)

Konten
  people <suche>                        Personen (Name/Schlüssel) finden
  lock-account <schlüssel> --reason "<Grund>"      sperrt Anmeldung, beendet Sitzungen, löscht KI-Tokens
  unlock-account <schlüssel>
  locks                                 alle gesperrten Boards und Konten, Melde-Adresse
`;

interface Args {
  pos: string[];
  flags: Map<string, string | true>;
}

function parse(argv: string[]): Args {
  const pos: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) {
      pos.push(a);
      continue;
    }
    const [k, v] = a.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
    if (v !== undefined) flags.set(k, v);
    else if (['all', 'closed', 'hidden', 'yes', 'no-apply', 'no-notify', 'help', 'json'].includes(k)) flags.set(k, true);
    else flags.set(k, argv[++i] ?? '');
  }
  return { pos, flags };
}

const die = (msg: string): never => {
  console.error(msg);
  process.exit(1);
};

const { pos, flags } = parse(process.argv.slice(2));
const flag = (k: string) => {
  const v = flags.get(k);
  return typeof v === 'string' ? v : undefined;
};
if (!pos.length || flags.has('help')) {
  console.log(HELP);
  process.exit(pos.length ? 0 : 1);
}

const base = (flag('url') ?? process.env.STACHEL_ADMIN_URL ?? 'http://127.0.0.1:8095').replace(/\/+$/, '');
const tokenFile = flag('token-file');
const token = (tokenFile ? fs.readFileSync(tokenFile, 'utf8') : (process.env.STACHEL_ADMIN_TOKEN ?? '')).trim();
if (!token) die('Admin-Token fehlt: STACHEL_ADMIN_TOKEN setzen oder --token-file <datei> angeben (Wert wie in der .env der Instanz).');

async function api(method: string, path: string, body?: unknown): Promise<any> {
  let res: Response;
  try {
    res = await fetch(base + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'X-Stachel': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    return die(`${base} nicht erreichbar (${(e as Error).message}). Stimmt --url bzw. STACHEL_ADMIN_URL?`);
  }
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string };
  // allgemeines 404 des Servers (keine Route) = Admin-API aus
  if (res.status === 404 && data.message === 'Nicht gefunden.') {
    return die('Admin-API nicht gefunden: Ist STACHEL_ADMIN_TOKEN (mind. 32 Zeichen) in der .env der Instanz gesetzt und der Server neu gestartet?');
  }
  if (!res.ok) return die(`Fehler ${res.status}: ${data.message ?? data.error ?? 'unbekannt'}`);
  return data;
}

const enc = encodeURIComponent;
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short' }) : '–');
const need = (v: string | undefined, what: string) => v ?? die(`${what} fehlt. Hilfe: tsx tools/admin.mts --help`);
const reportId = (v: string | undefined) => {
  const id = need(v, 'Nummer der Meldung (R-…)').toUpperCase();
  return /^R-[A-Z0-9]{8}$/.test(id) ? id : die(`„${id}“ ist keine Meldungsnummer (R-XXXXXXXX).`);
};
const out = (data: unknown) => flags.has('json') && (console.log(JSON.stringify(data, null, 2)), true);

function printReport(r: any) {
  console.log(`${r.id}  ${r.status === 'open' ? 'OFFEN' : 'erledigt'}  ${when(r.createdAt)}  ${r.reasonLabel}`);
  console.log(`  Board:     „${r.board.title}“ (${r.board.id})${r.objectId ? `, Objekt ${r.objectId}` : ''}${r.commentId ? `, Kommentar ${r.commentId}${r.messageId ? `/${r.messageId}` : ''}` : ''}`);
  if (r.target) console.log(`  Betroffen: ${r.target.name} (${r.target.key})`);
  console.log(`  Gemeldet:  ${r.reporter.name} (${r.reporter.key})${r.reporter.email ? `, ${r.reporter.email}` : ', keine Mail-Adresse'}`);
  if (r.text) console.log(`  Text:      ${r.text}`);
}

async function main() {
  const [cmd, a1, a2] = pos;
  switch (cmd) {
    case 'reports': {
      const status = flags.has('all') ? 'all' : flags.has('closed') ? 'closed' : 'open';
      const data = await api('GET', `/api/admin/reports?status=${status}`);
      if (out(data)) return;
      if (!data.reports.length) return console.log(status === 'open' ? 'Keine offenen Meldungen.' : 'Keine Meldungen.');
      for (const r of data.reports) {
        printReport(r);
        if (r.decision) console.log(`  Entschieden ${when(r.decision.at)}: ${r.decision.label}`);
        console.log('');
      }
      return;
    }
    case 'report': {
      const data = await api('GET', `/api/admin/reports/${reportId(a1)}`);
      if (out(data)) return;
      const r = data.report;
      printReport(r);
      const ev = r.evidence ?? {};
      if (ev.object) console.log(`  Beleg Objekt (${ev.object.type}): ${ev.object.text || '(ohne Text)'}${ev.object.imageId ? ` · Bild ${ev.object.imageId}` : ''}`);
      for (const m of ev.comment?.messages ?? []) console.log(`  Beleg Kommentar ${m.name} (${m.by}), ${when(m.at)}: ${m.text}`);
      if (data.board) console.log(`  Board jetzt: ${data.board.deleted ? 'gelöscht/Papierkorb' : 'vorhanden'}${data.board.lock ? `, gesperrt (${data.board.lock.mode})` : ''}`);
      else console.log('  Board jetzt: endgültig gelöscht');
      if (r.decision) {
        console.log(`  Entscheidung ${when(r.decision.at)}: ${r.decision.label}`);
        console.log(`  Begründung: ${r.decision.statement}`);
        if (r.decision.ground) console.log(`  Grundlage:  ${r.decision.ground}`);
        console.log(`  Benachrichtigt: ${when(r.decision.notifiedAt)}`);
      } else {
        console.log(`\nEntscheiden: tsx tools/admin.mts decide ${r.id} <no_action|content_removed|board_readonly|board_hidden|board_deleted|account_locked> --statement "…"`);
      }
      return;
    }
    case 'decide': {
      const id = reportId(a1);
      const decision = need(a2, 'Entscheidung');
      const body = {
        decision,
        statement: need(flag('statement'), '--statement "<Begründung für die Betroffenen>"'),
        ...(flag('ground') ? { ground: flag('ground') } : {}),
        ...(flag('affected') ? { affectedKey: flag('affected') } : {}),
        apply: !flags.has('no-apply'),
        notify: !flags.has('no-notify'),
      };
      const data = await api('POST', `/api/admin/reports/${id}/decision`, body);
      if (out(data)) return;
      console.log(`${id}: ${data.report.decision.label}`);
      console.log(`Ausgeführt: ${data.applied}`);
      if (data.notified) {
        console.log(`Benachrichtigt: meldende Person ${data.notified.reporter ? 'ja' : 'nein'}, betroffene Person ${data.notified.affected ? 'ja' : 'nein'}`);
        for (const m of data.notified.missing) console.log(`  Ohne Mail-Adresse, bitte selbst informieren: ${m}`);
      }
      return;
    }
    case 'notify': {
      const data = await api('POST', `/api/admin/reports/${reportId(a1)}/notify`);
      if (out(data)) return;
      console.log(`Benachrichtigt: meldende Person ${data.notified.reporter ? 'ja' : 'nein'}, betroffene Person ${data.notified.affected ? 'ja' : 'nein'}`);
      for (const m of data.notified.missing) console.log(`  Ohne Mail-Adresse, bitte selbst informieren: ${m}`);
      return;
    }
    case 'reopen': {
      const data = await api('POST', `/api/admin/reports/${reportId(a1)}/reopen`);
      if (!out(data)) console.log(`${data.report.id} ist wieder offen.`);
      return;
    }
    case 'board': {
      const data = await api('GET', `/api/admin/boards/${enc(need(a1, 'Board-ID'))}`);
      if (out(data)) return;
      const b = data.board;
      console.log(`„${b.title}“ (${b.id})  Besitz: ${b.owner.name} (${b.owner.key})${b.deleted ? '  [Papierkorb]' : ''}`);
      console.log(`Sperre: ${b.lock ? `${b.lock.mode} seit ${when(b.lock.at)} – ${b.lock.reason}` : 'keine'}`);
      for (const p of data.people) console.log(`  ${p.role.padEnd(8)} ${p.name} (${p.key})`);
      return;
    }
    case 'lock-board': {
      const data = await api('PUT', `/api/admin/boards/${enc(need(a1, 'Board-ID'))}/lock`, {
        mode: flags.has('hidden') ? 'hidden' : 'readonly',
        reason: need(flag('reason'), '--reason "<Grund>"'),
      });
      if (!out(data)) console.log(`Board gesperrt: ${data.lock.mode === 'hidden' ? 'für alle ausgeblendet' : 'nur ansehen'}. Offene Verbindungen wurden getrennt.`);
      return;
    }
    case 'unlock-board': {
      const data = await api('DELETE', `/api/admin/boards/${enc(need(a1, 'Board-ID'))}/lock`);
      if (!out(data)) console.log(data.unlocked ? 'Board entsperrt.' : 'Board war nicht gesperrt.');
      return;
    }
    case 'delete-board': {
      if (!flags.has('yes')) die('Endgültiges Löschen bitte mit --yes bestätigen.');
      const data = await api('DELETE', `/api/admin/boards/${enc(need(a1, 'Board-ID'))}`);
      if (!out(data)) console.log(data.deleted ? 'Board endgültig gelöscht.' : 'Board war schon gelöscht.');
      return;
    }
    case 'people': {
      const data = await api('GET', `/api/admin/people?q=${enc(a1 ?? '')}`);
      if (out(data)) return;
      if (!data.people.length) return console.log('Niemand gefunden.');
      for (const p of data.people) console.log(`${p.key}  ${p.name}  zuletzt ${when(p.lastSeen)}${p.locked ? '  [GESPERRT]' : ''}`);
      return;
    }
    case 'lock-account': {
      const data = await api('PUT', `/api/admin/accounts/${enc(need(a1, 'Schlüssel der Person (people <name>)'))}/lock`, { reason: need(flag('reason'), '--reason "<Grund>"') });
      if (!out(data)) console.log(`Konto gesperrt: ${data.locked.name ?? ''} (${data.locked.key}). Sitzungen beendet, KI-Tokens gelöscht.`);
      return;
    }
    case 'unlock-account': {
      const data = await api('DELETE', `/api/admin/accounts/${enc(need(a1, 'Schlüssel der Person'))}/lock`);
      if (!out(data)) console.log(data.unlocked ? 'Konto entsperrt.' : 'Konto war nicht gesperrt.');
      return;
    }
    case 'locks': {
      const data = await api('GET', '/api/admin/locks');
      if (out(data)) return;
      console.log(`Melde-Adresse: ${data.reportEmail ?? '– (STACHEL_REPORT_EMAIL fehlt)'}`);
      console.log(`Gesperrte Boards: ${data.boards.length ? '' : 'keine'}`);
      for (const b of data.boards) console.log(`  ${b.id}  ${b.mode.padEnd(8)} „${b.title}“  seit ${when(b.at)}  ${b.reportId ?? ''}  ${b.reason}`);
      console.log(`Gesperrte Konten: ${data.accounts.length ? '' : 'keine'}`);
      for (const a of data.accounts) console.log(`  ${a.key}  ${a.name ?? ''}  seit ${when(a.at)}  ${a.reportId ?? ''}  ${a.reason}`);
      return;
    }
    default:
      die(`Unbekannter Befehl „${cmd}“.\n\n${HELP}`);
  }
}

await main();
