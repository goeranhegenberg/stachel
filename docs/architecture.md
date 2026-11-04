# Stachel – Architektur der Web-App und Erweiterungspunkte

Die Web-App (`web/src`) ist in einen **Kern** und **Feature-Module** geteilt. Feature-Module tragen sich beim Import in
**Register** ein: Objekttypen, Formen, Werkzeuge, Kontextleiste, Tastenkürzel, Menüs, Panels. Sie brauchen dafür keine
Änderung an den gemeinsamen Dateien (`Editor.tsx`, `ObjectLayer.tsx`, `Overlay.tsx`, `editor.css`, Register-Kern).
Datenvertrag: `docs/contract.md` (§4 Yjs-Dokument inkl. Rich-Text, §5 Feature-Module).

## 1. Aufbau

| Ordner | Inhalt |
|---|---|
| `board/` | Daten ohne React: `store.ts` (Yjs, Schnappschüsse, Undo, Y-Erweiterungen), `types.ts` (Typ-Angaben für Store/Hit-Test/Kopieren), Geometrie, Verbinder, Zwischenablage, `ops/` |
| `editor/ext/` | **Register-Kern**: `types.ts` (Schnittstellen + `EditorApi`), `registry.ts` (`define*`), `hooks.ts`, `toolOptions.ts`, `keys.ts`, `setup.ts` |
| `editor/core/` | Kern-Registrierungen = bisheriges Verhalten (Typen, Formen, Werkzeuge, Kontextleiste, Kürzel, Menüs, Dialoge) |
| `editor/text/` | Text-Engine (Klartext; Rich-Text ersetzt sie) |
| `editor/` | Gerüst: `Editor.tsx` (Kamera, Gesten, Tastatur, Zwischenablage), `ObjectLayer.tsx`, `Overlay.tsx`, `ContextBar.tsx`, `Toolbar.tsx`, `Minimap.tsx` |
| `features/<modul>/` | Feature-Module; `features/index.ts` lädt alle (eine Zeile je Modul) |

**Ladereihenfolge** (`editor/ext/setup.ts`): erst `editor/core`, dann `features`. Ein Eintrag mit **gleicher id ersetzt**
den früheren – so lässt sich Kern-Verhalten austauschen, ohne Kern-Dateien anzufassen (z. B. `format.bold` im Rich-Text).

Alles, was im Board gespeichert wird, liegt im Yjs-Dokument (live für alle, Undo über den Store). Lokale
Einstellungen (Werkzeugfarbe, offenes Panel) liegen im Speicher bzw. `localStorage` (immer in try/catch).

## 2. Regeln für Feature-Module

- Eigene Dateien nur unter `web/src/features/<modul>/`, `web/e2e/<modul>*.spec.ts`, `docs/features/<modul>.md`,
  Screenshots `docs/screenshots/<modul>-*.png`. Einstieg `features/<modul>/index.ts` (registriert sich beim Import).
- CSS in `features/<modul>/<modul>.css` (aus `index.ts` importieren), Klassen mit Präfix `<modul>-`. Bestehende
  Klassen (`panel`, `ctx-btn`, `ctx-group`, `ctx-chip`, `swatch`, `tb-btn`, `fly-btn`, `btn btn--primary`) dürfen genutzt werden.
- Neue Objektfelder/-typen/Formen per **Module-Augmentation** in `features/<modul>/model.ts` (Abschnitt 4.11), nicht in
  `shared/protocol.ts`. Y-Strukturen und Awareness-Felder mit Präfix `<modul>.`; alles in `docs/features/<modul>.md`.
- Ids der Registrierungen mit Präfix: `collab.comment`, `tools.eraser` … (Kern: `core.*`, `edit.*`, `view.*`, `format.*`).
- Gemeinsame Dateien nicht ändern (Abschnitt 7). Fehlt ein Erweiterungspunkt: Kern-Eintrag mit gleicher id ersetzen
  oder den Bedarf im Bericht melden.
