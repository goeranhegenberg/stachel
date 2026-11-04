import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

import '../../editor/registry/board_ui.dart';
import '../../editor/transform.dart';
import '../../model/board_object.dart';
import '../../model/board_source.dart';
import '../../protocol/native_messages.dart';

/// Copy, cut and paste like the web (`board/clipboard.ts`, `Editor.tsx` `copySelection`/`pasteFromMenu`, audit
/// D20–D22): the copied objects stay in the app (also across boards, web `internalClip`) and their text goes to the
/// system clipboard for other apps (web `text/plain`). Flutter's clipboard has no `text/html`: where the host app can
/// (Android: [BoardClipboard.writeHtml]/[BoardClipboard.readHtml]) the web's `text/html` with the `stachel/objects@1`
/// payload goes along, so objects travel between app and browser like between two browsers; elsewhere only the text
/// (the app still reads the JSON when someone puts it into the plain text, web `parse`).

/// Marker of copied board objects (web `CLIPBOARD_MARKER`).
const clipboardMarker = 'stachel/objects@1';

/// Longest text that becomes a sticky note when pasted (web `pasteText`).
const pasteTextMax = 2000;

/// Hints of the web (touch variant).
abstract final class ClipboardTexts {
  static const nothing = 'Nichts zum Einfügen. Erst etwas kopieren.';
}

/// What was copied in this app (web `internalClip`) and the text written to the system clipboard with it.
abstract final class BoardClipboard {
  static List<BoardObject> objects = const [];
  static String? text;

  /// Overrides the system clipboard (tests).
  static Future<String?> Function() read = () async => (await Clipboard.getData(Clipboard.kTextPlain))?.text;
  static Future<void> Function(String text) write = (text) => Clipboard.setData(ClipboardData(text: text));

  /// Writes text and `text/html` together (host app, Android); null or false = not possible, then only [write].
  static Future<bool> Function(String text, String html)? writeHtml;

  /// Reads `text/html` of the system clipboard (host app, Android); null = not possible.
  static Future<String?> Function()? readHtml;
}

