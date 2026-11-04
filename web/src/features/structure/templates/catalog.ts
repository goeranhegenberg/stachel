// Vorlagen der Galerie. Jede baut ihre Objekte frisch (eigene ids); eingefügt wird an der Bildschirmmitte.
import type { BoardObject } from '../../../protocol';
// Formen des Moduls shapes (Flussdiagramm): Typen auch ohne den Rest der Web-App (Web-Aktionen auf dem Server)
import '../../shapes/model';
import { inDays, TemplateBuilder } from './build';
import { eventTimeline } from '../timeline/template';

export type TemplateCategory = 'Planung' | 'Ideen' | 'Abläufe' | 'Events';

export interface Template {
  id: string;
  name: string;
  desc: string;
  category: TemplateCategory;
  /** zusätzliche Suchwörter der Galerie (Web und App suchen in Name, Beschreibung, Kategorie und diesen) */
  keywords?: string[];
  build: () => BoardObject[];
}

/** Text, in dem die Suche der Galerie sucht (klein geschrieben; die App rechnet dasselbe aus den Web-Konstanten). */
export const searchText = (t: Pick<Template, 'name' | 'desc' | 'category' | 'keywords'>) => [t.name, t.desc, t.category, ...(t.keywords ?? [])].join(' ').toLowerCase();

/** Passt die Vorlage zur Suche `q`? (leer = alle) */
export const matchesSearch = (t: Pick<Template, 'name' | 'desc' | 'category' | 'keywords'>, q: string) => {
  const needle = q.trim().toLowerCase();
  return !needle || searchText(t).includes(needle);
};

export const CATEGORIES: TemplateCategory[] = ['Planung', 'Ideen', 'Abläufe', 'Events'];

const T = {
  programm: { label: 'Programm', color: '#ec4e92' },
  bar: { label: 'Bar', color: '#ffd08a' },
  social: { label: 'Social Media', color: '#9fd3ff' },
  orga: { label: 'Orga', color: '#c9e14a' },
  technik: { label: 'Technik', color: '#e2d5ff' },
};

const noStroke = { strokeWidth: 0 };

function kanban(): BoardObject[] {
  const b = new TemplateBuilder();
  b.frame(0, 0, 1260, 860, 'Kanban');
  const cols = [
    {
      title: 'Offen',
      color: '#8a8a85',
      cards: [
        { title: 'Bühnenplan finalisieren', desc: 'Reihenfolge der Bands mit der Technik abstimmen.', tags: [T.programm], due: inDays(7) },
        { title: 'Getränke bestellen', tags: [T.bar], due: inDays(14) },
        { title: 'Helfer-Aufruf posten', tags: [T.social] },
      ],
    },
    {
      title: 'In Arbeit',
      color: '#1763b5',
      cards: [
        { title: 'Shuttle vom Bahnhof', desc: 'Zwei Kleinbusse anfragen, Fahrplan erstellen.', status: 'doing' as const, tags: [T.orga], due: inDays(5) },
        { title: 'Awareness-Konzept überarbeiten', status: 'doing' as const },
      ],
    },
    {
      title: 'Erledigt',
      color: '#7aa21b',
      cards: [
        { title: 'Genehmigung für das Gelände', status: 'done' as const, tags: [T.orga] },
        { title: 'Toilettenwagen gebucht', status: 'done' as const },
      ],
    },
  ];
  cols.forEach((c, i) => {
    const x = 40 + i * 400;
    b.shape('rect', x, 40, 380, 780, '', { color: '#f3f3ef', ...noStroke });
    b.shape('rect', x, 40, 380, 8, '', { color: c.color, ...noStroke });
    b.text(x + 22, 70, c.title.toUpperCase(), 26, { bold: true });
    let y = 128;
    for (const card of c.cards) {
      b.card(x + 20, y, { ...card, color: c.color }, 340);
      y += b.last().h + 16;
    }
  });
  return b.objects;
}

function retro(): BoardObject[] {
  const b = new TemplateBuilder();
  b.frame(0, 0, 1320, 860, 'Retrospektive');
  b.text(40, 34, 'Was war gut, was nicht – und was probieren wir beim nächsten Mal?', 22, { color: '#3a3a36' });
  const cols = [
    { title: 'Gut gelaufen', color: '#c9e14a', bg: '#f4f8e1', notes: ['Aufbau in einem Tag geschafft', 'Viele neue Helfer:innen', 'Stimmung am Lagerfeuer'] },
    { title: 'Schlecht gelaufen', color: '#ffb3d1', bg: '#fdeef4', notes: ['Funkgeräte oft leer', 'Zu wenig Schatten am Einlass'] },
    { title: 'Ideen', color: '#9fd3ff', bg: '#eaf5fe', notes: ['Getränke-Bons digital', 'Ladestation für Funk', 'Mehr Sitzplätze'] },
  ];
  cols.forEach((c, i) => {
    const x = 40 + i * 420;
    b.shape('rect', x, 90, 400, 730, '', { color: c.bg, ...noStroke });
    b.shape('rect', x, 90, 400, 70, c.title, { color: c.color, ...noStroke, fontSize: 26, bold: true });
    c.notes.forEach((t, k) => b.sticky(x + 22 + (k % 2) * 186, 186 + Math.floor(k / 2) * 186, t, c.color, 170));
  });
  return b.objects;
}

function mindmap(): BoardObject[] {
  const b = new TemplateBuilder();
  b.mind(0, 0, {
    text: 'Sommerfest',
    children: [
      { text: 'Programm', children: [{ text: 'Bands' }, { text: 'Workshops' }, { text: 'Kinderprogramm' }] },
      { text: 'Orga', children: [{ text: 'Helfer:innen' }, { text: 'Schichten' }, { text: 'Finanzen' }] },
      { text: 'Technik', side: 'l', children: [{ text: 'Strom' }, { text: 'Licht & Ton' }] },
      { text: 'Werbung', side: 'l', children: [{ text: 'Plakate' }, { text: 'Social Media' }, { text: 'Presse' }] },
    ],
  });
  return b.objects;
}

function flow(): BoardObject[] {
  const b = new TemplateBuilder();
  b.frame(0, 0, 1480, 580, 'Flussdiagramm');
  b.text(40, 34, 'Bestellung im Team – vom Wunsch bis zur Lieferung', 22, { color: '#3a3a36' });
  // Flussdiagramm-Formen (Modul shapes): Start/Ende, Eingabe, Entscheidung, Prozess, Dokument
  const start = b.shape('terminator', 40, 185, 180, 70, 'Start', { color: '#c9e14a' });
  const ask = b.shape('manualInput', 290, 170, 220, 100, 'Wunsch kommt rein');
  const dec = b.shape('diamond', 590, 140, 240, 160, 'Budget frei?', { color: '#fff27a' });
  const buy = b.shape('rect', 910, 170, 220, 100, 'Bestellen');
  const end = b.shape('terminator', 1210, 185, 180, 70, 'Fertig', { color: '#1763b5' });
  const talk = b.shape('predefined', 600, 400, 220, 100, 'Im Orga-Treffen klären', { color: '#ffb3d1' });
  const doc = b.shape('document', 920, 400, 200, 110, 'Beleg in die Kasse', { color: '#e2d5ff' });
  b.line(start, ask);
  b.line(ask, dec);
  b.line({ objectId: dec, side: 'e' }, { objectId: buy, side: 'w' }, { text: 'Ja' });
  b.line(buy, end);
  b.line({ objectId: buy, side: 's' }, { objectId: doc, side: 'n' });
  b.line({ objectId: dec, side: 's' }, { objectId: talk, side: 'n' }, { text: 'Nein' });
  b.line({ objectId: talk, side: 'w' }, { objectId: ask, side: 's' }, { lineStyle: 'elbow', dash: 'dashed', text: 'neu planen' });
  return b.objects;
}