- Alte Boards müssen laden: neue Felder sind optional, fehlende Strukturen gelten als leer.
- Neue npm-Pakete exakt pinnen. Parallele `npm install` im selben Ordner kollidieren: **nur `richtext`** installiert
  (Tiptap/ProseMirror/y-prosemirror). Andere Module kommen ohne neue Pakete aus oder melden den Bedarf.
- Tests: Unit-Tests `features/<modul>/*.test.ts` (Vitest), E2E `e2e/<modul>.spec.ts` mit eigenem Port:
  `PW_PORT=519x npx playwright test <modul> --workers=1` (richtext 5191, shapes 5192, collab 5193, structure 5194,
  tools 5195; Specs mit Sync-Server starten ihn über `e2e/syncServer.ts` auf freiem Port). Im Offline-Modus (`/?offline=1`) gibt es `window.__stachel`
  mit `store`, `api()`, `ext` (Register) und `h` (`React.createElement`), siehe `e2e/ext.spec.ts`.

## 3. Editor-API

Alle Handler und Slot-Komponenten bekommen `api: EditorApi` (`editor/ext/types.ts`). Auszug:

| Bereich | Methoden |
|---|---|
| Lesen | `snapshot()`, `selection()`, `selected()`, `tool()`, `editingId()`, `camera()`, `viewSize()`, `presenting()` |
| Präsentation | `startPresent(index)`, `stopPresent()` (Übergabe, `docs/features/private.md` §7) |
| Treffer | `hitTest(p, skip?)` (Raster-Index), `queryRect(r)`, `bounds(o)`, `toWorld(p)`, `toScreen(p)`, `pointerWorld()`, `viewCenter()` |
| Auswahl/Werkzeug | `setSelection(ids)`, `setTool(id)`, `startEditing(o)`, `editNext(back)` |
| Ändern (Undo-Schritt) | `create(obj, { select, edit })`, `placeAt(type, p)`, `patchSelection(fn)`, `insertObjects(objs, at)`, `deleteSelection()`, `duplicate()`, `group()`, `toggleLock()`, `applyArrange(fn)`, `addImages(files)` … |
| Kamera | `setCamera(c)`, `animateCamera(c)`, `fitTo(rect)`, `fitAll()`, `zoomToSelection()`, `centerOn(p)` |
| Oberfläche | `setDraft(d)`, `setHover(id)`, `toast(text)`, `openModal(id, props)`, `openSidebar(id)` |
| Daten | `store` (BoardStore), `session` (BoardSession: Awareness, Bilder) |

Hooks (`editor/ext/hooks.ts`): `useSnapshot(api)`, `useY(yType, read)`; Werkzeug-Optionen: `useToolOption(tool, key, def)`.

## 4. Erweiterungspunkte mit Beispiel

### 4.1 Objekttyp-Register – `defineObjectType`

Pro Typ: Darstellung, Detailstufe, Hit-Test-Rolle, Grenzen, Standardgröße, Bearbeiten-Einstieg, Griffe, Kontextleisten-
Einträge, Kopieren. Kern-Typen: `editor/core/objectTypes.tsx`.

```tsx
defineObjectType({
  type: 'card',                       // per Module-Augmentation in ObjectTypeMap (4.11)
  label: 'Karte',
  View: ({ o, editing, cb }) => (
    <div className="obj structure-card" data-id={o.id} data-type="card" style={placeStyle(o)}>…</div>
  ),
  simpleStyle: (o) => ({ background: o.color ?? '#fff' }),   // weit herausgezoomt
  defaultSize: { w: 320, h: 180 },
  create: (p) => ({ type: 'card', x: p.x - 160, y: p.y - 90, w: 320, h: 180, text: '' }),
  edit: 'text',                       // Tippen/Enter/Doppelklick bearbeiten ('title', 'label')
  textual: true, palette: SHAPE_FILLS, rotatable: true, anchorable: true, addHandles: true,
  handles: () => ['nw', 'ne', 'se', 'sw'],
  hit: 'object',                      // 'background' wie Rahmen, 'none' nur DOM-Treffer
  remap: (clone, o, ctx) => ({ ...clone, parent: o.parent && ctx.map(o.parent) }), // Bezüge beim Kopieren
  actions: [/* ContextActionDef, s. 4.4 */],
});
```

