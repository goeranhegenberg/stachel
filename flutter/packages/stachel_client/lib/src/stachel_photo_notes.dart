import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:stachel_board/stachel_board.dart';

import 'stachel_boards_api.dart';
import 'stachel_client_base.dart';
import 'stachel_photo_flow.dart';
import 'stachel_photos.dart';

// „Zettel abfotografieren“ (P10, web `features/tools/PhotoNotesDialog.tsx`, docs/features/photo-notes.md): photo of a
// wall with paper notes (camera or gallery) → the OWN server finds the notes, their colors and texts (no cloud, no ML
// on the device; the photo is only kept in memory) → preview: deselect notes, correct texts and colors → web action
// `tools.photoNotes` puts them on the board as sticky notes, arranged like on the photo, as one undo step.

/// One note found on the photo (position in pixels of the analysed photo).
class PhotoNote {
  PhotoNote({
    required this.x,
    required this.y,
    required this.w,
    required this.h,
    required this.color,
    required this.text,
    this.conf = 0,
  });

  static PhotoNote? fromJson(Object? j) {
    if (j is! Map) return null;
    double? n(String k) => j[k] is num ? (j[k] as num).toDouble() : null;
    final x = n('x'), y = n('y'), w = n('w'), h = n('h');
    final c = j['color'];
    if (x == null || y == null || w == null || h == null || w <= 0 || h <= 0 || c is! String) return null;
    return PhotoNote(
      x: x,
      y: y,
      w: w,
      h: h,
      color: c,
      text: j['text'] is String ? j['text'] as String : '',
      conf: n('conf') ?? 0,
    );
  }

  final double x, y, w, h;
  String color;
  String text;
  final double conf;
  bool selected = true;

  /// Args entry of `tools.photoNotes`.
  Map<String, Object?> toArgs() => {'x': x, 'y': y, 'w': w, 'h': h, 'color': color, 'text': text.trim()};
}

/// The server's answer.
class PhotoNotesResult {
  const PhotoNotesResult({
    required this.width,
    required this.height,
    required this.notes,
    required this.ocr,
    this.preview,
  });

  static PhotoNotesResult? fromJson(Map<String, Object?> j) {
    final w = j['width'], h = j['height'], list = j['notes'];
    if (w is! num || h is! num || list is! List) return null;
    Uint8List? preview;
    final p = j['preview'];
    if (p is String && p.startsWith('data:image/')) {
      try {
        preview = base64Decode(p.substring(p.indexOf(',') + 1));
      } catch (_) {}
    }
    return PhotoNotesResult(
      width: w.toDouble(),
      height: h.toDouble(),
      notes: [for (final n in list) ?PhotoNote.fromJson(n)],
      ocr: j['ocr'] == true,
      preview: preview,
    );
  }

  final double width, height;
  final List<PhotoNote> notes;

  /// false = the server has no text recognition (notes and colors only)
  final bool ocr;

  /// Small JPEG of the photo for the preview (not stored).
  final Uint8List? preview;
}