function brainstorm(): BoardObject[] {
  const b = new TemplateBuilder();
  b.frame(0, 0, 1280, 880, 'Brainstorming');
  b.shape('rect', 450, 340, 380, 190, 'Wie wird das Festival nachhaltiger?', { color: '#0a0a0a', ...noStroke, fontSize: 30, bold: true });
  const colors = ['#fff27a', '#c9e14a', '#ffb3d1', '#9fd3ff', '#ffd08a', '#e2d5ff'];
  const ideas = ['Mehrweg-Becher', 'Anreise mit der Bahn belohnen', 'Regionale Küche', 'Solarstrom für die Bühne'];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const cx = 640 + Math.cos(a) * 480;
    const cy = 435 + Math.sin(a) * 300;
    b.sticky(Math.round(cx - 75), Math.round(cy - 75), ideas[i] ?? '', colors[i % colors.length], 150);
  }
  b.text(40, 836, 'Regeln: keine Kritik · Menge vor Qualität · Ideen weiterspinnen', 18, { color: '#6b6b66' });
  return b.objects;
}

function week(): BoardObject[] {
  const b = new TemplateBuilder();
  const days = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
  b.frame(0, 0, 1692, 760, 'Wochenplan');
  const notes: Record<number, [string, string]> = { 0: ['Orga-Treffen 19 Uhr', '#fff27a'], 2: ['Material beim Verleih abholen', '#9fd3ff'], 4: ['Helfer-Briefing', '#c9e14a'], 5: ['Aufbau-Tag', '#ffd08a'] };
  days.forEach((d, i) => {
    const x = 30 + i * 236;
    b.shape('rect', x, 30, 220, 64, d.toUpperCase(), { color: i >= 5 ? '#ec4e92' : '#0a0a0a', ...noStroke, fontSize: 22, bold: true });
    b.shape('rect', x, 104, 220, 626, '', { color: '#f3f3ef', ...noStroke });
    if (notes[i]) b.sticky(x + 20, 124, notes[i][0], notes[i][1], 180);
  });
  return b.objects;
}

function swot(): BoardObject[] {
  const b = new TemplateBuilder();
  b.frame(0, 0, 1120, 960, 'SWOT-Analyse');
  const quads = [
    { t: 'Stärken', l: 'S', bg: '#eef5c8', c: '#7aa21b', n: '#c9e14a', notes: ['Engagiertes Team', 'Schönes Gelände'] },
    { t: 'Schwächen', l: 'W', bg: '#ffe3ee', c: '#ec4e92', n: '#ffb3d1', notes: ['Kleines Budget', 'Abhängig vom Wetter'] },
    { t: 'Chancen', l: 'O', bg: '#ddeeff', c: '#1763b5', n: '#9fd3ff', notes: ['Kooperation mit der Gemeinde', 'Förderung beantragen'] },
    { t: 'Risiken', l: 'T', bg: '#ffe9d1', c: '#e8590c', n: '#ffd08a', notes: ['Unwetter', 'Lärm-Beschwerden'] },
  ];
  quads.forEach((q, i) => {
    const x = 40 + (i % 2) * 530;
    const y = 40 + Math.floor(i / 2) * 460;
    b.shape('rect', x, y, 510, 420, q.t.toUpperCase(), { color: q.bg, ...noStroke, fontSize: 30, bold: true, align: 'left', valign: 'top' });
    b.text(x + 400, y + 250, q.l, 140, { color: q.c, bold: true });
    q.notes.forEach((t, k) => b.sticky(x + 30 + k * 170, y + 100, t, q.n, 150));
  });
  return b.objects;
}

function festival(): BoardObject[] {
  const b = new TemplateBuilder();
  b.text(0, -170, 'Veranstaltung – Ablauf', 56, { bold: true });
  const phases = [
    { t: 'Aufbau', when: 'Mi–Do', c: '#ffd08a', steps: ['Gelände abstecken & Wege markieren', 'Bühne, Zelte und Bar aufbauen', 'Strom, Wasser & Licht verlegen', 'Deko, Schilder & Awareness-Zelt'] },
    { t: 'Veranstaltung', when: 'Fr–So', c: '#c9e14a', steps: ['Fr 16 Uhr: Einlass öffnet', 'Programm auf zwei Bühnen', 'Awareness-Team rund um die Uhr', 'So 18 Uhr: Abschlusskonzert'] },
    { t: 'Abbau', when: 'So–Mo', c: '#9fd3ff', steps: ['Bühne & Technik abbauen', 'Müll trennen und entsorgen', 'Material zurück ins Lager', 'Gemeinsames Abschluss-Essen'] },
  ];
  const heads: string[] = [];
  phases.forEach((p, i) => {
    const x = i * 600;
    b.frame(x, 0, 520, 800, `${i + 1} · ${p.t} · ${p.when}`);
    heads.push(b.shape('rect', x + 30, 30, 460, 76, p.t.toUpperCase(), { color: '#0a0a0a', ...noStroke, fontSize: 32, bold: true }));
    let prev: string | null = null;
    p.steps.forEach((s, k) => {
      const id = b.shape('rect', x + 30, 150 + k * 160, 460, 110, s, { color: p.c, ...noStroke, fontSize: 22 });
      if (prev) b.line(prev, id, { color: '#3a3a36' });
      prev = id;
    });
  });
  for (let i = 0; i < heads.length - 1; i++) b.line({ objectId: heads[i], side: 'e' }, { objectId: heads[i + 1], side: 'w' }, { strokeWidth: 4 });
  return b.objects;
}

function shifts(): BoardObject[] {
  const b = new TemplateBuilder();
  const times = ['Fr 14–18', 'Fr 18–22', 'Fr 22–02', 'Sa 10–14', 'Sa 14–18', 'Sa 18–22', 'Sa 22–02', 'So 10–14', 'So 14–18'];
  const areas = ['Bar', 'Einlass', 'Awareness', 'Technik'];
  const rows = [['Bereich', ...times], ...areas.map((a) => [a, ...times.map(() => '')])];
  rows[1][2] = 'Lena, Tom';
  rows[3][1] = 'Mira';
  b.text(40, 34, 'Schichtplan Festival', 36, { bold: true });
  b.text(40, 84, 'Doppelklick auf eine Zelle und Namen eintragen. Tab springt zur nächsten Schicht.', 18, { color: '#6b6b66' });
  b.table(40, 130, rows, 1560, [1.4, ...times.map(() => 1)], 'both');
  b.frame(0, 0, 1640, 130 + b.last().h + 40, 'Schichtplan');
  return b.objects;
}

