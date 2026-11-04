import 'dart:isolate';
import 'dart:typed_data';
import 'dart:ui' as dui;

import 'package:flutter/material.dart';

import '../../editor/registry/board_ui.dart';
import '../../model/board_object.dart';
import '../frames/frames_model.dart';
import '../versions/admin_host.dart';
import 'export_pages.dart';
import 'pdf_writer.dart';
import 'render_board.dart';

// Export sheet (web `features/tools/export/ExportDialog.tsx` + `runExport` of `exporter.ts`): PNG or PDF of the board,
// the selection, a frame or all frames, quality Normal/Scharf/Druck, transparent PNG; the file goes to the system
// share sheet instead of the web's download (audit §3.1).

/// Options of one export (web `ExportOptions`).
class ExportOptions {
  const ExportOptions({required this.format, required this.area, this.quality = 2, this.transparent = false});
  final ExportFormat format;
  final ExportArea area;

  /// Pixels per board unit (1 Normal, 2 Scharf, 3 Druck).
  final double quality;

  /// PNG without background.
  final bool transparent;
}

/// A finished export.
class ExportResult {
  const ExportResult({required this.bytes, required this.name, required this.mimeType, required this.pages});
  final Uint8List bytes;
  final String name;
  final String mimeType;
  final int pages;
}

/// The pages of [area] on the board of [ui] (current selection).
List<ExportPage> boardExportPages(BoardUi ui, ExportArea area) {
  final scene = ui.editor.scene;
  scene.bounds; // routes up to date
  return exportPages(scene.state.ordered, ui.editor.selection.value, area, (o) => boardObjectBounds(scene, o));
}

/// Renders the export (web `runExport`); null = nothing to export. [onProgress] gets (done, total) per page.
Future<ExportResult?> runBoardExport(
  BoardUi ui,
  ExportOptions opts, {
  String? boardTitle,
  void Function(int done, int total)? onProgress,
  Duration imageWait = const Duration(seconds: 3),
}) async {
  final pages = boardExportPages(ui, opts.area);
  if (pages.isEmpty) return null;
  final title = boardTitle ?? adminHost(ui)?.boardTitle ?? 'Board';
  final name = exportNameFor(title, opts.area, pages, opts.format);
  final bg = boardBackgroundColor(ui);
  Future<dui.Image> render(ExportPage p, {bool transparent = false}) => renderBoardRegion(
    ui,
    world: p.rect,
    scale: clampScale(p.rect, opts.quality),
    objects: p.objects,
    transparent: transparent,
    background: bg,
    imageWait: imageWait,
  );

  if (opts.format == ExportFormat.png) {
    onProgress?.call(0, 1);
    final img = await render(pages.first, transparent: opts.transparent);
    try {
      final data = await img.toByteData(format: dui.ImageByteFormat.png);
      if (data == null) throw StateError('PNG');
      onProgress?.call(1, 1);
      return ExportResult(bytes: data.buffer.asUint8List(), name: name, mimeType: 'image/png', pages: 1);
    } finally {
      img.dispose();
    }
  }
  final rgb = [(bg.r * 255).round(), (bg.g * 255).round(), (bg.b * 255).round()];
  final out = <PdfPage>[];
  for (var i = 0; i < pages.length; i++) {
    onProgress?.call(i, pages.length);
    final img = await render(pages[i]);
    try {
      final data = await img.toByteData(format: dui.ImageByteFormat.rawStraightRgba);
      if (data == null) throw StateError('RGBA');
      final w = img.width, h = img.height;
      final rgba = data.buffer.asUint8List();
      // RGB + zlib off the UI thread (a print page has up to 36 MP)
      final image = await _pdfImageOffThread(rgba, w, h, rgb);
      final size = pageSizePt(pages[i].rect);
      out.add(PdfPage(widthPt: size.widthPt, heightPt: size.heightPt, image: image));
    } finally {
      img.dispose();
    }
  }
  onProgress?.call(pages.length, pages.length);
  return ExportResult(
    bytes: buildPdf(out, title: title),
    name: name,
    mimeType: 'application/pdf',
    pages: out.length,
  );
}

/// [pdfImageFromRgba] in another isolate (the closure only holds the pixels).
Future<PdfImage> _pdfImageOffThread(Uint8List rgba, int w, int h, List<int> bg) =>
    Isolate.run(() => pdfImageFromRgba(rgba, w, h, bg));

/// Formats an integer like `Intl.NumberFormat('de-DE')`: „1.234“.
String _de(int n) => n.toString().replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => '.');

