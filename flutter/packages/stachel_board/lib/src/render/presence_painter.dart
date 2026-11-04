import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/rendering.dart';

import '../editor/camera.dart';
import '../model/board_source.dart';
import '../protocol/native_messages.dart';
import 'board_scene.dart';
import 'paint_utils.dart';
import 'text_layout.dart';

/// The others on the board in screen space (contract §8.4 `presence`): their selection outlined and their cursor with
/// a name tag, each in the person's color – like the web's `RemoteCursors`/`RemoteSelections`.
class PresencePainter extends CustomPainter {
  PresencePainter({
    required this.controller,
    required this.scene,
    required this.camera,
    required this.text,
    this.fonts = const BoardFonts(),
  }) : super(repaint: Listenable.merge([controller, camera]));

  final BoardController controller;
  final BoardScene scene;
  final ValueListenable<Camera> camera;
  final TextLayoutCache text;
  final BoardFonts fonts;

  /// Pointer arrow (tip at 0,0), like the web's cursor icon.
  static final Path _arrow = Path()
    ..moveTo(0, 0)
    ..lineTo(0, 17)
    ..lineTo(4.6, 12.8)
    ..lineTo(7.8, 19.6)
    ..lineTo(10.6, 18.3)
    ..lineTo(7.5, 11.7)
    ..lineTo(13.2, 11.4)
    ..close();

  @override
  void paint(Canvas canvas, Size size) {
    final peers = controller.peers;
    if (peers.isEmpty) return;
    final cam = camera.value;
    final screen = Offset.zero & size;
    for (final p in peers) {
      final color = parseColor(p.color, BoardColors.blue);
      _selection(canvas, p, color, cam);
      _writing(canvas, p, color, cam);
      final x = p.cursorX, y = p.cursorY;
      if (x == null || y == null) continue;
      final at = cam.toScreen(Offset(x, y));
      if (!screen.inflate(40).contains(at)) continue;
      _cursor(canvas, at, p.name, color);
    }
  }

  void _selection(Canvas c, Peer p, Color color, Camera cam) {
    if (p.selection.isEmpty) return;
    final stroke = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2
      ..color = color;
    for (final id in p.selection) {
      final o = scene.state[id];
      if (o == null || !isVisibleObject(o)) continue;
      if (o.type == 'connector') {
        final g = scene.connector(id);
        if (g == null) continue;
        for (final e in [g.a, g.b]) {
          c.drawCircle(cam.toScreen(e), 5, stroke);
        }
        continue;
      }
      final r = cam.rectToScreen(Rect.fromLTWH(o.x, o.y, o.w, o.h)).inflate(4);
      c.save();
      if (o.rotation != 0) {
        c.translate(r.center.dx, r.center.dy);
        c.rotate(o.rotation * math.pi / 180);
        c.translate(-r.center.dx, -r.center.dy);
      }
      c.drawRect(r, stroke);
      c.restore();
    }
  }

  /// „Mara schreibt …“ above the object someone writes in (web `richtext.caret`, app `editing`).
  void _writing(Canvas c, Peer p, Color color, Camera cam) {
    final id = p.editing;
    final o = id == null ? null : scene.state[id];
    if (o == null || !isVisibleObject(o)) return;
    final r = cam.rectToScreen(objectRect(o));
    final first = p.name.split(' ').first;
    final label = '${first.isEmpty ? 'Jemand' : first} schreibt hier gerade …';
    final tp = text.layout(
      ('peerWriting', label, color.toARGB32()),
      () => TextSpan(
        text: label,
        style: TextStyle(fontFamily: fonts.regular, fontSize: 12, fontWeight: FontWeight.w600, color: textOn(color)),
      ),
      maxWidth: 260,
      align: TextAlign.left,
      fill: false,
    );
    final box = Rect.fromLTWH(r.left, r.top - tp.height - 12, tp.width + 14, tp.height + 6);
    c.drawRRect(RRect.fromRectAndRadius(box, const Radius.circular(5)), Paint()..color = color);
    tp.paint(c, Offset(box.left + 7, box.top + 3));
  }

  void _cursor(Canvas c, Offset at, String name, Color color) {
    c.save();
    c.translate(at.dx, at.dy);
    c.drawPath(
      _arrow,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2.5
        ..strokeJoin = StrokeJoin.round
        ..color = const Color(0xFFFFFFFF),
    );
    c.drawPath(_arrow, Paint()..color = color);
    if (name.isNotEmpty) {
      final tp = text.layout(
        ('peerName', name, color.toARGB32()),
        () => TextSpan(
          text: name,
          style: TextStyle(fontFamily: fonts.regular, fontSize: 12, fontWeight: FontWeight.w600, color: textOn(color)),
        ),
        maxWidth: 160,
        align: TextAlign.left,
        fill: false,
      );
      final box = Rect.fromLTWH(12, 18, tp.width + 12, tp.height + 6);
      c.drawRRect(RRect.fromRectAndRadius(box, const Radius.circular(4)), Paint()..color = color);
      tp.paint(c, Offset(box.left + 6, box.top + 3));
    }
    c.restore();
  }

  @override
  bool shouldRepaint(covariant PresencePainter old) => !identical(old, this);
}