Wichtig: Das Wurzel-Element trägt `className="obj"`, `data-id` und `data-type` (Auswahl, Ziehen, Kontextmenü).
Weitere Datenangaben: `sibling: (o) => Patch` (Kopie daneben per Plus-Griff/Tab, z. B. Karte ohne Beschreibung und Status),
`invisible: (o) => boolean` (gerade nicht zu sehen, z. B. eingeklappter Mindmap-Zweig; zusammen mit dem Feld `hidden` aus
tools über `isInvisible(o)` in `board/types.ts` – Abstimmung, Reaktionen und Kommentar-Pins lassen solche Objekte aus).
`derive` für Typen, deren Geometrie von anderen Objekten abhängt (wie Verbinder); `container: true` für Rahmen-artige
Typen. **Kern-Typ erweitern:** `defineObjectType({ ...objectTypes.get('frame')!, View: MeinRahmen })`.

### 4.2 Formen – `defineShapeKind`

```tsx
defineShapeKind({
  kind: 'star', label: 'Stern', order: 50, icon: <IconStar size={20} />,
  path: (w, h, inset) => starPath(w, h, inset),       // SVG-Pfad in Objektkoordinaten
  insets: (w, h) => [h * 0.3, w * 0.3, h * 0.25, w * 0.3],
  outline: (w, h) => starPoints(w, h),                // Verbinder docken am Umriss an
  simpleClip: 'polygon(…)',                           // Fläche bei kleiner Darstellung
});
```

Erscheint automatisch im Form-Werkzeug (Untermenü) und in der Kontextleiste einer Form.

### 4.3 Werkzeug-Register – `defineTool`

Toolbar-Eintrag, Kürzel, Untermenü, Zeiger-Handler. Auswählen und Hand steuert der Editor; Kern: `editor/core/tools.tsx`.

```tsx
defineTool({
  id: 'tools.eraser', label: 'Radierer', order: 75, key: 'e', Icon: IconEraser, cursor: 'crosshair',
  Options: () => <EraserSizes />,                     // Untermenü, solange aktiv (useToolOption)
  down: (e, api) => {
    const hit = new Set<string>();
    return {
      kind: 'erase',
      // Stiftstriche haben Hit-Rolle 'none' → über queryRect statt hitTest suchen
      move: (m) => api.queryRect({ x: m.world.x - 4, y: m.world.y - 4, w: 8, h: 8 }).forEach((o) => o.type === 'pen' && hit.add(o.id)),
      up: () => { api.store.stopCapturing(); api.store.remove(hit); },
      cancel: () => hit.clear(),                      // Esc, zweiter Finger
    };
  },
});
```

Entwürfe während der Geste: `api.setDraft({ kind: 'world', node: <path …/> })` (SVG, Weltkoordinaten) bzw.
`{ kind: 'screen', node }`. Knöpfe mit `action: (api) => …` führen nur eine Aktion aus (wie „Bild einfügen“).
Reihenfolge über `order` (Kern 10–80, „Bild einfügen“ 100). Am Handy passen 9 Knöpfe in die Leiste, weitere
Werkzeuge erscheinen automatisch hinter „Weitere Werkzeuge“. `phone: 'hide'` blendet ein Werkzeug am Handy aus (Hand:
ein Finger verschiebt dort ohnehin), `phone: 'more'` stellt es dort immer hinter „Weitere Werkzeuge“.

### 4.4 Kontextleiste – `defineContextAction`

