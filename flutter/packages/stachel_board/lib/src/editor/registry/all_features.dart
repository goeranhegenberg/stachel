// All feature registers in one place (parity audit §4, created in F2). Every line belongs to one package; the
// packages never change this file – they only fill their own `features/<paket>/register.dart`.

import '../../features/core/register.dart';
import '../../features/mindmap/register.dart';
import '../../features/arrange/register.dart';
import '../../features/clipboard/register.dart';
import '../../features/snapping/register.dart';
import '../../features/shapes/register.dart';
import '../../features/stickers/register.dart';
import '../../features/text_object/register.dart';
import '../../features/cards/register.dart';
import '../../features/tables/register.dart';
import '../../features/templates/register.dart';
import '../../features/frames/register.dart';
import '../../features/view/register.dart';
import '../../features/search/register.dart';
import '../../features/voting/register.dart';
import '../../features/timer/register.dart';
import '../../features/follow/register.dart';
import '../../features/laser/register.dart';
import '../../features/cursor_chat/register.dart';
import '../../features/versions/register.dart';
import '../../features/export/register.dart';
import '../../features/thumbnail/register.dart';
import '../../features/mcp/register.dart';
import '../../features/documents/register.dart';
import '../../features/richtext/register.dart';
import '../../features/a11y/register.dart';
import '../../features/timeline/register.dart';
import '../../features/onboarding/register.dart';
import '../../features/commands/register.dart';
import '../../features/private/register.dart';
import '../../features/stack/register.dart';
import '../../features/clipboard/clipboard.dart' show pasteFiles, pasteTextAs;
import '../../features/documents/documents.dart' show pasteClipboardFiles;
import '../../features/search/search_bar.dart' show searchIncludesHidden;
import '../../features/snapping/snapping.dart' show SnapPrefs;
import '../../features/templates/template_widgets.dart' show showPasteAs;
import '../../features/view/board_background.dart' show snapPrefKey, snapToGridPref;
import '../../features/view/board_prefs.dart';
import '../../render/board_scene.dart' show showHiddenObjects;
import 'registry.dart';

/// Fills [r] with the core and every feature package (order of the calls does not matter: entries sort by `order`).
BoardRegistry registerAllFeatures(BoardRegistry r) {
  _wirePackages();
  registerCore(r); // F2
  registerMindmap(r); // Mindmap-Paket
  registerArrange(r); // P1
  registerClipboard(r); // P1
  registerSnapping(r); // P1
  registerShapes(r); // P2
  registerStickers(r); // P2
  registerTextObject(r); // P2
  registerCards(r); // P3
  registerTables(r); // P3
  registerTemplates(r); // P3
  registerFrames(r); // P4
  registerView(r); // P4
  registerSearch(r); // P4
  registerVoting(r); // P5
  registerTimer(r); // P5
  registerFollow(r); // P5
  registerLaser(r); // P5
  registerCursorChat(r); // P5
  registerVersions(r); // P6
  registerExport(r); // P6
  registerThumbnail(r); // P6
  registerMcp(r); // P6
  registerDocuments(r); // P7
  registerRichtext(r); // P8
  registerA11y(r); // P8
  registerTimeline(r); // P9
  registerOnboarding(r); // UX-A2 (P5)
  registerCommands(r); // Q3
  registerPrivate(r); // Privater Modus (Welle UX+Q)
  registerStack(r); // Q2 Notiz-Stapel
  return r;
}

/// Hooks one package offers and another one fills (integration of Welle 1).
void _wirePackages() {
  // P1 „Am Raster einrasten“ (board menu) = P4's device setting `stachel.tools.snap` (Board-Einstellungen; kept by
  // the app through `BoardPrefs.persist`) – both switches show and change the same value
  SnapPrefs.load = () => snapToGridPref;
  SnapPrefs.save = (on) => BoardPrefs.set(snapPrefKey, on ? '1' : null);
  // P4's search finds hidden objects while P1's „Ausgeblendete zeigen“ is on (web: hidden objects are searchable
  // only when shown)
  searchIncludesHidden = (_) => showHiddenObjects;
  // P1 „Einfügen“ of table data / several lines asks P3's „Einfügen als …“ (Tabelle · N Haftnotizen · Eine) when the
  // server knows `structure.paste`; otherwise one note as before
  pasteTextAs = (context, ui, text, at) async =>
      ui.controller.canAct('structure.paste') && await showPasteAs(context, ui, text, at);
  // P1 „Einfügen“ takes a copied image or PDF first (P7, D24; web: file handlers before text on Strg V)
  pasteFiles = pasteClipboardFiles;
}

/// A registry with everything (the app adds its own entries on top).
BoardRegistry standardBoardRegistry() => registerAllFeatures(BoardRegistry());