/// The sheet „Exportieren“; [area]/[format] preset it (object menu: selection or frame).
class ExportSheet extends StatefulWidget {
  const ExportSheet({super.key, required this.ui, this.area, this.format});
  final BoardUi ui;
  final ExportArea? area;
  final ExportFormat? format;

  @override
  State<ExportSheet> createState() => _ExportSheetState();
}

enum _Kind { board, selection, frame, frames }

class _ExportSheetState extends State<ExportSheet> {
  BoardUi get ui => widget.ui;
  late ExportFormat _format = widget.format ?? ExportFormat.png;
  late final Set<String> _selection = {...ui.editor.selection.value};
  late final List<BoardObject> _frames = framesInOrderWeb([
    for (final o in ui.editor.scene.state.ordered)
      if (!o.hidden) o,
  ]);
  late _Kind _kind = switch (widget.area) {
    ExportBoardArea() => _Kind.board,
    ExportSelectionArea() => _Kind.selection,
    ExportFrameArea() => _Kind.frame,
    ExportFramesArea() => _Kind.frames,
    null => _selection.isNotEmpty ? _Kind.selection : _Kind.board,
  };
  late String _frameId = widget.area is ExportFrameArea
      ? (widget.area as ExportFrameArea).id
      : (_frames.firstOrNull?.id ?? '');
  int _quality = 2;
  bool _transparent = false;
  String? _busy;
  String? _error;

  _Kind get _effKind => _format == ExportFormat.png && _kind == _Kind.frames ? _Kind.frame : _kind;

  ExportArea get _area => switch (_effKind) {
    _Kind.board => const ExportBoardArea(),
    _Kind.selection => const ExportSelectionArea(),
    _Kind.frame => ExportFrameArea(_frameId),
    _Kind.frames => const ExportFramesArea(),
  };

  List<ExportPage> get _pages =>
      exportPages(ui.editor.scene.state.ordered, _selection, _area, (o) => boardObjectBounds(ui.editor.scene, o));

  String _info(List<ExportPage> pages) {
    if (pages.isEmpty) return 'Hier gibt es nichts zu exportieren.';
    if (_format == ExportFormat.pdf) return pages.length == 1 ? '1 Seite' : '${pages.length} Seiten';
    final px = exportPixels(pages.first.rect, _quality.toDouble());
    return '${_de(px.width)} × ${_de(px.height)} Pixel';
  }

