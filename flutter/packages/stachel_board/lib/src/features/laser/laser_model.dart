import 'dart:ui';

// Port of the web's `features/collab/laser.ts`: own trail as awareness message, the others' trails from their
// messages (filling gaps), fading points.

/// Life of a trail point (ms, web `LASER_LIFE`).
const laserLife = 900;

/// So many last points go into the awareness (web `LASER_SEND`).
const laserSend = 24;

class TrailPoint {
  const TrailPoint(this.x, this.y, this.t, {this.gap = false});
  final double x;
  final double y;

  /// Time received/drawn (ms, monotonic).
  final int t;

  /// Starts a new stroke (not joined with the point before).
  final bool gap;

  Offset get offset => Offset(x, y);
}

/// Own trail: collects points, builds the message `{s, p, g?}` (web `LaserSender`).
class LaserSender {
  int _seq = 0;
  final _recent = <({int n, int x, int y, bool gap})>[];
  bool _nextGap = true;

  /// A new stroke begins.
  void begin() => _nextGap = true;

  Map<String, Object?> add(Offset p) {
    _seq++;
    _recent.add((n: _seq, x: _jsRound(p.dx), y: _jsRound(p.dy), gap: _nextGap));
    _nextGap = false;
    if (_recent.length > laserSend) _recent.removeAt(0);
    return msg();
  }

  Map<String, Object?> msg() {
    final g = [
      for (final r in _recent)
        if (r.gap) r.n,
    ];
    return {
      's': _seq,
      'p': [
        for (final r in _recent) ...[r.x, r.y],
      ],
      if (g.isNotEmpty) 'g': g,
    };
  }
}

int _jsRound(double v) => (v + 0.5).floorToDouble().toInt();

/// Someone else's trail: takes new points of a message (with the time received), drops old ones (web
/// `LaserReceiver`).
class LaserReceiver {
  int _last = 0;
  final points = <TrailPoint>[];

  /// Takes a message; true = new points.
  bool take(Object? msg, int now) {
    if (msg is! Map) return false;
    final s = msg['s'], p = msg['p'];
    if (s is! num || p is! List || p.length.isOdd || !p.every((n) => n is num && n.isFinite)) return false;
    final seq = s.toInt();
    final g = msg['g'] is List ? (msg['g'] as List).whereType<num>().map((n) => n.toInt()).toSet() : const <int>{};
    if (seq < _last) _last = 0; // page reloaded: counting starts again
    final count = p.length ~/ 2;
    final first = seq - count + 1;
    var added = false;
    for (var i = 0; i < count; i++) {
      final n = first + i;
      if (n <= _last) continue;
      // missed points or a marked new start separate the stroke
      final gap = g.contains(n) || (i == 0 && n != _last + 1);
      points.add(TrailPoint((p[i * 2] as num).toDouble(), (p[i * 2 + 1] as num).toDouble(), now, gap: gap));
      added = true;
    }
    if (seq > _last) _last = seq;
    prune(now);
    return added;
  }

  void prune(int now) {
    final cut = now - laserLife;
    var i = 0;
    while (i < points.length && points[i].t < cut) {
      i++;
    }
    if (i > 0) points.removeRange(0, i);
  }
}

/// Segments of a trail with their opacity (0–1) by age (web `trailSegments`).
List<({Offset a, Offset b, double alpha})> trailSegments(List<TrailPoint> points, int now) {
  final out = <({Offset a, Offset b, double alpha})>[];
  for (var i = 1; i < points.length; i++) {
    final b = points[i];
    if (b.gap) continue;
    final alpha = 1 - (now - b.t) / laserLife;
    if (alpha > 0) out.add((a: points[i - 1].offset, b: b.offset, alpha: alpha));
  }
  return out;
}
