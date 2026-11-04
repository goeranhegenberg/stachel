import 'dart:math' as math;
import 'dart:ui';

import '../../model/board_object.dart';
import '../../web/web_constants.dart';

/// A frame format (web `FRAME_PRESETS` in features/structure/frames/frames.tsx, from the web constants).
class FramePreset {
  const FramePreset(this.id, this.label, this.w, this.h);
  final String id;
  final String label;
  final double w;
  final double h;

  bool get free => id == 'free';
}

/// Frei 640×420, 16:9, 4:3, A4, A4 quer, Handy, Quadrat (C12).
List<FramePreset> get framePresets => [
  for (final m in WebConstants.instance.maps('frames.presets'))
    FramePreset(m['id'] as String, m['label'] as String, (m['w'] as num).toDouble(), (m['h'] as num).toDouble()),
];

FramePreset framePreset(String? id) => framePresets.firstWhere((p) => p.id == id, orElse: () => framePresets.first);

/// Grid sizes of a frame (web `GRID_SIZES`): Ohne / 50 / 100 / 140 / 200 (E15).
List<double> get frameGridSizes => WebConstants.instance.numbers('frames.gridSizes');

/// Rectangle while drawing a frame (web `presetRect`): with a format the aspect ratio is fixed (the larger side of the
/// drag wins), „Frei“ only with [square].
Rect presetRect(Offset start, Offset end, FramePreset preset, {bool square = false}) {
  var r = Rect.fromPoints(start, end);
  if (!preset.free || square) {
    final ratio = preset.free ? 1.0 : preset.w / preset.h;
    final w = math.max(r.width, r.height * ratio);
    final h = w / ratio;
    final sx = _sign(end.dx - start.dx);
    final sy = _sign(end.dy - start.dy);
    r = Rect.fromPoints(start, Offset(start.dx + sx * w, start.dy + sy * h));
  }
  return r;
}

double _sign(double v) => v == 0 ? 1 : v.sign;

/// Reading order of frames (web `readingOrder` in frames/order.ts): rows top → bottom (same row when the top lies
/// within half the height of the row's first frame), in a row left → right.
List<BoardObject> frameReadingOrder(Iterable<BoardObject> frames) {
  final sorted = stableSorted(frames, (a, b) {
    final c = a.y.compareTo(b.y);
    return c != 0 ? c : a.x.compareTo(b.x);
  });
  final rows = <List<BoardObject>>[];
  for (final f in sorted) {
    final row = rows.isEmpty ? null : rows.last;
    if (row != null && f.y < row.first.y + math.min(row.first.h, f.h) / 2) {
      row.add(f);
    } else {
      rows.add([f]);
    }
  }
  return [for (final r in rows) ...stableSorted(r, (a, b) => a.x.compareTo(b.x))];
}

/// Sorted copy that keeps the order of equal elements (like JavaScript's `Array.sort`; Dart's sort is not stable).
List<T> stableSorted<T>(Iterable<T> items, int Function(T a, T b) compare) {
  final indexed = items.indexed.toList()
    ..sort((a, b) {
      final c = compare(a.$2, b.$2);
      return c != 0 ? c : a.$1.compareTo(b.$1);
    });
  return [for (final e in indexed) e.$2];
}

/// Frames in list order like the web's frame list and presentation (`framesInOrder`): frames with `slide` first (by
/// it, ties in reading order), then the others in reading order. Hidden frames stay in (like the web).
List<BoardObject> framesInOrderWeb(Iterable<BoardObject> objects) {
  final reading = frameReadingOrder([
    for (final o in objects)
      if (o.type == 'frame') o,
  ]);
  final pos = {for (final (i, f) in reading.indexed) f.id: i};
  final keyed =
      [
        for (final f in reading)
          if (f.raw['slide'] is String) f,
      ]..sort((a, b) {
        final c = _cmp(a.raw['slide'] as String, b.raw['slide'] as String);
        return c != 0 ? c : pos[a.id]!.compareTo(pos[b.id]!);
      });
  return [
    ...keyed,
    for (final f in reading)
      if (f.raw['slide'] is! String) f,
  ];
}

/// JS string comparison (UTF-16 code units, like `<` in the web).
int _cmp(String a, String b) {
  final n = math.min(a.length, b.length);
  for (var i = 0; i < n; i++) {
    final d = a.codeUnitAt(i) - b.codeUnitAt(i);
    if (d != 0) return d;
  }
  return a.length - b.length;
}

/// Title of a frame in lists and the presentation (web `f.title || 'Rahmen'`).
String frameTitle(BoardObject f) {
  final t = f.title;
  return t == null || t.isEmpty ? 'Rahmen' : t;
}