Gruppen der Leiste über der Auswahl, sortiert nach `order` (Kern: 10 Farbe, 20 Form, 30 Schrift, 40 Format,
50 Verbinder, 60 Stift, 70 Ausrichten, 90 Allgemein). Kern: `editor/core/contextActions.tsx`.

```tsx
defineContextAction({
  id: 'collab.vote', order: 80,
  when: (c) => !c.locked,
  Bar: (p) => (
    <div className="ctx-group">
      <PopBtn open={p.pop === 'vote'} onToggle={p.togglePop('vote')} label="Abstimmen">👍</PopBtn>
    </div>
  ),
  pops: { vote: { className: 'ctx-pop--row', label: 'Abstimmen', Body: (p) => <VoteChoices {...p} /> } },
});
```

`p.patch(fn)` schreibt einen Patch je ausgewähltem Objekt (ein Undo-Schritt), `p.choose(fn)` schließt danach das Popover.
Passt die Leiste nicht in die Breite (Tablet, Handy, Browser-Zoom), wandern ganze Einträge vom Ende her ins Menü „···“
(wie üblich); dort erscheinen Knöpfe als Kachel mit ihrem `aria-label` (ohne „(Strg …)“) als Namen. Ein Eintrag sollte daher
aus wenigen, beschrifteten Knöpfen bestehen (`aria-label` immer setzen). Popover öffnen auf der Seite mit mehr Platz.

### 4.5 Tastenkürzel – `defineShortcut`

```ts
defineShortcut({
  id: 'tools.search', keys: ['mod+f'], run: (api) => api.openModal('tools.search'),
  help: { group: 'Ansicht', keys: 'Strg F', label: 'Auf dem Board suchen', order: 85 },
});
```

Schreibweise `mod+shift+g`, `shift+Digit1`, `PageDown`, `?` (`mod` = Strg/⌘). `scope: 'editing'` gilt während der
Textbearbeitung, `'both'` immer; `late: true` erst nach „Tippen startet die Bearbeitung“ (druckbare Zeichen).
Einträge ohne `keys` erscheinen nur in der Kürzel-Übersicht. Werkzeug-Tasten kommen aus `defineTool({ key })`.

### 4.6 Menüs – `defineMenuItem`

```ts
defineMenuItem({ id: 'collab.comment', on: 'object', order: 75, item: (api, at) => ({ label: 'Kommentieren', shortcut: 'C', onSelect: () => startComment(api, at) }) });
defineMenuItem({ id: 'tools.exportPng', on: 'board', order: 10, item: (api) => ({ label: 'Als PNG exportieren', onSelect: () => exportPng(api) }) });
```

`on`: `'object'` (Rechtsklick auf Auswahl), `'canvas'` (leere Fläche), `'board'` (Knopf „···“ neben dem Board-Titel;
erscheint, sobald es einen Eintrag gibt). `sep: true` zieht eine Trennlinie davor. Untermenü: `items: MenuItem[]` statt
`onSelect` (am Rechner seitlich per Überfahren bzw. Pfeil rechts, am Handy aufgeklappt), z. B. „Ebene“ und „Ausrichten“.

### 4.7 Panel-Slots – `defineSlot`, `defineSidebarTab`, `defineModal`

```tsx
// Knopf/Anzeige oben rechts (vor den Anwesenden)
defineSlot({ id: 'collab.timer', slot: 'topbarRight', order: 10, Component: TimerButton });
// Kommentar-Pins über dem Board (Bildschirmkoordinaten): props = { api, cam, snap, selection, width, height }
defineSlot({ id: 'collab.pins', slot: 'overlay', order: 10, Component: CommentPins });
// Seitenleiste rechts mit Reitern; button: Knopf oben rechts (am Handy im Board-Menü)
defineSidebarTab({ id: 'collab.comments', title: 'Kommentare', order: 10, button: true, Icon: IconComment, Panel: CommentsPanel });
// Dialog: api.openModal('structure.templates', { … })
defineModal({ id: 'structure.templates', Component: ({ api, props, onClose }) => <TemplatesDialog … /> });
```

