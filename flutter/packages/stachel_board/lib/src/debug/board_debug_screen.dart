import 'dart:async';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

import '../editor/board_view.dart';
import '../editor/camera.dart';
import '../fixtures/all_types_board.dart';
import '../fixtures/board_generator.dart';
import '../model/board_object.dart';
import '../model/board_source.dart';
import '../protocol/native_messages.dart';
import '../render/board_images.dart';
import '../render/board_painter.dart';
import '../render/text_layout.dart';

/// Boards of the debug screen.
enum DebugBoard {
  allTypes('Alle Objekttypen'),
  mixed2000('2 000 Objekte'),
  mixed5000('5 000 Objekte');

  const DebugBoard(this.label);
  final String label;

  Map<String, Object?> json() => switch (this) {
    DebugBoard.allTypes => allTypesBoardJson(),
    DebugBoard.mixed2000 => mixedBoardJson(2000),
    DebugBoard.mixed5000 => mixedBoardJson(5000),
  };
}

/// Native renderer without server: fixture board or synthetic 2 000/5 000 objects, live frame times
/// (UI/raster from [FrameTiming]), visible objects, „Alles zeigen“, tap shows the object.
class BoardDebugScreen extends StatefulWidget {
  const BoardDebugScreen({
    super.key,
    this.initial = DebugBoard.allTypes,
    this.fonts = const BoardFonts(),
    this.onOpenInBrowser,
  });

  final DebugBoard initial;
  final BoardFonts fonts;

  /// „Im Browser ansehen“ for a tapped object (null hides the button).
  final void Function(BoardObject object)? onOpenInBrowser;

  @override
  State<BoardDebugScreen> createState() => _BoardDebugScreenState();
}

class _BoardDebugScreenState extends State<BoardDebugScreen> {
  late DebugBoard _board = widget.initial;
  late BoardController _controller;
  final _camera = CameraController();
  final _stats = PaintStats();
  final _images = MemoryBoardImages();
  var _viewKey = GlobalKey<BoardViewState>();
  BoardObject? _selected;
  final _frames = <FrameTiming>[];
  Timer? _tick;

  @override
  void initState() {
    super.initState();
    _load();
    _makeImages();
    SchedulerBinding.instance.addTimingsCallback(_onTimings);
    _tick = Timer.periodic(const Duration(milliseconds: 500), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    SchedulerBinding.instance.removeTimingsCallback(_onTimings);
    _tick?.cancel();
    _controller.dispose();
    _camera.dispose();
    super.dispose();
  }

  void _onTimings(List<FrameTiming> t) {
    _frames.addAll(t);
    if (_frames.length > 120) _frames.removeRange(0, _frames.length - 120);
  }

  void _load() {
    final source = FixtureBoardSource(BoardSnapshot.fromJson(_board.json()));
    _controller = BoardController(source)..start();
    _selected = null;
  }

  /// Benchmark images: 8 colored 800×600 pictures like the web test (plus the fixture's image).
  Future<void> _makeImages() async {
    for (var k = 0; k < 9; k++) {
      final rec = ui.PictureRecorder();
      final c = Canvas(rec);
      c.drawRect(
        const Rect.fromLTWH(0, 0, 400, 300),
        Paint()..color = HSLColor.fromAHSL(1, k * 45.0 % 360, 0.7, 0.55).toColor(),
      );
      c.drawRect(Rect.fromLTWH(50 + k * 10, 50, 150, 100), Paint()..color = Colors.white);
      final img = await rec.endRecording().toImage(400, 300);
      _images.put(k == 8 ? 'img-1' : 'bench-img-$k', img);
    }
  }

  void _switch(DebugBoard b) {
    final old = _controller;
    setState(() {
      _board = b;
      _viewKey = GlobalKey<BoardViewState>();
      _load();
    });
    // the old view lets go of its controller in this frame
    SchedulerBinding.instance.addPostFrameCallback((_) => old.dispose());
  }

  String _frameInfo() {
    if (_frames.isEmpty) return '–';
    double avg(Iterable<Duration> d) => d.fold<int>(0, (s, x) => s + x.inMicroseconds) / d.length / 1000;
    final build = avg(_frames.map((f) => f.buildDuration));
    final raster = avg(_frames.map((f) => f.rasterDuration));
    return 'UI ${build.toStringAsFixed(1)} ms · Raster ${raster.toStringAsFixed(1)} ms';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('Board-Test · ${_board.label}'),
        actions: [
          IconButton(
            key: const Key('boardDebugFit'),
            tooltip: 'Alles zeigen',
            icon: const Icon(Icons.fit_screen_outlined),
            onPressed: () => _viewKey.currentState?.fitAll(),
          ),
          PopupMenuButton<DebugBoard>(
            key: const Key('boardDebugMenu'),
            onSelected: _switch,
            itemBuilder: (_) => [for (final b in DebugBoard.values) PopupMenuItem(value: b, child: Text(b.label))],
          ),
        ],
      ),
      body: Stack(
        children: [
          Positioned.fill(
            child: BoardView(
              key: _viewKey,
              controller: _controller,
              camera: _camera,
              images: _images,
              fonts: widget.fonts,
              stats: _stats,
              onSelect: (o) => setState(() => _selected = o),
            ),
          ),
          Positioned(
            left: 8,
            top: 8,
            child: ValueListenableBuilder(
              valueListenable: _camera,
              builder: (_, cam, _) => _Badge(
                '${(cam.z * 100).round()} % · ${_controller.state.length} Objekte · sichtbar ${_stats.visible}\n'
                'Zeichnen ${(_stats.paintTime.inMicroseconds / 1000).toStringAsFixed(1)} ms · neu ${_stats.recorded} · '
                '${_frameInfo()}',
              ),
            ),
          ),
          if (_selected case final o?)
            Positioned(
              left: 8,
              right: 8,
              bottom: 8,
              child: Material(
                elevation: 4,
                borderRadius: BorderRadius.circular(8),
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          '${o.type} · ${o.id}${o.isKnownType ? '' : ' (unbekannter Typ)'}',
                          key: const Key('boardDebugSelected'),
                        ),
                      ),
                      if (widget.onOpenInBrowser != null)
                        TextButton(
                          onPressed: () => widget.onOpenInBrowser!(o),
                          child: const Text('IM BROWSER ANSEHEN'),
                        ),
                    ],
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  const _Badge(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.7), borderRadius: BorderRadius.circular(6)),
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      child: Text(text, style: const TextStyle(color: Colors.white, fontSize: 12)),
    ),
  );
}