/// The whole flow from the board menu: camera/gallery → upload („Zettel werden erkannt …“) → preview → notes.
Future<void> startPhotoNotes(
  BuildContext context,
  BoardUi ui, {
  required StachelPhotoNotesApi api,
  required String boardId,
  StachelPhotoPicker? picker,
}) async {
  final source = await askPhotoSource(context);
  if (source == null || !context.mounted) return;
  Uint8List? bytes;
  try {
    bytes = await (picker ?? ImagePickerPhotos()).pick(source);
  } catch (_) {
    ui.hints.show(
      source == StachelPhotoSource.camera
          ? 'Die Kamera ließ sich nicht öffnen.'
          : 'Die Galerie ließ sich nicht öffnen.',
    );
    return;
  }
  if (bytes == null || !context.mounted) return;
  var mime = imageMime(bytes);
  if (mime == null || mime == 'image/gif') {
    // HEIC & Co.: auf dem Gerät als PNG neu kodieren (der Server nimmt JPEG/PNG/WebP)
    final p = await preparePhoto(bytes);
    if (p == null || !context.mounted) {
      ui.hints.show('Das Foto ließ sich nicht lesen.');
      return;
    }
    bytes = p.bytes;
    mime = p.mime;
  }
  final nav = Navigator.of(context, rootNavigator: true);
  var waiting = true;
  showDialog<void>(
    context: context,
    barrierDismissible: false,
    useRootNavigator: true,
    builder: (_) => const PopScope(
      canPop: false,
      child: AlertDialog(
        key: Key('stachelPhotoNotesBusy'),
        content: Row(
          children: [
            SizedBox(width: 28, height: 28, child: CircularProgressIndicator(strokeWidth: 3)),
            SizedBox(width: 16),
            Expanded(child: Text('Zettel werden erkannt …')),
          ],
        ),
      ),
    ),
  ).whenComplete(() => waiting = false);
  PhotoNotesResult? result;
  String? error;
  try {
    result = PhotoNotesResult.fromJson(await api.photoNotes(boardId, bytes, mime));
    if (result == null) error = 'Die Antwort des Servers ließ sich nicht lesen.';
  } on StachelException catch (e) {
    error = e.message;
  } catch (_) {
    error = 'Das hat nicht geklappt. Bitte versuch es noch einmal.';
  }
  bytes = null; // das Foto nicht länger als nötig halten
  if (waiting) nav.pop();
  if (!context.mounted) return;
  if (error != null) {
    ui.hints.show(error);
    return;
  }
  final chosen = await ui.openSheet<List<PhotoNote>>(
    context,
    (ctx) => PhotoNotesSheet(ui: ui, result: result!),
    scrollControlled: true,
    side: true,
    title: 'Zettel abfotografieren',
  );
  if (chosen == null || chosen.isEmpty) return;
  final view = ui.editor.viewSize;
  final at = ui.editor.camera.value.toWorld(Offset(view.width / 2, view.height / 2));
  final done = await ui.controller.act('tools.photoNotes', {
    'notes': [for (final n in chosen) n.toArgs()],
    'x': at.dx.roundToDouble(),
    'y': at.dy.roundToDouble(),
  }, label: 'Zettel abfotografieren');
  if (!done.ok) {
    ui.hints.show(done.message ?? 'Die Notizen ließen sich nicht anlegen.');
  } else {
    ui.hints.show('${chosen.length} ${chosen.length == 1 ? 'Notiz' : 'Notizen'} angelegt.');
  }
}

/// Preview: the photo with the found notes (numbered; deselected ones pale), below a list with check box, color and
/// text of each note. Pops the chosen notes.
class PhotoNotesSheet extends StatefulWidget {
  const PhotoNotesSheet({super.key, required this.ui, required this.result});
  final BoardUi ui;
  final PhotoNotesResult result;

  @override
  State<PhotoNotesSheet> createState() => _PhotoNotesSheetState();
}

class _PhotoNotesSheetState extends State<PhotoNotesSheet> {
  late final List<TextEditingController> _texts = [
    for (final n in widget.result.notes) TextEditingController(text: n.text),
  ];

  @override
  void dispose() {
    for (final c in _texts) {
      c.dispose();
    }
    super.dispose();
  }

  Color _hex(String c) => parseColor(c, const Color(0xFFFFF27A));