function siteplan(): BoardObject[] {
  const b = new TemplateBuilder();
  const g = 140;
  b.frame(0, 0, 10 * g, 7 * g, 'Lageplan', { color: '#eef3dc', frameGrid: g, frameGridLabels: true });
  const big = { ...noStroke, bold: true };
  b.shape('rect', 4 * g, g, 3 * g, 2 * g, 'Bühne', { color: '#0a0a0a', ...big, fontSize: 36 });
  b.shape('rect', g, 4 * g, 2 * g, g, 'Bar', { color: '#ec4e92', ...big, fontSize: 28 });
  b.shape('rect', 8 * g, 5 * g, 2 * g, g, 'Einlass', { color: '#1763b5', ...big, fontSize: 28 });
  b.shape('rect', g, g, g, g, 'WC', { color: '#e9e9e4', ...big, fontSize: 26 });
  b.shape('rect', 9 * g, g, g, g, 'Erste Hilfe', { color: '#ffffff', stroke: '#ec4e92', strokeWidth: 6, bold: true, fontSize: 22 });
  b.shape('ellipse', 6 * g, 4 * g, g, g, 'Awareness', { color: '#e2d5ff', ...big, fontSize: 20 });
  b.shape('rect', 4 * g, 5 * g, 3 * g, 2 * g - 20, 'Camping', { color: '#c9e14a', stroke: '#7aa21b', strokeWidth: 3, dash: 'dashed', bold: true, fontSize: 28 });
  // Bausteine zum Hineinziehen
  const lx = 10 * g + 80;
  b.text(lx, 0, 'BAUSTEINE', 26, { bold: true });
  b.text(lx, 40, 'Ins Raster ziehen, Alt + Ziehen kopiert', 16, { color: '#6b6b66' });
  const parts: [string, string, number, number, Partial<BoardObject>][] = [
    ['Bühne', '#0a0a0a', 210, 120, big],
    ['Bar', '#ec4e92', 140, 70, big],
    ['Einlass', '#1763b5', 140, 70, big],
    ['WC', '#e9e9e4', 70, 70, big],
    ['Erste Hilfe', '#ffffff', 140, 70, { stroke: '#ec4e92', strokeWidth: 5, bold: true }],
    ['Awareness', '#e2d5ff', 100, 100, big],
    ['Strom', '#fff27a', 100, 70, big],
    ['Müll', '#8a8a85', 100, 70, big],
  ];
  let y = 90;
  for (const [t, c, w, h, extra] of parts) {
    b.shape(t === 'Awareness' ? 'ellipse' : 'rect', lx, y, w, h, t, { color: c, fontSize: 18, ...extra });
    y += h + 18;
  }
  return b.objects;
}

// ---- Veranstaltungen (Paket Q2) ---------------------------------------------------------------------------------------

function dayplan(): BoardObject[] {
  const b = new TemplateBuilder();
  b.text(40, 34, 'Ablaufplan Veranstaltungstag – Samstag', 36, { bold: true });
  b.text(40, 84, 'Running Order aller Bühnen, dazu Einlass, Umbau und Ansagen. Zeiten ändern: Doppelklick in die Zelle.', 18, { color: '#6b6b66' });
  const rows = [
    ['Uhrzeit', 'Hauptbühne', 'Zeltbühne', 'Orga & Hinweise'],
    ['11:00', '', '', 'Helfer-Treffen am Infozelt, Funkgeräte ausgeben'],
    ['12:00', '', 'Kinderprogramm: Trommel-Workshop', 'Einlass öffnet'],
    ['14:00', 'Soundcheck Band 1', 'Lesung im Schatten', 'Getränke-Lieferung an der Bar'],
    ['15:30', 'Band 1 (45 min)', 'Open Stage', ''],
    ['16:15', 'Umbau (30 min)', '', 'Ansage: Wasserstellen und Awareness-Zelt'],
    ['16:45', 'Band 2 (60 min)', 'DJ-Set Tag', ''],
    ['18:00', 'Pause / Abendessen Crew', '', 'Schichtwechsel Bar und Einlass'],
    ['19:30', 'Band 3 (60 min)', 'Theater', ''],
    ['21:00', 'Headliner (90 min)', '', 'Ordner:innen an den Wellenbrechern'],
    ['22:45', 'Lichtshow & Ansage', 'DJ-Set Nacht', 'Lärmschutz: Hauptbühne leiser ab 23 Uhr'],
    ['02:00', 'Ende', 'Ende', 'Gelände-Runde, Bar schließt'],
  ];
  b.table(40, 130, rows, 1360, [0.7, 1.4, 1.4, 1.8], 'row');
  const h = 130 + b.last().h;
  b.sticky(40, h + 30, 'Wer moderiert? Bis 12 Uhr klären', '#fff27a', 200);
  b.sticky(260, h + 30, 'Notfall Bühne: Funkkanal 2', '#ffb3d1', 200);
  b.sticky(480, h + 30, 'Regen? Zeltbühne statt Hauptbühne', '#9fd3ff', 200);
  b.frame(0, 0, 1440, h + 270, 'Ablaufplan Veranstaltungstag');
  return b.objects;
}

function buildShifts(): BoardObject[] {
  const b = new TemplateBuilder();
  b.text(40, 34, 'Schichtplan Aufbau & Abbau', 36, { bold: true });
  b.text(40, 84, 'Je Schicht eine Aufgabe, eine Leitung und freie Plätze. Namen in die letzte Spalte eintragen.', 18, { color: '#6b6b66' });
  const rows = [
    ['Schicht', 'Aufgabe', 'Leitung', 'Plätze', 'Eingetragen'],
    ['Mi 08–12', 'Gelände abstecken, Wege markieren', 'Tom', '6', ''],
    ['Mi 12–18', 'Zelte und Pavillons aufstellen', 'Mira', '10', ''],
    ['Do 08–12', 'Bühne und Traversen aufbauen', 'Technik-Team', '8', ''],
    ['Do 12–18', 'Strom, Wasser und Licht verlegen', 'Jonas', '6', ''],
    ['Do 18–21', 'Deko, Schilder, Awareness-Zelt', 'Lena', '8', ''],
    ['So 20–24', 'Bühne abbauen, Technik verladen', 'Technik-Team', '10', ''],
    ['Mo 08–12', 'Müll trennen, Gelände abgehen', 'Mira', '12', ''],
    ['Mo 12–16', 'Material zurück ins Lager', 'Tom', '6', ''],
  ];
  b.table(40, 130, rows, 1360, [0.8, 2, 1, 0.6, 1.8], 'row');
  const h = 130 + b.last().h;
  b.sticky(40, h + 30, 'Festes Schuhwerk und Arbeitshandschuhe mitbringen', '#ffd08a', 170);
  b.sticky(230, h + 30, 'Essen für die Crew: 13 Uhr am Küchenzelt', '#c9e14a', 170);
  b.frame(0, 0, 1440, h + 240, 'Aufbau & Abbau');
  return b.objects;
}

