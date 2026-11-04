import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/rendering.dart';

import '../editor/camera.dart';
import '../model/board_source.dart';
import '../model/collab.dart';
import 'board_scene.dart';

/// Size of a comment pin (screen px).
const commentPinSize = 30.0;

/// A chip under an object: one emoji with its count.
class ReactionChip {
  const ReactionChip(this.objectId, this.group, this.rect);
  final String objectId;
  final ReactionGroup group;

  /// Screen rectangle.
  final Rect rect;
}

/// What the board shows from the feature structures (E3): comment pins (open threads; pink with an unread mention of
/// me), reaction chips under objects, and image upload placeholders (own ones with progress, the others' „… lädt
/// hoch“). [CollabPainter] draws it, the view hit-tests pins and chips through it.
class CollabLayer {
  CollabLayer({required this.controller, required this.scene});

  final BoardController controller;
  final BoardScene scene;

  /// Filter of the comment list, also for the pins on the board (web `CollabUi.filter`, CommentLayer): `open` (default),
  /// `resolved` (only the done ones) or `all`.
  String filter = 'open';

  /// The thread shown right now (its sheet is open): its pin stays visible whatever the filter (web `openThread`).
  String? openThread;

  /// Hide pins altogether (board menu).
  bool showPins = true;

  int _version = -1;
  List<CommentThread> _threads = const [];
  Map<String, List<ReactionGroup>> _reactions = const {};
  Set<String> _unread = const {};

  void _sync() {
    if (_version == controller.extVersion) return;
    _version = controller.extVersion;
    final me = controller.user?.key ?? '';
    _threads = readThreads(controller.state.ext[commentsExt]);
    _reactions = reactionsByObject(controller.state.ext[reactionsExt], me);
    _unread = {for (final (t, _) in unreadMentions(_threads, me, readStateOf(controller.state.ext, me))) t.id};
  }

  List<CommentThread> get threads {
    _sync();
    return _threads;
  }

  /// Threads with an unread mention of me.
  Set<String> get unread {
    _sync();
    return _unread;
  }

  Map<String, List<ReactionGroup>> get reactions {
    _sync();
    return _reactions;
  }

  /// Pins shown (web CommentLayer `visible`): the open thread always, the others with pins on and matching [filter];
  /// not on a hidden object.
  Iterable<CommentThread> get shownThreads sync* {
    for (final t in threads) {
      final open = t.id == openThread;
      final matches = switch (filter) {
        'resolved' => t.resolved,
        'all' => true,
        _ => !t.resolved,
      };
      if (!open && !(showPins && matches)) continue;
      final o = t.objectId == null ? null : controller.state[t.objectId!];
      if (o != null && !isVisibleObject(o) && !open) continue;
      yield t;
    }
  }

  /// A pin being dragged (P5, web L02): thread id and the world point it marks while the finger moves.
  final drag = ValueNotifier<(String, Offset)?>(null);

  /// World point a thread's pin marks (the dragged one follows the finger).
  Offset pinPoint(CommentThread t) {
    final d = drag.value;
    return d != null && d.$1 == t.id ? d.$2 : t.position((id) => controller.state[id]);
  }

  /// Screen center of a thread's pin (the pin sits above right of the point, like a speech bubble); UX P15: where that
  /// would cover a frame's title, it sits below right of the point instead (next to the title, not on it).
  Offset pinCenter(CommentThread t, Camera cam) {
    final p = cam.toScreen(pinPoint(t));
    final up = p + pinOffset;
    if (!_onFrameTitle(Rect.fromCenter(center: up, width: commentPinSize, height: commentPinSize), cam)) return up;
    return p + const Offset(commentPinSize / 2, commentPinSize / 2);
  }

  /// From the marked point to the pin's center (screen px).
  static const pinOffset = Offset(commentPinSize / 2, -commentPinSize / 2);

  /// Height of the title band above a frame on screen (small title 10–14 px × 1.6 + 3, big title ≤ 18 px + pill).
  static const _titleBand = 30.0;