Slots: `topbarLeft` (nach Board-Titel und Rahmen-Knopf), `topbarRight`, `zoombar` (vor dem Kürzel-Knopf),
`world` (in der skalierten Welt-Ebene über den Objekten, Weltkoordinaten), `overlay` (über dem Board, Bildschirm).
`presenting: true` zeigt einen world/overlay-Slot auch in der Präsentation. Interaktive Elemente in `overlay`/`world`
stoppen `onPointerDown` selbst (`e.stopPropagation()`), sonst startet der Editor eine Geste. Am Handy ist oben wenig
Platz: Slots dort mit `@media (max-width: 700px)` auf ein Symbol beschränken.

**Dateien** – `defineFileHandler`: weitere Dateiarten neben Bildern. Dateiauswahl („Bild einfügen“), Ablegen und Strg V
geben passende Dateien an das Modul, `accept` ergänzt die Dateiauswahl (Beispiel `documents`: PDF).

```ts
defineFileHandler({ id: 'documents.pdf', accept: 'application/pdf,.pdf', match: isPdfFile, add: (files, api, at) => addPdfs(files, api, at) });
```

### 4.8 Eigene Y-Strukturen (Doc-Erweiterungen)

```tsx
const comments = api.store.extMap<Y.Map<unknown>>('collab.comments');      // Undo inklusive
api.store.transact(() => comments.set(id, new Y.Map(Object.entries({ text, x, y, by: api.session.user.key }))));
const list = useY(comments, (m) => [...m.entries()].map(([id, c]) => ({ id, ...c.toJSON() })));
const timer = api.store.extMap('collab.timer', { undo: false });          // ohne Undo
```

Immer in `store.transact` schreiben (Origin `LOCAL_ORIGIN`), dann greift Strg Z. **Privat-Ablage** (privater Modus,
`docs/features/private.md`): `store.attachPrivate(doc)` hängt ein zweites Dokument ein (Schnappschuss = beides,
`isPrivate(id)`, `mapOf(id)`, `docOf(id)`, Rückgängig über beide); wer an einem Objekt-Y.Map direkt schreibt, nimmt
`store.mapOf(id)` und dessen `doc` statt `store.objects`/`store.doc`. `store.trackOrigin(o)` nimmt fremde
Origins auf. Objektfelder als eigener Y-Typ: `store.yField(id, name)`, `store.ensureYField(id, name, make)` und
`registerYField(name, codec)` (Lesekopie im Schnappschuss, Kopieren/Einfügen).

**Awareness** (flüchtig, nicht gespeichert): `api.session.setLocalField('collab.follow', userKey)`; andere lesen
`peer.extra['collab.follow']` aus `useSyncExternalStore(api.session.subscribe, api.session.getPeers)`.

### 4.9 Text-Engine (Rich-Text) – `setTextEngine`

Haftnotiz, Text, Form und Verbinder-Beschriftung zeigen und bearbeiten Text über `textEngine()` (`editor/text/engine.ts`):
`View` (Anzeige), `Edit` (Bearbeitung im Objekt, Klasse `editing`, meldet `cb.onTextChange`/`cb.onEditDone`),
`LabelEdit` (Beschriftung im Overlay), optional `typeInto` (Zeichen auf ausgewähltem Objekt).

```ts
// features/richtext/index.ts
setTextEngine({ View: RichView, Edit: RichEdit, LabelEdit: RichLabelEdit, typeInto: appendToContent });
registerYField('content', { toPlain: fragmentToJson, fromPlain: jsonToFragment });
defineShortcut({ ...shortcuts.get('format.bold')!, scope: 'board' });  // im Editor übernimmt ProseMirror Strg B
```