function awareness(): BoardObject[] {
  const b = new TemplateBuilder();
  b.frame(0, 0, 1400, 1040, 'Awareness-Konzept');
  b.text(40, 34, 'Awareness-Konzept – alle sollen sich sicher und willkommen fühlen', 30, { bold: true });
  b.text(40, 80, 'Wir hören zu, glauben Betroffenen und handeln parteilich. Grenzen setzt die betroffene Person.', 20, { color: '#3a3a36' });
  const boxes = [
    { t: 'Leitbild', c: '#e2d5ff', n: ['Kein Platz für Sexismus, Rassismus, Queerfeindlichkeit', 'Betroffene entscheiden, was passiert'] },
    { t: 'Team & Erreichbarkeit', c: '#c9e14a', n: ['Immer zwei Personen im Dienst', 'Lila Westen, Funkkanal 3, Telefon am Infozelt'] },
    { t: 'Rückzugsort', c: '#9fd3ff', n: ['Ruhiges Zelt abseits der Bühne', 'Wasser, Decken, Ohrstöpsel, Snacks'] },
    { t: 'Kommunikation', c: '#fff27a', n: ['Plakate an Bar, WC und Einlass', 'Ansage vor dem Headliner'] },
    { t: 'Schulung', c: '#ffd08a', n: ['Workshop für alle Helfer:innen vorab', 'Kurz-Briefing vor jeder Schicht'] },
    { t: 'Nachsorge', c: '#ffb3d1', n: ['Kontakt zu Beratungsstellen', 'Auswertung im Team nach dem Fest'] },
  ];
  boxes.forEach((x, i) => {
    const bx = 40 + (i % 3) * 450;
    const by = 140 + Math.floor(i / 3) * 330;
    b.shape('rect', bx, by, 420, 300, '', { color: '#f3f3ef', ...noStroke });
    b.text(bx + 24, by + 22, x.t.toUpperCase(), 22, { bold: true });
    x.n.forEach((t, k) => b.sticky(bx + 24 + k * 196, by + 80, t, x.c, 176));
  });
  b.text(40, 820, 'ABLAUF BEI EINEM VORFALL', 24, { bold: true });
  const steps = ['Ansprechen & zuhören', 'Schützen & Ruhe geben', 'Gemeinsam entscheiden', 'Dokumentieren & nachsorgen'];
  let prev: string | null = null;
  steps.forEach((s, k) => {
    const id = b.shape('rect', 40 + k * 340, 870, 280, 110, s, { color: k === 0 ? '#e2d5ff' : '#ffffff', fontSize: 20 });
    if (prev) b.line(prev, id);
    prev = id;
  });
  return b.objects;
}

function stagePlot(): BoardObject[] {
  const b = new TemplateBuilder();
  b.frame(0, 0, 1720, 940, 'Bühnenplan');
  b.text(40, 34, 'Bühnenplan & Kanalliste', 36, { bold: true });
  b.text(40, 84, 'Aufstellung auf der Bühne aus Sicht des Publikums. Bausteine verschieben, Kanäle rechts eintragen.', 18, { color: '#6b6b66' });
  b.shape('rect', 40, 130, 1000, 620, '', { color: '#e9e9e4', stroke: '#3a3a36', strokeWidth: 3 });
  b.text(60, 700, 'BÜHNE 8 × 6 m', 22, { bold: true, color: '#3a3a36' });
  b.shape('rect', 40, 770, 1000, 60, 'PUBLIKUM', { color: '#0a0a0a', ...noStroke, fontSize: 24, bold: true });
  const part = (kind: 'rect' | 'ellipse' | 'triangle', x: number, y: number, w: number, h: number, t: string, color: string) =>
    b.shape(kind, x, y, w, h, t, { color, fontSize: 16, bold: true });
  part('ellipse', 440, 200, 180, 150, 'Schlagzeug', '#ffd08a');
  part('rect', 220, 230, 140, 80, 'Bass-Amp', '#9fd3ff');
  part('rect', 700, 230, 140, 80, 'Gitarren-Amp', '#9fd3ff');
  part('rect', 820, 420, 160, 90, 'Keys', '#e2d5ff');
  part('ellipse', 250, 470, 70, 70, 'Mic 3', '#c9e14a');
  part('ellipse', 495, 520, 70, 70, 'Mic 1', '#c9e14a');
  part('ellipse', 720, 470, 70, 70, 'Mic 2', '#c9e14a');
  part('triangle', 230, 620, 110, 80, 'Mon 3', '#ffb3d1');
  part('triangle', 475, 640, 110, 80, 'Mon 1', '#ffb3d1');
  part('triangle', 700, 620, 110, 80, 'Mon 2', '#ffb3d1');
  part('rect', 70, 180, 100, 60, '230 V', '#fff27a');
  part('rect', 910, 180, 100, 60, '230 V', '#fff27a');
  part('rect', 470, 850, 160, 50, 'FOH 25 m', '#ffffff');
  const rows = [
    ['Kanal', 'Instrument', 'Mikro / DI', 'Stativ'],
    ['1', 'Kick', 'Beta 52', 'klein'],
    ['2', 'Snare', 'SM57', 'klein'],
    ['3', 'Overhead L/R', 'Kondensator', 'groß'],
    ['4', 'Bass', 'DI', '–'],
    ['5', 'Gitarre', 'SM57', 'klein'],
    ['6', 'Keys L/R', 'DI (Stereo)', '–'],
    ['7', 'Gesang 1', 'Funk', 'groß'],
    ['8', 'Gesang 2', 'SM58', 'groß'],
    ['9', 'Gesang 3', 'SM58', 'groß'],
  ];
  b.table(1080, 130, rows, 600, [0.6, 1.4, 1.3, 0.9], 'row');
  return b.objects;
}

function briefing(): BoardObject[] {
  const b = new TemplateBuilder();
  b.frame(0, 0, 1560, 900, 'Helfer-Briefing');
  b.text(40, 34, 'Helfer-Briefing – Schicht Samstag', 36, { bold: true });
  const cols = [
    { t: '1 · Willkommen & Ablauf', c: '#c9e14a', n: ['Kurze Vorstellungsrunde', 'Ablauf des Tages durchgehen', 'Pausen: 30 min je 4 Stunden'] },
    { t: '2 · Deine Aufgabe', c: '#9fd3ff', n: ['Bar: Pfand immer zurücknehmen', 'Einlass: Bändchen prüfen', 'Unsicher? Leitung fragen'] },
    { t: '3 · Sicherheit', c: '#ffb3d1', n: ['Fluchtwege freihalten', 'Erste Hilfe am Sanitätszelt', 'Awareness-Team: Funkkanal 3'] },
  ];
  cols.forEach((c, i) => {
    const x = 40 + i * 380;
    b.shape('rect', x, 100, 360, 520, '', { color: '#f3f3ef', ...noStroke });
    b.shape('rect', x, 100, 360, 64, c.t, { color: c.c, ...noStroke, fontSize: 20, bold: true });
    c.n.forEach((t, k) => b.sticky(x + 20 + (k % 2) * 170, 190 + Math.floor(k / 2) * 170, t, c.c, 150));
  });
  b.text(1180, 100, 'WICHTIGE KONTAKTE', 22, { bold: true });
  b.table(1180, 140, [['Wer', 'Funk', 'Telefon'], ['Schichtleitung', 'Kanal 1', ''], ['Technik', 'Kanal 2', ''], ['Awareness', 'Kanal 3', ''], ['Sanität', 'Kanal 4', '']], 340, [1.3, 0.8, 1], 'row');
  b.text(40, 660, 'OFFENE FRAGEN', 22, { bold: true });
  b.sticky(40, 700, 'Wo gibt es Essen für die Crew?', '#fff27a', 150);
  b.sticky(210, 700, '', '#fff27a', 150);
  b.sticky(380, 700, '', '#fff27a', 150);
  return b.objects;
}