  /// [pin] (screen) overlaps the title band above a visible frame.
  bool _onFrameTitle(Rect pin, Camera cam) {
    final world = Rect.fromLTRB(
      (pin.left - cam.x) / cam.z,
      (pin.top - cam.y) / cam.z,
      (pin.right - cam.x) / cam.z,
      (pin.bottom + _titleBand - cam.y) / cam.z,
    );
    for (final id in scene.grid.query(world)) {
      final o = controller.state[id];
      if (o == null || o.type != 'frame' || !isVisibleObject(o)) continue;
      final r = cam.rectToScreen(Rect.fromLTWH(o.x, o.y, o.w, o.h));
      final band = Rect.fromLTWH(r.left, r.top - _titleBand, math.max(48, r.width), _titleBand);
      if (band.overlaps(pin)) return true;
    }
    return false;
  }

  /// Chips under the visible objects (screen space), at most [max].
  List<ReactionChip> chips(Camera cam, Size size, OverlayText text, {int max = 400}) {
    final out = <ReactionChip>[];
    final view = Offset.zero & size;
    for (final MapEntry(key: id, value: groups) in reactions.entries) {
      final o = controller.state[id];
      if (o == null || !isVisibleObject(o) || groups.isEmpty) continue;
      final r = cam.rectToScreen(objectRect(o));
      // web ReactionLayer: only while the object is at least 48 px wide on screen
      if (r.width < 48 || !r.inflate(40).overlaps(view)) continue;
      var x = r.left;
      final y = r.bottom + 6;
      for (final g in groups) {
        final w = _chipWidth(g, text);
        out.add(ReactionChip(id, g, Rect.fromLTWH(x, y, w, 24)));
        x += w + 4;
        if (out.length >= max) return out;
      }
    }
    return out;
  }

  static double _chipWidth(ReactionGroup g, OverlayText text) => 14 + _label(g, text).width;

  static TextPainter _label(ReactionGroup g, OverlayText text) => text.plain(
    '${g.emoji} ${g.people.length}',
    const TextStyle(fontSize: 13, color: Color(0xFF0A0A0A), fontWeight: FontWeight.w600),
    maxWidth: 200,
  );

  /// Pin or chip at screen point [p]: `('comment', threadId)` / `('reaction', 'objectId|emoji')`; null = none.
  (String, String)? hitAt(Offset p, Camera cam, Size size, OverlayText text) {
    for (final c in chips(cam, size, text).reversed) {
      if (c.rect.inflate(4).contains(p)) return ('reaction', '${c.objectId}|${c.group.emoji}');
    }
    CommentThread? best;
    var bestD = commentPinSize * 0.8;
    for (final t in shownThreads) {
      final d = (pinCenter(t, cam) - p).distance;
      if (d <= bestD) {
        bestD = d;
        best = t;
      }
    }
    return best == null ? null : ('comment', best.id);
  }
}

/// Paints [CollabLayer] (screen space, above the objects): reaction chips, comment pins, upload placeholders.
class CollabPainter extends CustomPainter {
  CollabPainter({required this.layer, required this.camera, required this.text, required Listenable repaint})
    : super(repaint: Listenable.merge([repaint, layer.drag]));

  final CollabLayer layer;
  final ValueListenable<Camera> camera;
  final OverlayText text;

  static const _ink = Color(0xFF0A0A0A);
  static const _pink = Color(0xFFEC4E92);
  static const _blue = Color(0xFF1763B5);

  @override
  void paint(Canvas canvas, Size size) {
    final cam = camera.value;
    _uploads(canvas, cam, size);
    for (final c in layer.chips(cam, size, text)) {
      final rr = RRect.fromRectAndRadius(c.rect, const Radius.circular(12));
      canvas.drawRRect(rr, Paint()..color = c.group.mine ? const Color(0xFFE3EEFA) : const Color(0xFFFFFFFF));
      canvas.drawRRect(
        rr,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = c.group.mine ? 2 : 1
          ..color = c.group.mine ? _blue : const Color(0x330A0A0A),
      );
      final tp = CollabLayer._label(c.group, text);
      tp.paint(canvas, Offset(c.rect.left + 7, c.rect.center.dy - tp.height / 2));
    }
    final unread = layer.unread;
    for (final t in layer.shownThreads) {
      final c = layer.pinCenter(t, cam);
      if (!(Offset.zero & size).inflate(commentPinSize).contains(c)) continue;
      _pin(canvas, c, t, unread.contains(t.id));
    }
  }