  @override
  Widget build(BuildContext context) {
    final ui = widget.ui;
    final r = widget.result;
    final notes = r.notes;
    final count = notes.where((n) => n.selected).length;
    return SafeArea(
      child: Column(
        key: const Key('stachelPhotoNotesSheet'),
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Text('ZETTEL ABFOTOGRAFIEREN', style: ui.theme.label(size: 16)),
          ),
          Flexible(
            child: ListView(
              shrinkWrap: true,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              children: [
                if (r.preview != null)
                  ConstrainedBox(
                    constraints: const BoxConstraints(maxHeight: 260),
                    child: AspectRatio(
                      aspectRatio: r.width / r.height,
                      child: LayoutBuilder(
                        builder: (context, box) {
                          final k = box.maxWidth / r.width;
                          return Stack(
                            key: const Key('stachelPhotoNotesPhoto'),
                            children: [
                              Positioned.fill(
                                child: ClipRRect(
                                  borderRadius: BorderRadius.circular(6),
                                  child: Image.memory(r.preview!, fit: BoxFit.fill, gaplessPlayback: true),
                                ),
                              ),
                              for (final (i, n) in notes.indexed)
                                Positioned(
                                  left: n.x * k,
                                  top: n.y * k,
                                  width: n.w * k,
                                  height: n.h * k,
                                  child: GestureDetector(
                                    onTap: () => setState(() => n.selected = !n.selected),
                                    child: Container(
                                      decoration: BoxDecoration(
                                        color: n.selected ? null : const Color(0x99FFFFFF),
                                        border: Border.all(
                                          color: n.selected ? ui.theme.accent : const Color(0x88FFFFFF),
                                          width: n.selected ? 2.5 : 1.5,
                                        ),
                                      ),
                                      alignment: Alignment.topLeft,
                                      child: Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 4),
                                        color: n.selected ? ui.theme.accent : const Color(0xFF8A8A85),
                                        child: Text(
                                          '${i + 1}',
                                          style: const TextStyle(
                                            color: Colors.white,
                                            fontSize: 11,
                                            fontWeight: FontWeight.w700,
                                          ),
                                        ),
                                      ),
                                    ),
                                  ),
                                ),
                            ],
                          );
                        },
                      ),
                    ),
                  ),
                if (notes.isEmpty)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 16),
                    child: Text(
                      'Keine Zettel erkannt. Am besten klappt es mit farbigen Zetteln auf heller Wand, frontal und gut '
                      'ausgeleuchtet fotografiert.',
                      key: Key('stachelPhotoNotesNone'),
                    ),
                  )
                else if (!r.ocr)
                  const Padding(
                    padding: EdgeInsets.only(top: 10),
                    child: Text(
                      'Texterkennung ist auf diesem Server nicht verfügbar – nur Zettel und Farben.',
                      key: Key('stachelPhotoNotesNoOcr'),
                    ),
                  )
                else
                  const Padding(
                    padding: EdgeInsets.only(top: 10),
                    child: Text('Zettel abwählen oder den erkannten Text korrigieren, dann anlegen.'),
                  ),
                const SizedBox(height: 6),
                for (final (i, n) in notes.indexed)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Row(
                      key: Key('stachelPhotoNote-$i'),
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Checkbox(
                          key: Key('stachelPhotoNoteOn-$i'),
                          value: n.selected,
                          onChanged: (v) => setState(() => n.selected = v ?? false),
                        ),
                        Semantics(
                          button: true,
                          label: 'Farbe von Zettel ${i + 1}: ${colorName(n.color)}',
                          excludeSemantics: true,
                          child: InkWell(
                            key: Key('stachelPhotoNoteColor-$i'),
                            customBorder: const CircleBorder(),
                            onTap: () async {
                              final c = await pickColor(context, ui, stickyColors, custom: true, current: n.color);
                              if (c != null) setState(() => n.color = c);
                            },
                            child: Container(
                              width: 40,
                              height: 40,
                              margin: const EdgeInsets.only(top: 4, right: 8),
                              alignment: Alignment.center,
                              decoration: BoxDecoration(
                                color: _hex(n.color),
                                borderRadius: BorderRadius.circular(4),
                                border: Border.all(color: ui.theme.ink.withValues(alpha: 0.45), width: 1.5),
                              ),
                              child: Text(
                                '${i + 1}',
                                style: TextStyle(color: readableInk(_hex(n.color)), fontWeight: FontWeight.w700),
                              ),
                            ),
                          ),
                        ),
                        Expanded(
                          child: TextField(
                            key: Key('stachelPhotoNoteText-$i'),
                            controller: _texts[i],
                            enabled: n.selected,
                            minLines: 1,
                            maxLines: 4,
                            maxLength: 2000,
                            decoration: InputDecoration(
                              isDense: true,
                              counterText: '',
                              hintText: r.ocr ? 'Kein Text erkannt' : 'Text der Notiz',
                            ),
                            onChanged: (v) => n.text = v,
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('ABBRECHEN')),
                const SizedBox(width: 8),
                Flexible(
                  child: FilledButton(
                    key: const Key('stachelPhotoNotesCreate'),
                    onPressed: count == 0
                        ? null
                        : () => Navigator.of(context).pop([
                            for (final n in notes)
                              if (n.selected) n,
                          ]),
                    child: Text(
                      count == 1 ? '1 NOTIZ ANLEGEN' : '$count NOTIZEN ANLEGEN',
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