function festRetro(): BoardObject[] {
  const b = new TemplateBuilder();
  b.frame(0, 0, 1500, 1120, 'Nachbesprechung');
  b.text(40, 34, 'Nachbesprechung – was nehmen wir mit zur nächsten Veranstaltung?', 28, { bold: true });
  const heads = [
    { t: 'Lief gut', c: '#c9e14a' },
    { t: 'Verbessern', c: '#ffb3d1' },
    { t: 'Für nächstes Jahr merken', c: '#9fd3ff' },
  ];
  const areas = ['Programm', 'Orga & Helfer:innen', 'Gäste & Awareness', 'Technik & Aufbau'];
  const notes: Record<string, string> = {
    '0-0': 'Headliner pünktlich',
    '0-1': 'Umbaupausen zu lang',
    '1-0': 'Schichtplan früh fertig',
    '1-1': 'Zu wenige Helfer:innen am Sonntag',
    '2-0': 'Rückzugszelt gut genutzt',
    '2-2': 'Mehr Wasserstellen',
    '3-1': 'Strom an der Bar fiel aus',
    '3-2': 'Zweiten Verteilerkasten mieten',
  };
  heads.forEach((h, k) => b.shape('rect', 300 + k * 400, 100, 380, 60, h.t.toUpperCase(), { color: h.c, ...noStroke, fontSize: 20, bold: true }));
  areas.forEach((a, r) => {
    const y = 180 + r * 230;
    b.shape('rect', 40, y, 240, 210, a, { color: '#0a0a0a', ...noStroke, fontSize: 20, bold: true });
    heads.forEach((h, k) => {
      const x = 300 + k * 400;
      b.shape('rect', x, y, 380, 210, '', { color: '#f3f3ef', ...noStroke });
      const t = notes[`${r}-${k}`];
      if (t) b.sticky(x + 20, y + 25, t, h.c, 160);
    });
  });
  return b.objects;
}

function budget(): BoardObject[] {
  const b = new TemplateBuilder();
  b.text(40, 34, 'Budget-Übersicht', 36, { bold: true });
  b.text(40, 84, 'Plan und Ist je Posten in Euro. Die Differenz bitte nach jeder Abrechnung nachtragen.', 18, { color: '#6b6b66' });
  b.text(40, 130, 'AUSGABEN', 22, { bold: true });
  const out = [
    ['Posten', 'Plan €', 'Ist €', 'Differenz €', 'Verantwortlich'],
    ['Bühne, Licht & Ton', '6.500', '', '', 'Technik'],
    ['Gagen & Fahrtkosten', '8.000', '', '', 'Programm'],
    ['Bar-Einkauf', '4.200', '', '', 'Bar'],
    ['Toiletten & Wasser', '1.800', '', '', 'Orga'],
    ['Genehmigungen & Versicherung', '900', '', '', 'Orga'],
    ['Werbung & Druck', '700', '', '', 'Social Media'],
    ['Awareness & Erste Hilfe', '600', '', '', 'Awareness'],
    ['Puffer (10 %)', '2.270', '', '', ''],
    ['Summe', '24.970', '', '', ''],
  ];
  b.table(40, 170, out, 900, [2, 1, 1, 1, 1.4], 'row');
  const h1 = 170 + b.last().h;
  b.text(980, 130, 'EINNAHMEN', 22, { bold: true });
  b.table(980, 170, [['Posten', 'Plan €', 'Ist €'], ['Tickets', '14.000', ''], ['Bar', '7.500', ''], ['Spenden', '1.500', ''], ['Förderung', '2.000', ''], ['Summe', '25.000', '']], 480, [1.6, 1, 1], 'row');
  b.sticky(980, 170 + b.last().h + 30, 'Förderantrag bis Ende März stellen', '#fff27a', 170);
  b.frame(0, 0, 1500, Math.max(h1, 600) + 60, 'Budget');
  return b.objects;
}

// ---- Methoden (Paket Q2) -------------------------------------------------------------------------------------------

function startStop(): BoardObject[] {
  const b = new TemplateBuilder();
  b.frame(0, 0, 1320, 860, 'Start, Stop, Continue');
  b.text(40, 34, 'Was fangen wir an, was lassen wir, was behalten wir bei?', 22, { color: '#3a3a36' });
  const cols = [
    { title: 'Start', color: '#c9e14a', bg: '#f4f8e1', notes: ['Schichten online eintragen', 'Montags kurz abstimmen'] },
    { title: 'Stop', color: '#ffb3d1', bg: '#fdeef4', notes: ['Entscheidungen im Gruppenchat', 'Einkäufe ohne Absprache'] },
    { title: 'Continue', color: '#9fd3ff', bg: '#eaf5fe', notes: ['Gemeinsames Kochen nach dem Aufbau', 'Protokoll im Board'] },
  ];
  cols.forEach((c, i) => {
    const x = 40 + i * 420;
    b.shape('rect', x, 90, 400, 730, '', { color: c.bg, ...noStroke });
    b.shape('rect', x, 90, 400, 70, c.title.toUpperCase(), { color: c.color, ...noStroke, fontSize: 26, bold: true });
    c.notes.forEach((t, k) => b.sticky(x + 22 + (k % 2) * 186, 186 + Math.floor(k / 2) * 186, t, c.color, 170));
  });
  return b.objects;
}

