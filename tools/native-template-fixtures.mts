// Schreibt docs/native_fixtures/web/templates.json und structure.json (Referenzwerte: Kartenhöhe, Tabellen, „Einfügen
// als …“ – die App vergleicht ihre Nachrechnung damit). templates.json: die Objekte jeder Vorlage der Galerie (templates/catalog.ts), wie
// der Browser sie baut – für die Vorschaubilder der Vorlagen-Galerie in der Flutter-App (Paket P3, Audit I29). Die App
// zeichnet sie mit ihrem eigenen Painter; eingefügt wird immer über die Web-Aktion `structure.template` (frisch gebaut).
// IDs sind feste Nummern je Vorlage (`<vorlage>-1` …, Bezüge umgeschrieben), Daten (Fälligkeit, Zeitleiste) relativ zum
// festen Tag 2026-01-05, damit die Datei stabil bleibt (server/test/native-constants.test.ts prüft sie mit).
// Aufruf (im Stachel-Repo):
//   server/node_modules/.bin/tsx --tsconfig web/tsconfig.json tools/native-template-fixtures.mts
// danach mit dem Dart-Generator der App übernehmen (packages/stachel_board/tool/gen_web_constants.dart).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TEMPLATES_FILE = path.join(ROOT, 'docs/native_fixtures/web/templates.json');
export const STRUCTURE_FILE = path.join(ROOT, 'docs/native_fixtures/web/structure.json');
const { buildTemplateFixtures, buildStructureReferences } = await import('./native-template-fixtures-data.mts');
fs.mkdirSync(path.dirname(TEMPLATES_FILE), { recursive: true });
fs.writeFileSync(TEMPLATES_FILE, `${JSON.stringify(buildTemplateFixtures())}\n`);
fs.writeFileSync(STRUCTURE_FILE, `${JSON.stringify(buildStructureReferences(), null, 1)}\n`);
for (const f of [TEMPLATES_FILE, STRUCTURE_FILE]) {
  console.log(`geschrieben: ${path.relative(ROOT, f)} (${Math.round(fs.statSync(f).size / 1024)} KB)`);
}
