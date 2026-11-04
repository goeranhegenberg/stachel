import 'dart:async';

import 'package:flutter/material.dart';

import '../../editor/board_view.dart';
import '../../editor/camera.dart';
import '../../model/board_source.dart';
import '../../protocol/native_messages.dart';
import '../../render/text_layout.dart';
import 'format.dart';
import 'versions_session.dart';

/// Read-only view of a version (web `PreviewSession` + `VersionsLayer` bar, audit N03): a second board from the
/// snapshot of contract §8.14 – its own controller on a [FixtureBoardSource] with role `view`, nothing goes to the
/// server. It starts at the live board's camera; the live board stays connected on the route below. The bar at the
/// bottom: „Vorschau: Stand von …“, „Versionen“, „Wiederherstellen“, ✕ („Zurück zum aktuellen Stand“).
class VersionPreviewScreen extends StatefulWidget {
  const VersionPreviewScreen({super.key, required this.session});
  final VersionsSession session;

  @override
  State<VersionPreviewScreen> createState() => _VersionPreviewScreenState();
}

class _VersionPreviewScreenState extends State<VersionPreviewScreen> {
  VersionsSession get session => widget.session;
  BoardController? _controller;
  CameraController? _camera;
  int _seq = -1;

  @override
  void initState() {
    super.initState();
    session.preview.addListener(_changed);
    _build();
  }

  @override
  void dispose() {
    session.preview.removeListener(_changed);
    _controller?.dispose();
    _camera?.dispose();
    super.dispose();
  }

  void _changed() {
    if (!mounted) return;
    _build();
    setState(() {});
  }

  /// The board of the previous preview goes once the new one is built (its view still listens this frame).
  void _drop() {
    final c = _controller, cam = _camera;
    _controller = null;
    _camera = null;
    if (c == null && cam == null) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      c?.dispose();
      cam?.dispose();
    });
  }

  /// A new board for every preview opened (another version picked from the list keeps the camera).
  void _build() {
    final pv = session.preview.value;
    if (pv == null || pv.seq == _seq) return;
    final cam = _camera?.value ?? session.ui.editor.camera.value;
    _drop();
    _seq = pv.seq;
    final snap = pv.snapshot;
    final board = snap['board'];
    final source = FixtureBoardSource(
      BoardSnapshot.fromJson(snap['snapshot']),
      epoch: 'version-${pv.version.id}',
      role: 'view',
      title: board is Map && board['title'] is String ? board['title'] as String : null,
      features: const ['objects', 'ext'],
    );
    _camera = CameraController(cam);
    _controller = BoardController(source, presenceInterval: Duration.zero);
    unawaited(_controller!.start());
  }

  @override
  Widget build(BuildContext context) {
    final pv = session.preview.value;
    final controller = _controller;
    final live = session.ui.view?.widget;
    return Scaffold(
      body: pv == null || controller == null
          ? const SizedBox.shrink()
          : Column(
              children: [
                Expanded(
                  child: BoardView(
                    key: ValueKey('version-preview-${pv.seq}'),
                    controller: controller,
                    camera: _camera,
                    images: live?.images,
                    fonts: live?.fonts ?? const BoardFonts(),
                    fitOnLoad: false,
                    reportPresence: false,
                  ),
                ),
                _PreviewBar(session: session, preview: pv),
              ],
            ),
    );
  }
}

/// The web's phone bar „Vorschau: Stand von …“ with „Versionen“, „Wiederherstellen“ and ✕.
class _PreviewBar extends StatelessWidget {
  const _PreviewBar({required this.session, required this.preview});
  final VersionsSession session;
  final VersionPreview preview;

  @override
  Widget build(BuildContext context) {
    final theme = session.ui.theme;
    final v = preview.version;
    return Material(
      key: const Key('stachelVersionBar'),
      color: theme.ink,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 10, 8, 10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  const Icon(Icons.history, color: Colors.white, size: 20),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Vorschau: Stand von ${whenLabel(v.createdAt)}',
                          style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 15),
                        ),
                        Text(
                          '${v.name != null ? '„${v.name}“ · ' : ''}${describeVersion(v)} · nur ansehen',
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(color: Color(0xFFC8C8C2), fontSize: 13),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    key: const Key('stachelVersionClose'),
                    tooltip: 'Zurück zum aktuellen Stand',
                    color: Colors.white,
                    icon: const Icon(Icons.close),
                    onPressed: session.closePreview,
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Wrap(
                alignment: WrapAlignment.end,
                spacing: 8,
                runSpacing: 6,
                children: [
                  OutlinedButton(
                    key: const Key('stachelVersionList'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: Colors.white,
                      side: const BorderSide(color: Color(0xFF5A5A55), width: 1.5),
                    ),
                    onPressed: () => session.ui.openRegisteredSheet(context, versionsSheet),
                    child: const Text('Versionen'),
                  ),
                  FilledButton(
                    key: const Key('stachelVersionBarRestore'),
                    style: FilledButton.styleFrom(backgroundColor: theme.accent),
                    onPressed: () => unawaited(confirmRestore(context, session, v)),
                    child: const Text('Wiederherstellen'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
