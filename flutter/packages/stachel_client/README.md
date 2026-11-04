# stachel_client

App-Schicht des nativen Stachel-Boards für Flutter: Board-Liste (`StachelHomeScreen`), Board-Bildschirm mit Kommentaren,
Fotos, Dokumenten, Teilen, Offline-Boards und Teilen-Ziel. Die Stachel-App benutzt das Paket, ebenso jede **Host-App**
einer Organisation, die eine Stachel-Instanz im Modus `org` anbindet (Vertrag `docs/contract.md` §1, §8).

Das Paket kennt keine bestimmte Organisation. Alles Eigene (Vorlagen, Objekt-Aktionen, Anmelde-Helfer, Aussehen) bringt
die Host-App über die Erweiterungspunkte unten mit.

## Einbinden

```dart
class MyOrgStachelClient extends StachelClient {
  MyOrgStachelClient(this.api) {
    Sk.style = myOrgStachelStyle;      // Aussehen (StachelStyle)
    stachelOrgName = 'Beispielverein'; // Name in den gemeinsamen Fehlertexten
  }
  final MyOrgApi api;

  @override String get base => 'https://board.example.org';
  @override http.Client get httpClient => api.httpClient;
  @override String get appName => 'Beispielverein-App';   // „Bitte die … aktualisieren“
  @override String? get loginKey => api.token;             // bindet gespeicherte Sitzung, Liste, Posteingang
  @override Future<String> newSession(String base) => …;   // POST {base}/api/auth/app-session mit dem Org-Token → sts_…
  @override void loginLost(BuildContext context, {String? message}) => …; // zurück zur eigenen Anmeldung
  @override Future<void> openInBrowser({String? board, String? object, ExternalLauncher launcher = launchExternal}) => …;

  @override BoardRegistry get registry => myOrgRegistry;   // s. u.
  @override Object? get services => api;                   // für die eigenen Einträge
  @override List<Widget> homeActions(BuildContext context) => [ /* z. B. „Am Computer anmelden“ */ ];
}
```

`clientId` bleibt `null`: Das Feld `hello.client` fehlt dann, der Server behandelt die App als Org-App (`org`,
Mindestversion `minApps.org`). Die Stachel-App setzt `stachel`.

## Erweiterungspunkte

| Punkt | Wofür | Beispiel |
|---|---|---|
| `StachelClient.registry` | eigene Werkzeuge, Kontextleisten-Einträge, Objekt- und Board-Menüpunkte | „Als Aufgabe anlegen“ an Notizen und Karten |
| `mindmapTemplateTool(...)` (stachel_board) | Mindmap-Vorlage unter „Weitere Werkzeuge“ | Planungs-Mindmap der Organisation |
| Server: `STACHEL_TEMPLATES_DIR` | Vorlagen der Galerie für alle (Web und Apps) | Ablauf-, Schicht- und Lagepläne der Organisation |
| `StachelClient.services` | eigene Dienste der App, erreichbar über `StachelClientHost.client.services` | API-Client der Organisation |
| `StachelClient.homeActions` | Knöpfe in der Leiste der Board-Liste | „Am Computer anmelden“ (QR scannen, bestätigen) |
| `stachelOrgName` | Name der Organisation in den Fehlertexten (`invalid_token`, `pending`, `org_unreachable`) | „Deine Anmeldung bei Beispielverein ist abgelaufen …“ |
| `Sk.style` / `Sk.darkStyle` | Farben, Schriften, harte Schatten | eigener Look |
| `StachelClient.blockedPeopleInAccount` | „Blockierte Personen“ auf der eigenen Kontoseite statt in der Board-Liste | – |

### Registry: eigene Einträge

Die Registry eines Board-Bildschirms entsteht einmal aus dem Paket (`registerStachelAppFeatures(standardBoardRegistry())`)
plus den eigenen Einträgen. Eigene IDs bekommen ein Präfix der App (`myorg.…`), damit sie nicht mit denen des Pakets
kollidieren; `order` legt die Stelle fest wie im Web.