function cluster(): BoardObject[] {
  const b = new TemplateBuilder();
  b.frame(0, 0, 1560, 980, 'Brainstorming-Cluster');
  b.shape('rect', 40, 40, 1480, 90, 'Wie bekommen wir mehr Gäste aus der Region?', { color: '#0a0a0a', ...noStroke, fontSize: 30, bold: true });
  b.text(40, 160, 'NOCH NICHT SORTIERT', 20, { bold: true });
  ['Plakate in Bäckereien', 'Kooperation mit dem Sportverein', '', ''].forEach((t, k) => b.sticky(40 + (k % 2) * 170, 200 + Math.floor(k / 2) * 170, t, '#fff27a', 150));
  const groups = [
    { t: 'Werbung vor Ort', c: '#ffd08a', n: ['Infostand auf dem Wochenmarkt', 'Flyer an der Bushaltestelle'] },
    { t: 'Anreise', c: '#9fd3ff', n: ['Shuttle vom Bahnhof', 'Fahrrad-Parkplatz mit Bewachung'] },
    { t: 'Preise', c: '#c9e14a', n: ['Ermäßigung für Anwohner:innen', 'Familien-Ticket'] },
    { t: 'Programm', c: '#e2d5ff', n: ['Lokale Bands am Nachmittag', 'Kinderprogramm'] },
  ];
  groups.forEach((g, i) => {
    const x = 420 + (i % 2) * 560;
    const y = 160 + Math.floor(i / 2) * 400;
    b.shape('rect', x, y, 540, 380, '', { color: '#ffffff', stroke: '#8a8a85', strokeWidth: 2, dash: 'dashed' });
    b.text(x + 24, y + 22, g.t.toUpperCase(), 20, { bold: true });
    g.n.forEach((t, k) => b.sticky(x + 30 + k * 250, y + 90, t, g.c, 160));
  });
  b.text(40, 560, 'Erst sammeln, dann ähnliche Ideen in ein Cluster ziehen und jedem Cluster einen Namen geben.', 18, { color: '#6b6b66', w: 330 });
  return b.objects;
}

function backlog(): BoardObject[] {
  const b = new TemplateBuilder();
  b.frame(0, 0, 1660, 900, 'Kanban mit Backlog');
  const cols = [
    { title: 'Backlog', color: '#8a8a85', cards: [{ title: 'Sponsoren anschreiben' }, { title: 'Website aktualisieren', tags: [T.social] }, { title: 'Pfandsystem prüfen', tags: [T.bar] }, { title: 'Fotograf:in anfragen' }] },
    { title: 'Diese Woche', color: '#ec4e92', cards: [{ title: 'Helfer-Aufruf posten', tags: [T.social], due: inDays(3) }, { title: 'Angebote Bühnentechnik vergleichen', tags: [T.technik], due: inDays(5) }] },
    { title: 'In Arbeit · max. 3', color: '#1763b5', cards: [{ title: 'Förderantrag schreiben', desc: 'Kulturamt, Frist Ende des Monats.', status: 'doing' as const, tags: [T.orga] }] },
    { title: 'Erledigt', color: '#7aa21b', cards: [{ title: 'Termin mit der Gemeinde', status: 'done' as const, tags: [T.orga] }] },
  ];
  cols.forEach((c, i) => {
    const x = 40 + i * 400;
    b.shape('rect', x, 40, 380, 820, '', { color: '#f3f3ef', ...noStroke });
    b.shape('rect', x, 40, 380, 8, '', { color: c.color, ...noStroke });
    b.text(x + 22, 70, c.title.toUpperCase(), 24, { bold: true });
    let y = 128;
    for (const card of c.cards) {
      b.card(x + 20, y, { ...card, color: c.color }, 340);
      y += b.last().h + 16;
    }
  });
  return b.objects;
}

function eisenhower(): BoardObject[] {
  const b = new TemplateBuilder();
  b.frame(0, 0, 1240, 1060, 'Eisenhower-Matrix');
  b.text(200, 34, 'DRINGEND', 22, { bold: true, color: '#ec4e92' });
  b.text(730, 34, 'NICHT DRINGEND', 22, { bold: true, color: '#1763b5' });
  b.text(40, 300, 'WICHTIG', 22, { bold: true });
  b.text(40, 760, 'NICHT\nWICHTIG', 22, { bold: true, color: '#6b6b66' });
  const quads = [
    { t: 'Sofort erledigen', bg: '#ffe3ee', n: '#ffb3d1', notes: ['Genehmigung nachreichen', 'Bühnenplan an die Technik'] },
    { t: 'Planen', bg: '#ddeeff', n: '#9fd3ff', notes: ['Helfer-Workshop terminieren', 'Budget für nächstes Jahr'] },
    { t: 'Abgeben', bg: '#fff9cc', n: '#fff27a', notes: ['Getränke-Bestellung', 'Mails an die Presse'] },
    { t: 'Weglassen', bg: '#ecebe6', n: '#ffffff', notes: ['Dritte Logo-Variante', 'Lange Diskussion über Bändchen-Farbe'] },
  ];
  quads.forEach((q, i) => {
    const x = 180 + (i % 2) * 530;
    const y = 80 + Math.floor(i / 2) * 480;
    b.shape('rect', x, y, 510, 460, '', { color: q.bg, ...noStroke });
    b.text(x + 30, y + 28, q.t.toUpperCase(), 26, { bold: true });
    q.notes.forEach((t, k) => b.sticky(x + 30 + k * 170, y + 100, t, q.n, 150));
  });
  return b.objects;
}

function tows(): BoardObject[] {
  const b = new TemplateBuilder();
  b.frame(0, 0, 1400, 1020, 'SWOT mit Strategien');
  b.text(40, 34, 'SWOT mit Strategien: Stärken und Schwächen gegen Chancen und Risiken stellen', 22, { color: '#3a3a36' });
  const head = { ...noStroke, fontSize: 22, bold: true };
  b.shape('rect', 40, 90, 300, 120, 'Intern →\nExtern ↓', { color: '#0a0a0a', ...head });
  b.shape('rect', 360, 90, 500, 120, 'STÄRKEN (S)\nEngagiertes Team, schönes Gelände', { color: '#eef5c8', ...head, fontSize: 20 });
  b.shape('rect', 880, 90, 480, 120, 'SCHWÄCHEN (W)\nKleines Budget, wetterabhängig', { color: '#ffe3ee', ...head, fontSize: 20 });
  b.shape('rect', 40, 230, 300, 360, 'CHANCEN (O)\nFörderung, Kooperation mit der Gemeinde', { color: '#ddeeff', ...head, fontSize: 20 });
  b.shape('rect', 40, 610, 300, 360, 'RISIKEN (T)\nUnwetter, Lärm-Beschwerden', { color: '#ffe9d1', ...head, fontSize: 20 });
  const cells = [
    { x: 360, y: 230, w: 500, t: 'SO: Stärken nutzen, um Chancen zu ergreifen', n: ['Team schreibt den Förderantrag gemeinsam'], c: '#c9e14a' },
    { x: 880, y: 230, w: 480, t: 'WO: Schwächen abbauen, um Chancen zu nutzen', n: ['Förderung für Zelte beantragen'], c: '#9fd3ff' },
    { x: 360, y: 610, w: 500, t: 'ST: Stärken nutzen, um Risiken abzuwehren', n: ['Nachbarschaftsfest vorab'], c: '#ffd08a' },
    { x: 880, y: 610, w: 480, t: 'WT: Schwächen und Risiken klein halten', n: ['Wetter-Plan B mit Zeltbühne'], c: '#ffb3d1' },
  ];
  for (const c of cells) {
    b.shape('rect', c.x, c.y, c.w, 360, '', { color: '#f3f3ef', ...noStroke });
    b.text(c.x + 24, c.y + 22, c.t, 18, { bold: true, w: c.w - 48 });
    c.n.forEach((t, k) => b.sticky(c.x + 30 + k * 180, c.y + 110, t, c.c, 160));
  }
  return b.objects;
}