String _escapeHtml(String s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/// HTML for the clipboard like the web's `toHtml`: payload in a meta element, readable text in a div.
String objectsToHtml(List<BoardObject> objs) {
  final body = clipboardPlainText(objs).split('\n').map(_escapeHtml).join('<br>');
  return '<meta data-stachel="${jsEncodeUriComponent(serializeObjects(objs))}"><div>$body</div>';
}

/// JavaScript's `encodeURIComponent` (keeps `! ' ( ) *`, which Dart's [Uri.encodeComponent] escapes).
String jsEncodeUriComponent(String s) => Uri.encodeComponent(s).replaceAllMapped(
  RegExp('%(21|27|28|29|2A)'),
  (m) => String.fromCharCode(int.parse(m.group(1)!, radix: 16)),
);

/// Board objects from the web's `text/html` (`parseClipboard`); null = none (broken data counts as foreign content).
List<BoardObject>? parseHtmlObjects(String? html) {
  if (html == null) return null;
  final m = RegExp(r'data-stachel="([^"]*)"').firstMatch(html);
  if (m == null) return null;
  try {
    return parseObjects(Uri.decodeComponent(m.group(1)!));
  } catch (_) {
    return null;
  }
}

/// Plain text of an object for other apps (web `plainTextOf`: frames their title, the rest their text).
String objectPlainText(BoardObject o) => switch (o.type) {
  'frame' => o.title ?? '',
  'card' => [o.text, o.desc ?? ''].where((s) => s.isNotEmpty).join('\n'),
  'document' => o.docName ?? 'PDF',
  'table' => [
    for (final r in o.table?.rows ?? const <String>[])
      [for (final c in o.table!.cols) o.table!.cells['$r:$c'] ?? ''].join('\t'),
  ].join('\n'),
  _ => o.displayText,
};

/// Texts of the objects line by line (web `plainText`).
String clipboardPlainText(List<BoardObject> objs) => [
  for (final o in objs)
    if (objectPlainText(o).trim() case final t when t.isNotEmpty) t,
].join('\n');

/// The web's payload (`serialize`).
String serializeObjects(List<BoardObject> objs) => jsonEncode({
  'marker': clipboardMarker,
  'objects': [for (final o in objs) o.raw],
});

/// Board objects from [text] with the marker (web `parse`); null = not ours.
List<BoardObject>? parseObjects(String? text) {
  if (text == null || !text.contains(clipboardMarker)) return null;
  try {
    final data = jsonDecode(text);
    if (data is! Map || data['marker'] != clipboardMarker || data['objects'] is! List) return null;
    return [
      for (final o in data['objects'] as List)
        if (o is Map && o['id'] is String && o['type'] is String) BoardObject(Map<String, Object?>.from(o)),
    ];
  } catch (_) {
    return null;
  }
}

/// „Kopieren“: the selection with the connectors between its objects (web `copySelection`).
Future<void> copySelection(BoardUi ui) async {
  final objs = ui.editor.withAttachedConnectors(ui.editor.selected);
  if (objs.isEmpty) return;
  BoardClipboard.objects = objs;
  final text = clipboardPlainText(objs);
  BoardClipboard.text = text;
  try {
    final html = BoardClipboard.writeHtml;
    if (html == null || !await html(text, objectsToHtml(objs))) await BoardClipboard.write(text);
  } catch (_) {
    // no system clipboard: the copy inside the app still works
  }
}

/// „Ausschneiden“: copy, then delete (locked ones stay; web `cutSelection`).
Future<void> cutSelection(BoardUi ui) async {
  await copySelection(ui);
  ui.editor.deleteSelection();
}

/// Asks „Einfügen als …“ for table data or several lines (P3's `showPasteAs`, wired in `all_features.dart`); false =
/// it did not ask, the text becomes one note. Null = always one note.
Future<bool> Function(BuildContext context, BoardUi ui, String text, Offset at)? pasteTextAs;

/// Hook for files in the clipboard (P7 documents: image / PDF → upload at [at]); true = pasted, nothing more.
Future<bool> Function(BoardUi ui, Offset at)? pasteFiles;

/// „Einfügen“ at world point [at] (web `pasteFromMenu`): board objects from the clipboard centered there, foreign
/// text as a sticky note (≤ 2000 characters; table data or several lines first ask „Einfügen als …“ when [context]
/// is given), else what was copied in the app; nothing → hint.
Future<void> pasteAt(BoardUi ui, Offset at, {BuildContext? context}) async {
  if (!ui.editor.editable) return;
  // P7 (D24): copied images/PDFs first, like the web's file handlers on Strg V
  final files = pasteFiles;
  if (files != null && await files(ui, at)) return;
  String? text, html;
  try {
    text = await BoardClipboard.read();
  } catch (_) {
    text = null;
  }
  try {
    html = await BoardClipboard.readHtml?.call();
  } catch (_) {
    html = null;
  }
  // objects copied in a browser (text/html, web `parseClipboard`) or the JSON in the plain text
  final objs = parseHtmlObjects(html) ?? parseObjects(text);
  if (objs != null && objs.isNotEmpty) {
    ui.editor.pasteObjects(objs, at: at);
    return;
  }
  // our own copy wrote its text there: the objects, not a note
  final own = BoardClipboard.objects.isNotEmpty && text != null && text == BoardClipboard.text;
  if (!own && text != null && text.trim().isNotEmpty) {
    final ask = pasteTextAs;
    if (ask != null && context != null && context.mounted && await ask(context, ui, text, at)) return;
    pasteText(ui, text, at);
    return;
  }
  if (BoardClipboard.objects.isNotEmpty) {
    ui.editor.pasteObjects(BoardClipboard.objects, at: at);
    return;
  }
  ui.hints.show(ClipboardTexts.nothing);
}

/// Foreign text → a sticky note at [at] (web `pasteText`, D22).
String? pasteText(BoardUi ui, String text, Offset at) {
  if (!ui.editor.editable) return null;
  final id = BoardController.newId();
  ui.controller.apply([
    CreateOp([
      {
        'id': id,
        'type': 'sticky',
        'x': jsRound(at.dx - 100),
        'y': jsRound(at.dy - 100),
        'w': 200,
        'h': 200,
        'color': ui.editor.stickyColor,
        'text': text.length > pasteTextMax ? text.substring(0, pasteTextMax) : text,
      },
    ]),
  ]);
  ui.editor.select({id});
  return id;
}