Vertrag (Feld `content`, Klartext-Spiegel `text`, Migration, Undo): `docs/contract.md` §4 „Rich-Text“.

### 4.9b Ersatz-Sitzung – `setSessionOverride`

Ein Modul kann vorübergehend ein anderes Dokument auf der Leinwand zeigen (Versions-Vorschau): `setSessionOverride({ live,
session, key })` aus `editor/ext/sessionOverride.ts`. `EditorPage` baut den Editor dann mit `session` neu auf (neuer `key`
= neuer Aufbau), die Live-Sitzung `live` bleibt verbunden; `null` schaltet zurück. Editor-Zustand (Kamera, Seitenleiste)
geht beim Neuaufbau verloren und muss vom Modul selbst wiederhergestellt werden (Beispiel: `features/versions`).

### 4.10 Kern-Daten je Typ (ohne React)

`defineObjectType` trägt die Datenangaben (`below`, `hit`, `dependent`, `move`, `remap`, `plainText`) in
`board/types.ts` ein. Dadurch kennt der Store den Typ (unbekannte Typen blendet er aus), Hit-Test, Verschieben,
Kopieren und Zwischenablage-Text richten sich danach.

### 4.11 Typen erweitern (Module-Augmentation)

```ts
// features/structure/model.ts
declare module '../../../../shared/protocol' {
  interface ObjectTypeMap { card: true; table: true }
  interface ShapeKindMap { star: true }               // (shapes)
  interface BoardObject { cells?: string[][]; parent?: string }
}
export {};
```

## 5. Feature-Modul → eigene Dateien

| Modul | Eigene Dateien | Schwerpunkt (Funktionen) | Erweiterungspunkte |
|---|---|---|---|
| **richtext** | `web/src/features/richtext/**`, `docs/features/richtext.md`, `web/e2e/richtext*.spec.ts`; als einziges Modul `web/package.json` + `package-lock.json` (Tiptap, y-prosemirror) | Rich-Text in Notiz/Text/Form/Beschriftung: Fett/Kursiv/Unterstrichen je Wort, Listen, Aufgaben, Links, Überschriften, Textfarbe/Markierung | `setTextEngine`, `registerYField('content')`, `store.trackOrigin`, Kontextleiste (Format-Gruppe ersetzen: `core.format`), Kürzel `format.*` ersetzen |
| **shapes** | `web/src/features/shapes/**`, `docs/features/shapes.md`, `web/e2e/shapes*.spec.ts` | Formen-Bibliothek (Stern, Sechseck, Pfeil, Wolke, Sprechblase, Zylinder, Flussdiagramm …), Formen-Panel, Pfeil-/Linienformen, Ecken-Radius | `defineShapeKind`, `defineSidebarTab`/Werkzeug-Untermenü (`shape` ersetzen), Kontextleiste, ggf. `defineObjectType` |
| **collab** | `web/src/features/collab/**`, `docs/features/collab.md`, `web/e2e/collab*.spec.ts` | Kommentare mit Pins und Erwähnungen, Abstimmung, Reaktionen/Emojis, Folgen-Modus („Allen folgen lassen“), Timer, Anwesenheitsliste, Cursor-Chat | `extMap('collab.*')`, `setLocalField`, Slots `overlay`/`world`/`topbarRight`, `defineSidebarTab`, Kontextleiste, Menüs, Kürzel |
| **structure** | `web/src/features/structure/**`, `docs/features/structure.md`, `web/e2e/structure*.spec.ts`; dazu `web/src/editor/interaction/Frames.tsx` (Exporte `FramesPanel`, `PresentBar`, `framesInOrder` behalten) | Rahmen (Inhalt abschneiden, Vorlagen, Rasterrahmen), Vorlagen, Tabellen, Mindmap, Kanban/Karten, Ebenen-/Gliederungs-Panel | `defineObjectType` (neue Typen, `frame` erweitern), `insertObjects`, `defineModal`, `defineSidebarTab`, Menüs |
| **documents** | `web/src/features/documents/**`, `docs/features/documents.md`, `web/e2e/documents.spec.ts` (+ `e2e/fixtures/`), `server/src/documents.ts`; Paket `pdfjs-dist` | PDF als Dokument: Seiten blättern (für alle), Vollbild, Herunterladen, alle Seiten aufs Board | `defineObjectType`, `defineFileHandler`, Slot `world`, `defineModal`, Kontextleiste, Menüs, `registerYField('docPages')` |
| **mcp** | `web/src/features/mcp/**`, `docs/features/mcp.md`, `e2e/tests/mcp.spec.ts`; dazu `mcp/**` (MCP-Server), `server/src/api-tokens.ts` | KI-Zugang: persönliche API-Tokens anlegen/widerrufen, fertige Einrichtung für Claude Code/Desktop | Board-Menü (`on: 'board'`), `defineModal`; `McpAccessPanel` auch außerhalb des Editors nutzbar |
| **private** | `web/src/features/private/**`, `docs/features/private.md`, `e2e/tests/private.spec.ts`; Server `server/src/private-mode.ts` | Privater Modus: verdeckt schreiben (Privat-Ablage je Person), Platzhalter, Aufdecken mit Countdown | `setCreateRoute`/`attachPrivate`, Slots `world`/`overlay`, Board-Menü, `defineModal` |
| **tools** | `web/src/features/tools/**`, `docs/features/tools.md`, `web/e2e/tools*.spec.ts` | Radierer, Textmarker, Laserpointer, Stempel/Emoji, Suche auf dem Board (Strg F), Export (PNG/SVG/PDF), Raster/Einrasten an/aus | `defineTool`, `defineShortcut`, Board-Menü (`on: 'board'`), Slots (`zoombar`, `overlay`), `defineModal` |