function personas(): BoardObject[] {
  const b = new TemplateBuilder();
  b.frame(0, 0, 1480, 1000, 'Personas');
  const people = [
    { name: 'Lena, 24', role: 'Stammgast, Studentin', c: '#ffb3d1', goals: 'Mit Freund:innen tanzen, neue Bands entdecken', pain: 'Lange Schlangen an der Bar', quote: '„Ich will nicht die halbe Nacht anstehen.“' },
    { name: 'Jürgen, 58', role: 'Nachbar des Geländes', c: '#9fd3ff', goals: 'Ruhige Nächte, Infos vorab', pain: 'Laute Musik nach Mitternacht', quote: '„Sagt mir einfach früh genug Bescheid.“' },
    { name: 'Mia, 31', role: 'Helferin mit Kind', c: '#c9e14a', goals: 'Kurze Schichten, Kinderbetreuung', pain: 'Schichtplan kommt zu spät', quote: '„Ich helfe gern, wenn ich planen kann.“' },
  ];
  people.forEach((p, i) => {
    const x = 40 + i * 480;
    b.shape('rect', x, 40, 460, 920, '', { color: '#f3f3ef', ...noStroke });
    b.shape('ellipse', x + 30, 70, 120, 120, 'Foto', { color: p.c, ...noStroke, fontSize: 16 });
    b.text(x + 170, 90, p.name, 30, { bold: true });
    b.text(x + 170, 138, p.role, 18, { color: '#6b6b66' });
    const fields: [string, string][] = [['ZIELE', p.goals], ['FRUST', p.pain], ['ZITAT', p.quote]];
    fields.forEach(([label, text], k) => {
      const y = 230 + k * 240;
      b.text(x + 30, y, label, 18, { bold: true });
      b.sticky(x + 30, y + 36, text, p.c, 180);
    });
  });
  return b.objects;
}

function journey(): BoardObject[] {
  const b = new TemplateBuilder();
  const phases = ['Entdecken', 'Ticket kaufen', 'Anreise', 'Vor Ort', 'Danach'];
  const rows = [
    { t: 'Was tut die Person?', c: '#fff27a', n: ['Sieht ein Plakat', 'Kauft online', 'Fährt mit dem Rad', 'Tanzt vor der Bühne', 'Teilt Fotos'] },
    { t: 'Was denkt sie?', c: '#9fd3ff', n: ['Wer spielt da?', 'Ist das teuer?', 'Wo parke ich?', 'Wo ist Wasser?', 'Nächstes Jahr wieder!'] },
    { t: 'Schmerzpunkte', c: '#ffb3d1', n: ['', 'Bezahlseite langsam', 'Kein Schild am Abzweig', 'Lange Schlange am WC', ''] },
    { t: 'Chancen', c: '#c9e14a', n: ['Line-up früher zeigen', '', 'Wegweiser ab Bahnhof', 'Mehr WC-Wagen', 'Umfrage per Mail'] },
  ];
  const W = 270;
  const X0 = 300;
  const totalW = X0 + phases.length * (W + 16) + 24;
  b.frame(0, 0, totalW, 1240, 'User-Journey');
  b.text(40, 34, 'User-Journey: ein Festivalbesuch aus Sicht der Gäste', 28, { bold: true });
  phases.forEach((p, k) => b.shape('rect', X0 + k * (W + 16), 100, W, 64, p.toUpperCase(), { color: '#0a0a0a', ...noStroke, fontSize: 20, bold: true }));
  rows.forEach((r, i) => {
    const y = 184 + i * 200;
    b.shape('rect', 40, y, 240, 180, r.t, { color: r.c, ...noStroke, fontSize: 20, bold: true });
    r.n.forEach((t, k) => {
      const x = X0 + k * (W + 16);
      b.shape('rect', x, y, W, 180, '', { color: '#f3f3ef', ...noStroke });
      if (t) b.sticky(x + (W - 150) / 2, y + 15, t, r.c, 150);
    });
  });
  // Gefühlskurve: Punkte je Phase, höher = besser
  const yMood = 184 + rows.length * 200;
  b.shape('rect', 40, yMood, 240, 220, 'Gefühl', { color: '#e2d5ff', ...noStroke, fontSize: 20, bold: true });
  const mood = [1, 1, 2, 0, 0];
  let prev: string | null = null;
  mood.forEach((m, k) => {
    const id = b.shape('ellipse', X0 + k * (W + 16) + W / 2 - 22, yMood + 20 + m * 70, 44, 44, '', { color: m === 0 ? '#c9e14a' : m === 1 ? '#fff27a' : '#ec4e92', ...noStroke });
    if (prev) b.line(prev, id, { arrowEnd: false, color: '#7048e8', strokeWidth: 3 });
    prev = id;
  });
  return b.objects;
}

function okr(): BoardObject[] {
  const b = new TemplateBuilder();
  b.frame(0, 0, 1320, 1080, 'OKR');
  b.text(40, 34, 'Ziele und Schlüsselergebnisse – Quartal', 30, { bold: true });
  const objectives = [
    { o: 'Ziel 1: Das Festival wird bekannter in der Region', c: '#1763b5', krs: [['400 Vorverkauf-Tickets bis Juni', 'Stand: 120'], ['3 Artikel in der Lokalpresse', 'Stand: 1'], ['1.000 Follower:innen auf Social Media', 'Stand: 640']] },
    { o: 'Ziel 2: Helfer:innen kommen gern wieder', c: '#7aa21b', krs: [['80 % sagen: „Ich helfe wieder“', 'Umfrage nach dem Fest'], ['Schichtplan 4 Wochen vorher fertig', ''], ['Keine Schicht länger als 4 Stunden', '']] },
  ];
  objectives.forEach((ob, i) => {
    const y = 100 + i * 480;
    b.shape('rect', 40, y, 1240, 90, ob.o, { color: ob.c, ...noStroke, fontSize: 26, bold: true, align: 'left' });
    ob.krs.forEach(([t, d], k) => b.card(40 + k * 420, y + 120, { title: t ?? '', desc: d || undefined, status: k === 0 ? 'doing' : 'todo', color: ob.c }, 400));
    b.sticky(40, y + 280, 'Maßnahme: …', '#fff27a', 140);
  });
  return b.objects;
}

function decision(): BoardObject[] {
  const b = new TemplateBuilder();
  b.text(40, 34, 'Entscheidungsmatrix', 36, { bold: true });
  b.text(40, 84, 'Gewicht 1–3, Punkte je Option 1–5. Ergebnis = Summe aus Gewicht × Punkten.', 18, { color: '#6b6b66' });
  const rows = [
    ['Kriterium', 'Gewicht', 'Option A: Wiese am See', 'Option B: Sportplatz', 'Option C: Alte Ziegelei'],
    ['Kosten', '3', '4', '5', '2'],
    ['Erreichbarkeit', '2', '3', '5', '3'],
    ['Platz für Camping', '2', '5', '2', '4'],
    ['Lärmschutz', '3', '4', '2', '5'],
    ['Atmosphäre', '1', '5', '2', '5'],
    ['Ergebnis (gewichtet)', '', '45', '37', '40'],
  ];
  b.table(40, 130, rows, 1240, [1.4, 0.7, 1.2, 1.2, 1.2], 'both');
  const h = 130 + b.last().h;
  b.sticky(40, h + 30, 'Entscheidung: …', '#c9e14a', 170);
  b.sticky(230, h + 30, 'Offene Frage: Genehmigung Option A?', '#ffb3d1', 170);
  b.frame(0, 0, 1320, h + 240, 'Entscheidungsmatrix');
  return b.objects;
}