  Future<void> _start() async {
    final host = adminHost(ui);
    setState(() {
      _error = null;
      _busy = 'Wird erstellt …';
    });
    try {
      final opts = ExportOptions(
        format: _format,
        area: _area,
        quality: _quality.toDouble(),
        transparent: _format == ExportFormat.png && _transparent,
      );
      final res = await runBoardExport(
        ui,
        opts,
        onProgress: (done, total) {
          if (total > 1 && mounted) setState(() => _busy = 'Seite ${done + 1 > total ? total : done + 1} von $total …');
        },
      );
      if (!mounted) return;
      if (res == null) {
        setState(() {
          _error = 'Hier gibt es nichts zu exportieren.';
          _busy = null;
        });
        return;
      }
      await host?.shareFile(res.bytes, res.name, res.mimeType);
      ui.hints.show('Gespeichert: ${res.name}');
      if (mounted) Navigator.of(context).maybePop();
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Der Export hat nicht geklappt. Versuch es mit geringerer Qualität noch einmal.';
        _busy = null;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = ui.theme;
    final pages = _pages;
    final visible = ui.editor.scene.state.ordered.where((o) => !o.hidden).length;
    Widget option(_Kind k, String label, String? sub, {bool disabled = false, Widget? trailing}) {
      final on = _effKind == k;
      final enabled = !disabled && _busy == null;
      return ListTile(
        key: Key('stachelExportArea-${k.name}'),
        dense: true,
        contentPadding: const EdgeInsets.symmetric(horizontal: 4),
        enabled: enabled,
        selected: on,
        selectedColor: theme.ink,
        leading: Icon(on ? Icons.radio_button_checked : Icons.radio_button_unchecked, color: on ? theme.accent : null),
        title: Text(label, style: const TextStyle(fontWeight: FontWeight.w700)),
        subtitle: sub == null ? null : Text(sub),
        trailing: trailing,
        onTap: enabled ? () => setState(() => _kind = k) : null,
      );
    }

    return SafeArea(
      child: SingleChildScrollView(
        key: const Key('stachelExportSheet'),
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('EXPORTIEREN', style: theme.label(size: 15)),
            const SizedBox(height: 12),
            SegmentedButton<ExportFormat>(
              key: const Key('stachelExportFormat'),
              showSelectedIcon: false,
              segments: const [
                ButtonSegment(
                  value: ExportFormat.png,
                  icon: Icon(Icons.image_outlined, key: Key('stachelExportPng')),
                  label: Text('PNG · Bild'),
                ),
                ButtonSegment(
                  value: ExportFormat.pdf,
                  icon: Icon(Icons.picture_as_pdf_outlined, key: Key('stachelExportPdf')),
                  label: Text('PDF · Dokument'),
                ),
              ],
              selected: {_format},
              onSelectionChanged: _busy != null ? null : (s) => setState(() => _format = s.first),
            ),
            const SizedBox(height: 12),
            Text('Bereich', style: theme.label(size: 13, color: theme.grey)),
            Column(
              children: [
                option(
                  _Kind.board,
                  'Ganzes Board',
                  '$visible Objekte',
                  disabled: ui.editor.scene.state.ordered.isEmpty,
                ),
                option(
                  _Kind.selection,
                  'Auswahl',
                  _selection.isNotEmpty ? '${_selection.length} ausgewählt' : 'Nichts ausgewählt',
                  disabled: _selection.isEmpty,
                ),
                option(
                  _Kind.frame,
                  'Rahmen',
                  _frames.isEmpty ? 'Noch keine Rahmen' : null,
                  disabled: _frames.isEmpty,
                  trailing: _frames.isEmpty
                      ? null
                      : DropdownButton<String>(
                          key: const Key('stachelExportFrame'),
                          value: _frames.any((f) => f.id == _frameId) ? _frameId : _frames.first.id,
                          onChanged: _busy != null
                              ? null
                              : (id) => setState(() {
                                  _frameId = id ?? _frameId;
                                  _kind = _Kind.frame;
                                }),
                          items: [
                            for (var i = 0; i < _frames.length; i++)
                              DropdownMenuItem(
                                value: _frames[i].id,
                                child: Text(
                                  '${i + 1}. ${(_frames[i].title ?? '').isEmpty ? 'Rahmen' : _frames[i].title}',
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                          ],
                        ),
                ),
                if (_format == ExportFormat.pdf)
                  option(
                    _Kind.frames,
                    'Alle Rahmen',
                    _frames.isEmpty ? 'Noch keine Rahmen' : 'Eine Seite je Rahmen (${_frames.length})',
                    disabled: _frames.isEmpty,
                  ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Text('Qualität', style: theme.label(size: 13, color: theme.grey)),
                const SizedBox(width: 12),
                Expanded(
                  child: SegmentedButton<int>(
                    key: const Key('stachelExportQuality'),
                    showSelectedIcon: false,
                    style: const ButtonStyle(visualDensity: VisualDensity.compact),
                    segments: [
                      for (final (q, label) in exportQualities)
                        ButtonSegment(
                          value: q,
                          label: Text(label, key: Key('stachelExportQuality-$q')),
                        ),
                    ],
                    selected: {_quality},
                    onSelectionChanged: _busy != null ? null : (s) => setState(() => _quality = s.first),
                  ),
                ),
              ],
            ),
            if (_format == ExportFormat.png)
              CheckboxListTile(
                key: const Key('stachelExportTransparent'),
                dense: true,
                contentPadding: EdgeInsets.zero,
                controlAffinity: ListTileControlAffinity.leading,
                value: _transparent,
                title: const Text('Durchsichtiger Hintergrund'),
                onChanged: _busy != null ? null : (v) => setState(() => _transparent = v ?? false),
              ),
            const SizedBox(height: 4),
            Text(
              _info(pages),
              key: const Key('stachelExportInfo'),
              style: TextStyle(color: theme.grey),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  _error!,
                  key: const Key('stachelExportError'),
                  style: TextStyle(color: theme.danger),
                ),
              ),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  key: const Key('stachelExportCancel'),
                  onPressed: () => Navigator.of(context).maybePop(),
                  child: const Text('Abbrechen'),
                ),
                const SizedBox(width: 8),
                FilledButton(
                  key: const Key('stachelExportStart'),
                  style: FilledButton.styleFrom(backgroundColor: theme.accent),
                  onPressed: _busy != null || pages.isEmpty || adminHost(ui) == null ? null : _start,
                  child: Text(_busy ?? 'Exportieren'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
