# Fixtures „Import aus Miro“

Rohantworten der Miro-REST-API v2 je Board, so wie die Endpunkte sie liefern (JSON unverändert, nur personenbezogene
Werte neutralisiert). Gelesen von `load.ts` (→ `MiroBoardData` für `server/src/import/miro/map.ts`, Tests
`server/test/import-miro-*.test.ts`) und vom Fake-Server `tools/miro-fake.mts`.

Ein Unterordner je Board. `echt_workshop`, `echt_flowchart`, `echt_mindmap` sind **echte Antworten** eines Miro-Testkontos
(04.11.2026, bereinigt); `workshop`, `flowchart`, `mindmap` sind nach der OpenAPI-Spezifikation nachgebaut und decken
zusätzlich Fälle ab, die das Testkonto nicht hat (Miro-Docs, Tabellen-Ende eines Verbinders, zusätzliche Beschriftungen,
tiefe Mindmap, unbekannte Typen/Formen). Dateien:

| Datei | Endpunkt | Inhalt |
|---|---|---|
| `board.json` | `GET /v2/boards/{id}` | Board-Angaben (`id`, `name`, `description` …) |
| `items_1.json`, `items_2.json` … | `GET /v2/boards/{id}/items?limit=50&cursor=` | eine Datei je Seite (`{data, cursor?, limit, size, links, type}`), Reihenfolge = Seitenfolge |
| `connectors_1.json` … | `GET /v2/boards/{id}/connectors?limit=50&cursor=` | wie `items_N.json` |
| `tags.json` | `GET /v2/boards/{id}/tags` | `{data: [{id, title, fillColor, type}], …}` |
| `item_tags.json` | `GET /v2/boards/{id}/items/{item}/tags` je Objekt | zusammengefasst: `{"<itemId>": ["<tagId>", …]}` (auch `{"<itemId>": {"tags": [{id …}]}}` = Rohantwort erlaubt) |
| `groups.json` | `GET /v2/boards/{id}/groups` | `{data: [{id, type: "group", data: {items: [ids]}}], …}` |
| `mindmap_nodes_1.json` … (optional) | `GET /v2-experimental/boards/{id}/mindmap_nodes` | wie `items_N.json` |
| `experimental_shapes.json` (optional) | `GET /v2-experimental/boards/{id}/shapes/{item}` je Form, die `/items` als `isSupported: false` (ohne `data`/`style`) oder mit unbekanntem `shape` liefert | `{"<itemId>": <Antwort>}` |
| `docs.json` (optional) | `GET /v2/boards/{id}/docs/{item}?textContentType=html` | `{"<itemId>": "<html>"}` |

Regeln für neue bzw. echte Antworten: keine Tokens, keine signierten Datei-Adressen mit Query (nur die API-Adressen
`https://api.miro.com/v2/boards/…/resources/…` bleiben), Personen in `createdBy`/`modifiedBy`/`owner`/`assigneeId`
durch neutrale Werte ersetzen (`3458764500000000001`, „Person A“).

Was die echten Antworten zeigen (anders bzw. genauer als die Spec):

- Flussdiagramm-Formen kommen in `/v2/items` als `type: "shape"`, `isSupported: false`, **ohne** `data`/`style`; nur
  v2-experimental liefert `flow_chart_*`, der Text steckt dort in `<span style="color: rgb(…)"><p>…</p></span>`, Füllung
  und Rand haben dort Deckkraft `0.0` (map.ts zeigt sie sichtbar, Bericht `shape_opacity`). `/v2/shapes/{id}` → 400.
- Mindmap-Knoten stehen in `/items` als `mindmap_node` ohne Inhalt (`isSupported: false`); Inhalt nur über
  `mindmap_nodes` (`data.nodeView.data.content`, `isRoot`, `direction`), Kinder `relativeTo: parent_top_left` zum Elternknoten.
- Tabellen `data_table_format`, Freihand `paint` (`isSupported: false`), Kommentare gar nicht.
- Tags nur über `…/items/{id}/tags` (`{tags: [...]}`), kein `tagIds` am Objekt. Gruppen zusätzlich als `group.id` am Objekt.
- Haftnotizen: Quadrat 199 × 228, Rechteck 230 × 149,8; Texte ohne `height`; Verbinder-Enden immer als Prozentlage
  (`"100%"`), `captions[].content` auch ohne HTML; Kartentitel ohne HTML.
