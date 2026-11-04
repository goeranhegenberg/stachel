import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../editor/registry/board_ui.dart';
import '../../model/board_object.dart';
import '../../render/board_scene.dart' show isVisibleObject, objectRect;
import '../../render/text_layout.dart' show BoardFonts;
import 'doc_pages.dart';
import 'documents.dart';

// The web's world slot of „documents“ (`controls.tsx`): file name top right above the document and the page bar
// „‹ 3 / 12 ›“ at the bottom inside it (same size at every zoom, rotate with the object, from 120 px screen width,
// also while presenting), placeholders of running uploads, rendering missing pages after 1.5 s and fixing the
// mirrored `imageId`.

const _pink = Color(0xFFE5398B);
const _blue = Color(0xFF1763B5);

/// Overlay `documents.controls` (order 12, presenting).
class DocumentLayer extends StatefulWidget {
  const DocumentLayer({super.key, required this.ui});
  final BoardUi ui;

  @override
  State<DocumentLayer> createState() => _DocumentLayerState();
}

class _DocumentLayerState extends State<DocumentLayer> {
  BoardUi get ui => widget.ui;
  Documents get docs => Documents.of(ui);

  /// `id:page` → timer that renders the missing current page.
  final _timers = <String, Timer>{};

  @override
  void dispose() {
    for (final t in _timers.values) {
      t.cancel();
    }
    docs.closeAll();
    super.dispose();
  }

  /// Documents near the view (web `visibleDocs`: one object size around the screen).
  List<BoardObject> _visible(Size size) {
    final cam = ui.editor.camera.value;
    final view = Rect.fromPoints(cam.toWorld(Offset.zero), cam.toWorld(Offset(size.width, size.height)));
    return [
      for (final o in ui.controller.state.objects.values)
        if (isDoc(o) && isVisibleObject(o) && !o.hidden)
          if (objectRect(o).overlaps(view.inflate(math.max(o.w, o.h)))) o,
    ];
  }