  void _pin(Canvas canvas, Offset c, CommentThread t, bool unread) {
    const r = commentPinSize / 2;
    // speech bubble: round with a tip at the bottom left (the commented point)
    final bubble = Path()
      ..addOval(Rect.fromCircle(center: c, radius: r))
      ..moveTo(c.dx - r * 0.7, c.dy + r * 0.2)
      ..lineTo(c.dx - r, c.dy + r)
      ..lineTo(c.dx - r * 0.2, c.dy + r * 0.7)
      ..close();
    final fill = t.resolved ? const Color(0xFFE9E9E4) : (unread ? _pink : const Color(0xFFFFFFFF));
    canvas.drawShadow(bubble, const Color(0x55000000), 2, false);
    canvas.drawPath(bubble, Paint()..color = fill);
    canvas.drawPath(
      bubble,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..color = _ink,
    );
    final tp = text.plain(
      '${t.messages.length}',
      TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: unread ? const Color(0xFFFFFFFF) : _ink),
      maxWidth: 40,
    );
    tp.paint(canvas, c - Offset(tp.width / 2, tp.height / 2));
  }

  void _uploads(Canvas canvas, Camera cam, Size size) {
    final items = <(Rect, Color?, String, double?)>[];
    for (final u in layer.controller.uploads.value) {
      final label = u.waiting ? 'Wartet auf Verbindung …' : 'Wird hochgeladen … ${(u.progress * 100).round()} %';
      items.add((u.rect, _hex(u.color), label, u.waiting ? null : u.progress));
    }
    for (final p in layer.controller.peers) {
      final list = p.extra[uploadsAwareness];
      if (list is! List) continue;
      for (final u in list.take(10)) {
        if (u is! Map) continue;
        final x = u['x'], y = u['y'], w = u['w'], h = u['h'];
        if (x is! num || y is! num || w is! num || h is! num || w <= 0 || h <= 0 || w > 1e5 || h > 1e5) continue;
        final name = p.name.split(' ').first;
        items.add((
          Rect.fromLTWH(x.toDouble(), y.toDouble(), w.toDouble(), h.toDouble()),
          _hex(u['color']),
          '$name lädt hoch …',
          null,
        ));
      }
    }
    for (final (rect, color, label, progress) in items) {
      final r = cam.rectToScreen(rect);
      if (!r.overlaps(Offset.zero & size)) continue;
      canvas.drawRect(r, Paint()..color = (color ?? const Color(0xFFE9E9E4)).withValues(alpha: 0.85));
      canvas.drawRect(
        r,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2
          ..color = _blue,
      );
      if (progress != null) {
        canvas.drawRect(Rect.fromLTWH(r.left, r.bottom - 5, r.width * progress.clamp(0, 1), 5), Paint()..color = _pink);
      }
      final tp = text.plain(
        label,
        const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: _ink),
        maxWidth: math.max(40, r.width - 12),
      );
      final bg = Rect.fromCenter(center: r.center, width: tp.width + 12, height: tp.height + 6);
      canvas.drawRRect(RRect.fromRectAndRadius(bg, const Radius.circular(4)), Paint()..color = const Color(0xE6FFFFFF));
      tp.paint(canvas, r.center - Offset(tp.width / 2, tp.height / 2));
    }
  }

  static Color? _hex(Object? c) {
    if (c is! String || !RegExp(r'^#[0-9a-fA-F]{6}$').hasMatch(c)) return null;
    return Color(int.parse('FF${c.substring(1)}', radix: 16));
  }

  @override
  bool shouldRepaint(covariant CollabPainter old) => !identical(old, this);
}

/// Small cache of one-line labels for overlays (pins, chips, placeholders).
class OverlayText {
  OverlayText({this.family});

  /// Font of the labels (the board's regular font; null = default).
  final String? family;
  final _cache = <String, TextPainter>{};

  TextPainter plain(String s, TextStyle style, {double maxWidth = double.infinity}) {
    final key = '$s|${style.fontSize}|${style.color?.toARGB32()}|${style.fontWeight?.value}|$maxWidth';
    final hit = _cache[key];
    if (hit != null) return hit;
    if (_cache.length > 300) clear();
    final st = style.fontFamily == null && family != null ? style.copyWith(fontFamily: family) : style;
    return _cache[key] = TextPainter(
      text: TextSpan(text: s, style: st),
      textDirection: TextDirection.ltr,
      maxLines: 1,
      ellipsis: '…',
    )..layout(maxWidth: maxWidth);
  }

  void clear() {
    for (final tp in _cache.values) {
      tp.dispose();
    }
    _cache.clear();
  }
}