## 6. Ladeverhalten (Code-Splitting)

`App.tsx` lädt Anmeldung, Übersicht und Editor als eigene Pakete (`React.lazy`); nach der Anmeldung wird der Editor im
Hintergrund vorgeladen, bei einer Board-Adresse schon während der Anmeldeprüfung. Mit dem Editor kommen alle
Feature-Module (`features/index.ts`). Den Tiptap-Editor (`richtext/RichEdit`) fordert `App.tsx` gleichzeitig mit dem
Editor-Paket an; `EditorPage` baut die Sync-Verbindung sofort auf, zeigt den Editor aber erst, wenn Tiptap da ist
(`TextEngine.ready`, sonst gingen beim ersten Tippen Zeichen verloren). Weitere schwere Teile laden erst bei Bedarf: Export samt PDF-Schreiber
(`tools/export/*`, beim Öffnen des Dialogs bzw. für das Vorschaubild), Icon-Satz (`shapes/iconSet`). React und Yjs liegen
in eigenen Paketen (`vite.config.ts`, `codeSplitting.groups`), damit sie im Browser-Cache bleiben. Neue schwere
Abhängigkeiten per `import()` nachladen.

## 7. Gemeinsame Dateien (nicht ändern)

`web/src/editor/Editor.tsx`, `ObjectLayer.tsx`, `Overlay.tsx`, `ContextBar.tsx`, `Toolbar.tsx`, `Minimap.tsx`,
`editor.css`, `editor/ext/**`, `editor/core/**`, `editor/text/**`, `web/src/board/**`, `web/src/ui/**`,
`web/src/features/index.ts`, `shared/protocol.ts`, `docs/contract.md`, `docs/architecture.md`, `web/e2e/helpers.ts`,
`playwright.config.ts`, `server/**`. Kern-Verhalten ändern = Eintrag mit gleicher id in der eigenen Datei registrieren.
Was trotzdem eine Kern-Änderung braucht, kommt als Vorschlag in den Bericht (wird zentral eingebaut).