  /// Mirror right, then missing current pages of visible documents after a short wait (web `LAZY_FILL_MS`). Runs
  /// after the frame (it may send web actions, which notify the controller).
  void _schedule(List<String> ids) {
    if (!mounted || !docs.canFill) return;
    final wanted = <String>{};
    for (final id in ids) {
      final o = docs.doc(id);
      if (o == null) continue;
      final p = currentPage(o);
      final img = pageImage(o, p);
      if (img != null) {
        if (o.imageId != img) docs.repairMirror(o);
        continue;
      }
      final key = '${o.id}:$p';
      wanted.add(key);
      _timers.putIfAbsent(key, () {
        return Timer(lazyFillDelay, () {
          _timers.remove(key);
          final now = docs.doc(o.id);
          if (now != null && currentPage(now) == p && pageImage(now, p) == null) {
            unawaited(docs.ensurePage(o.id, p).catchError((Object _) => null));
          }
        });
      });
    }
    for (final k in [..._timers.keys]) {
      if (!wanted.contains(k)) _timers.remove(k)?.cancel();
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: Listenable.merge([ui.controller, ui.editor.camera, ui.editor, docs.uploads]),
    builder: (context, _) {
      final size = ui.editor.viewSize;
      final cam = ui.editor.camera.value;
      final visible = size == Size.zero ? const <BoardObject>[] : _visible(size);
      final ids = [for (final o in visible) o.id];
      WidgetsBinding.instance.addPostFrameCallback((_) => _schedule(ids));
      final children = <Widget>[];
      for (final u in docs.uploads.value) {
        final r = cam.rectToScreen(u.rect);
        children.add(
          Positioned.fromRect(
            rect: r,
            child: IgnorePointer(
              child: _UploadPlaceholder(
                key: ValueKey('stachelDocUpload-${u.key}'),
                name: u.name,
                scale: math.min(1, r.width / 220),
              ),
            ),
          ),
        );
      }
      for (final o in visible) {
        if (o.w * cam.z < docMinScreenW) continue;
        final n = pageCount(o);
        final p = currentPage(o);
        final angle = o.rotation * math.pi / 180;
        final center = cam.toScreen(Offset(o.x + o.w / 2, o.y + o.h / 2));
        Offset at(double dx, double dy) =>
            center + Offset(dx * math.cos(angle) - dy * math.sin(angle), dx * math.sin(angle) + dy * math.cos(angle));
        final topRight = at(o.w * cam.z / 2, -o.h * cam.z / 2);
        children.add(
          Positioned(
            left: topRight.dx,
            top: topRight.dy,
            child: Transform.rotate(
              angle: angle,
              alignment: Alignment.topLeft,
              child: FractionalTranslation(
                translation: const Offset(-1, -1),
                child: IgnorePointer(
                  child: Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: ConstrainedBox(
                      constraints: BoxConstraints(maxWidth: o.w * cam.z * 0.7),
                      child: DocumentName(key: ValueKey('stachelDocName-${o.id}'), name: o.docName ?? 'PDF'),
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
        if (n > 1) {
          final bottom = at(0, o.h * cam.z / 2);
          children.add(
            Positioned(
              left: bottom.dx,
              top: bottom.dy,
              child: Transform.rotate(
                angle: angle,
                alignment: Alignment.topLeft,
                child: FractionalTranslation(
                  translation: const Offset(-0.5, -1),
                  child: Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: DocumentPager(
                      key: ValueKey('stachelDocPager-${o.id}'),
                      id: o.id,
                      page: p,
                      count: n,
                      enabled: docs.canPage,
                      onStep: (d) => docs.stepPage(o.id, d),
                    ),
                  ),
                ),
              ),
            ),
          );
        }
      }
      // own text style: the overlay may sit outside a Material (no debug underline)
      return DefaultTextStyle(
        style: const TextStyle(color: Color(0xFF0A0A0A), fontSize: 14, decoration: TextDecoration.none),
        child: Stack(fit: StackFit.expand, clipBehavior: Clip.hardEdge, children: children),
      );
    },
  );
}

/// Name label (web `.documents-name`): pink document icon + file name, Barlow Condensed 600 13 px.
class DocumentName extends StatelessWidget {
  const DocumentName({super.key, required this.name});
  final String name;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      const Icon(Icons.description_outlined, size: 14, color: _pink),
      const SizedBox(width: 5),
      Flexible(
        child: Text(
          name,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            fontFamily: BoardUiScope.maybeOf(context)?.theme.condensedFont ?? const BoardFonts().condensed,
            fontSize: 13,
            fontWeight: FontWeight.w600,
            letterSpacing: 13 * 0.04,
            height: 1.2,
            color: const Color(0xFF3A3A36),
          ),
        ),
      ),
    ],
  );
}

/// Page bar „‹ 3 / 12 ›“ (web `.documents-pager`, touch size 40 px).
class DocumentPager extends StatelessWidget {
  const DocumentPager({
    super.key,
    required this.id,
    required this.page,
    required this.count,
    required this.onStep,
    this.enabled = true,
  });
  final String id;
  final int page;
  final int count;
  final bool enabled;
  final void Function(int d) onStep;

  @override
  Widget build(BuildContext context) {
    Widget button(String key, IconData icon, String label, int d, bool on) => Semantics(
      button: true,
      label: label,
      enabled: on,
      child: GestureDetector(
        key: Key(key),
        behavior: HitTestBehavior.opaque,
        onTap: on ? () => onStep(d) : null,
        child: SizedBox(
          width: 40,
          height: 40,
          child: Icon(icon, size: 22, color: Colors.white.withValues(alpha: on ? 1 : 0.32)),
        ),
      ),
    );
    return Semantics(
      container: true,
      label: 'Seiten',
      child: Container(
        padding: const EdgeInsets.all(3),
        decoration: const BoxDecoration(
          color: Color(0xDB0A0A0A),
          borderRadius: BorderRadius.all(Radius.circular(999)),
          boxShadow: [BoxShadow(color: Color(0x73000000), blurRadius: 14, offset: Offset(0, 4), spreadRadius: -4)],
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            button('stachelDocPrev-$id', Icons.chevron_left, DocumentTexts.prev, -1, enabled && page > 0),
            ConstrainedBox(
              constraints: const BoxConstraints(minWidth: 52),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 4),
                child: Text(
                  pageLabel(page, count),
                  key: Key('stachelDocPage-$id'),
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontFamily: const BoardFonts().regular,
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    height: 1,
                    color: Colors.white,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
              ),
            ),
            button('stachelDocNext-$id', Icons.chevron_right, DocumentTexts.next, 1, enabled && page < count - 1),
          ],
        ),
      ),
    );
  }
}

/// Placeholder of a running upload (web `.documents-upload`): white, dashed blue border, pulsing icon, name.
class _UploadPlaceholder extends StatefulWidget {
  const _UploadPlaceholder({super.key, required this.name, required this.scale});
  final String name;
  final double scale;

  @override
  State<_UploadPlaceholder> createState() => _UploadPlaceholderState();
}

class _UploadPlaceholderState extends State<_UploadPlaceholder> with SingleTickerProviderStateMixin {
  late final _pulse = AnimationController(vsync: this, duration: const Duration(milliseconds: 1200));

  @override
  void initState() {
    super.initState();
    // web: pulse unless reduced motion
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && !(MediaQuery.maybeDisableAnimationsOf(context) ?? false)) _pulse.repeat();
    });
  }

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => CustomPaint(
    painter: _DashedBorder(),
    child: ColoredBox(
      color: Colors.white.withValues(alpha: 0.001),
      child: Center(
        child: Transform.scale(
          scale: widget.scale,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 220),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                AnimatedBuilder(
                  animation: _pulse,
                  builder: (_, child) => Opacity(opacity: 1 - 0.65 * math.sin(_pulse.value * math.pi), child: child),
                  child: const Icon(Icons.description_outlined, size: 28, color: _blue),
                ),
                const SizedBox(height: 4),
                for (final t in [widget.name, DocumentTexts.preparing])
                  Text(
                    t,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontFamily: const BoardFonts().regular,
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      height: 1.25,
                      color: _blue,
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}

class _DashedBorder extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawRect(Offset.zero & size, Paint()..color = Colors.white);
    final p = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2
      ..color = _blue.withValues(alpha: 0.55);
    final path = Path()..addRect((Offset.zero & size).deflate(1));
    for (final m in path.computeMetrics()) {
      for (var d = 0.0; d < m.length; d += 10) {
        canvas.drawPath(m.extractPath(d, math.min(d + 6, m.length)), p);
      }
    }
  }

  @override
  bool shouldRepaint(_DashedBorder oldDelegate) => false;
}
