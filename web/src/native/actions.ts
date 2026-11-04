// Sammel-Import aller Web-Aktionen der native App (docs/contract.md §8.12). Angelegt von F1 mit **allen** Dateien der
// Pakete P1–P9 (docs/native_paritaet_audit.md §4) – jedes Paket füllt nur seine eigene Datei, diese hier ändert keiner.
// Importiert vom Server (server/src/native/web-impl.ts); der Browser lädt sie nicht.
import './dev'; // F1: Sandbox-Aktion dev.note
import '../board/ops/native'; // P1: core.group, core.ungroup, core.align, core.distribute
import '../features/tools/native'; // P1: tools.layerStep, tools.pasteStyle
import '../features/structure/native'; // P3: card.desc, structure.toCard, structure.template, structure.paste
import '../features/structure/table/native'; // P3: table.*
import '../features/structure/frames/native'; // P4: frames.reorder
import '../features/tools/native-view'; // P4: tools.settings
import '../features/collab/native'; // P5: collab.vote.*, collab.timer.*, collab.commentMove
import '../features/documents/native'; // P7: documents.page, documents.addPage, documents.expand
import '../features/richtext/native'; // P8: richtext.whole, richtext.toggleTask
import '../features/structure/timeline/native'; // P9: timeline.*
import '../features/tools/native-organize'; // Q3: tools.cluster, tools.replace, tools.convert
import '../features/shapes/stack/native'; // Q2: shapes.stackDrop, shapes.stackCycle, shapes.stackSpread, shapes.stackTake

export { nativeAction, nativeActionList } from './registry';