```dart
final BoardRegistry myOrgRegistry = registerMyOrgExtras(registerStachelAppFeatures(standardBoardRegistry()));

BoardRegistry registerMyOrgExtras(BoardRegistry r) {
  // Objekt-Aktion in der Kontextleiste (gewählte Notiz/Karte)
  r.defineContextAction(ContextActionDef(
    id: 'myorg.task',
    order: 87,
    appliesTo: (c, ui) => ui.host is StachelClientHost && c.single?.type == 'sticky',
    items: (context, ui, c) => [
      CtxItem(key: 'myorgCtxTask', label: 'Als Aufgabe', icon: Icons.add_task,
          onTap: (context, ui) => createTask(context, ui, c.single!)),
    ],
  ));
  // dasselbe im Objekt-Menü (langes Drücken)
  r.defineMenuItem(MenuItemDef(
    id: 'myorg.task',
    on: MenuTarget.object,
    order: 76,
    entry: (ui, at) => MenuEntry(key: 'myorgMenuTask', label: 'Als Aufgabe anlegen', icon: Icons.add_task,
        onSelect: (context, ui) => createTask(context, ui, ui.editor.single!)),
  ));
  // Mindmap-Vorlage unter „Weitere Werkzeuge“
  r.defineTool(mindmapTemplateTool(id: 'myorg.mindmapPlan', template: planMindmap, subtitle: 'Programm, Orga, Technik'));
  return r;
}

const planMindmap = MindTreeSpec('Sommerfest', children: [
  MindTreeSpec('Programm', children: [MindTreeSpec('Bands'), MindTreeSpec('Workshops')]),
  MindTreeSpec('Technik', side: 'l', children: [MindTreeSpec('Strom')]),
]);
```

Im Eintrag liefert `ui.host` (ein `StachelClientHost`) `client` (mit `services`), `boardId`, `boardTitle` und
`stachelBase` – z. B. für einen Rücklink `stachelBoardUrl(boardId, objectId: o.id, base: stachelBase)`. Eigene Felder
an Objekten tragen ein Modul-Präfix (`myorg.taskId`, Vertrag §8.6); der Server und das Paket lassen sie unverändert.

### Vorlagen der Galerie

Die Galerie zeigt die Vorlagen des Web-Katalogs (Konstanten des Pakets), die **Vorlagen der Instanz** und die eigenen
Vorlagen („Meine Vorlagen“, `OwnTemplatesHost`). Vorlagen einer Organisation gehören auf den Server der Instanz – dann
sehen Web und Apps sie gleich: JSON-Dateien in `STACHEL_TEMPLATES_DIR` (Standard `<DATA_DIR>/templates`), Kategorie aus
`STACHEL_TEMPLATES_CATEGORY` (Vertrag §3 „Vorlagen der Instanz“). Die Galerie holt sie über `InstanceTemplatesHost`
(`GET /api/templates/instance`, der Board-Bildschirm des Pakets bedient das schon) und zeigt die Kategorie vor „Meine
Vorlagen“, nur wenn es Vorlagen gibt; Einfügen wie eigene Vorlagen (`structure.insert`). In der App selbst kommen nur
Mindmap-Vorlagen über `mindmapTemplateTool` hinzu.

### Anmelde-Helfer

Die Anmeldung gehört der Host-App. Was der Server dafür anbietet (Vertrag §2, §8.1):

- App-Sitzung: `POST /api/auth/app-session` mit `Authorization: Bearer <Org-Token>` → `sts_…` (in `newSession`).
- Browser anmelden („Am Computer anmelden“): QR `<base>/qr/<code>` scannen, `GET /api/auth/qr/<code>/info` zeigen,
  `POST /api/auth/qr/approve {code}` mit dem Org-Token. Dieselbe Bestätigung nutzt die Stachel-App: „Mit der App deiner
  Organisation bestätigen“ öffnet `<base>/qr/<code>` – die Host-App übernimmt diesen Link als App-Link und bestätigt.
- Einmal-Link für den Browser: `POST /api/auth/app-code` → `/auth/app?code=…`.

### Plattform-Kanäle

Teilen-Ziel und Zwischenablage laufen über die MethodChannels `stachel/share` und `stachel/clipboard`; die
`MainActivity` jeder App muss sie bedienen (Vorlage: `flutter/app/android/.../MainActivity.kt`).