export const TEMPLATES: Template[] = [
  { id: 'kanban', name: 'Kanban', desc: 'Aufgaben als Karten: offen, in Arbeit, erledigt.', category: 'Planung', build: kanban },
  { id: 'retro', name: 'Retrospektive', desc: 'Gut, schlecht, Ideen – gemeinsam zurückblicken.', category: 'Ideen', build: retro },
  { id: 'mindmap', name: 'Mindmap', desc: 'Ein Thema mit Zweigen. Tab = Unterthema, Enter = gleiche Ebene.', category: 'Ideen', build: mindmap },
  { id: 'flow', name: 'Flussdiagramm', desc: 'Abläufe mit Entscheidungen und Schleifen.', category: 'Abläufe', build: flow },
  { id: 'brainstorm', name: 'Brainstorming', desc: 'Eine Frage in der Mitte, Ideen rundherum.', category: 'Ideen', build: brainstorm },
  { id: 'eventplan', name: 'Eventplanung-Zeitleiste', desc: 'Zwölf Wochen bis zum Fest: Spuren für Orga, Programm, Werbung, Technik, Aufbau.', category: 'Planung', build: () => eventTimeline() },
  { id: 'week', name: 'Wochenplan', desc: 'Montag bis Sonntag auf einen Blick.', category: 'Planung', build: week },
  { id: 'swot', name: 'SWOT-Analyse', desc: 'Stärken, Schwächen, Chancen und Risiken.', category: 'Planung', build: swot },
  { id: 'festival', name: 'Veranstaltungs-Ablauf', desc: 'Aufbau, Veranstaltung und Abbau Schritt für Schritt.', keywords: ['festival', 'event', 'aufbau', 'abbau'], category: 'Events', build: festival },
  { id: 'shifts', name: 'Schichtplan', desc: 'Bar, Einlass, Awareness und Technik nach Zeiten.', category: 'Events', build: shifts },
  { id: 'siteplan', name: 'Lageplan', desc: 'Raster mit Koordinaten und Bausteinen zum Platzieren.', category: 'Events', build: siteplan },
  // Festival & Veranstaltungen
  { id: 'dayplan', name: 'Ablaufplan Veranstaltungstag', desc: 'Running Order eines Tages: Bühnen, Umbau, Einlass und Ansagen.', category: 'Events', keywords: ['running order', 'timetable', 'zeitplan', 'tagesablauf', 'festival', 'event', 'veranstaltung'], build: dayplan },
  { id: 'buildshifts', name: 'Schichtplan Aufbau & Abbau', desc: 'Aufbau- und Abbau-Schichten mit Aufgabe, Leitung und freien Plätzen.', category: 'Events', keywords: ['helfer', 'schichten', 'crew', 'event', 'veranstaltung'], build: buildShifts },
  { id: 'awareness', name: 'Awareness-Konzept', desc: 'Leitbild, Team, Rückzugsort, Schulung und Ablauf bei Vorfällen.', category: 'Events', keywords: ['sicherheit', 'schutzkonzept', 'safer space', 'event', 'veranstaltung'], build: awareness },
  { id: 'stageplot', name: 'Bühnenplan', desc: 'Aufstellung auf der Bühne mit Monitoren, Mikros, Strom und Kanalliste.', category: 'Events', keywords: ['stage plot', 'stageplot', 'technik', 'kanalliste', 'band', 'lageplan'], build: stagePlot },
  { id: 'briefing', name: 'Helfer-Briefing', desc: 'Ablauf, Aufgaben, Sicherheit und Kontakte für die Schicht.', category: 'Events', keywords: ['helfer', 'einweisung', 'crew', 'event', 'veranstaltung'], build: briefing },
  { id: 'festretro', name: 'Nachbesprechung', desc: 'Je Bereich: lief gut, verbessern, fürs nächste Mal merken.', category: 'Events', keywords: ['retro', 'retrospektive', 'auswertung', 'nachbereitung', 'festival', 'event', 'veranstaltung'], build: festRetro },
  { id: 'budget', name: 'Budget-Übersicht', desc: 'Ausgaben und Einnahmen mit Plan, Ist und Differenz.', category: 'Events', keywords: ['finanzen', 'kosten', 'finanzplan', 'geld', 'event', 'veranstaltung'], build: budget },
  // Methoden
  { id: 'startstop', name: 'Start, Stop, Continue', desc: 'Retro in drei Spalten: anfangen, lassen, beibehalten.', category: 'Ideen', keywords: ['retro', 'retrospektive', 'feedback', 'team'], build: startStop },
  { id: 'cluster', name: 'Brainstorming-Cluster', desc: 'Ideen sammeln und in benannte Gruppen sortieren.', category: 'Ideen', keywords: ['brainstorming', 'affinity', 'gruppieren', 'ideen sortieren'], build: cluster },
  { id: 'backlog', name: 'Kanban mit Backlog', desc: 'Backlog, diese Woche, in Arbeit (mit Limit) und erledigt.', category: 'Planung', keywords: ['kanban', 'aufgaben', 'sprint', 'todo', 'board'], build: backlog },
  { id: 'eisenhower', name: 'Eisenhower-Matrix', desc: 'Aufgaben nach dringend und wichtig in vier Felder sortieren.', category: 'Planung', keywords: ['prioritäten', 'priorisieren', 'dringend', 'wichtig', 'matrix'], build: eisenhower },
  { id: 'tows', name: 'SWOT mit Strategien', desc: 'Stärken und Schwächen gegen Chancen und Risiken: vier Strategie-Felder.', category: 'Planung', keywords: ['swot', 'tows', 'strategie', 'analyse'], build: tows },
  { id: 'personas', name: 'Personas', desc: 'Drei typische Menschen mit Zielen, Frust und Zitat.', category: 'Ideen', keywords: ['zielgruppe', 'nutzer', 'gäste', 'ux'], build: personas },
  { id: 'journey', name: 'User-Journey', desc: 'Phasen eines Besuchs: Tun, Denken, Schmerzpunkte, Chancen und Gefühl.', category: 'Abläufe', keywords: ['customer journey', 'kundenreise', 'erlebnis', 'ux'], build: journey },
  { id: 'okr', name: 'OKR', desc: 'Ziele mit messbaren Schlüsselergebnissen und Maßnahmen.', category: 'Planung', keywords: ['ziele', 'objectives', 'key results', 'kennzahlen', 'quartal'], build: okr },
  { id: 'decision', name: 'Entscheidungsmatrix', desc: 'Optionen nach gewichteten Kriterien bewerten.', category: 'Planung', keywords: ['bewertung', 'vergleich', 'nutzwertanalyse', 'kriterien', 'tabelle'], build: decision },
];
