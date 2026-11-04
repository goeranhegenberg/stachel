// Camera math: screen = world × z + (x, y); zoom around an anchor, limits, fit, pinch tracking, inertia.
import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

void main() {
  test('Welt ↔ Bildschirm in beide Richtungen', () {
    const c = Camera(100, -50, 2);
    expect(c.toScreen(const Offset(10, 10)), const Offset(120, -30));
    expect(c.toWorld(const Offset(120, -30)), const Offset(10, 10));
    expect(c.viewRect(const Size(400, 200)), const Rect.fromLTWH(-50, 25, 200, 100));
    expect(c.rectToScreen(const Rect.fromLTWH(0, 0, 10, 10)), const Rect.fromLTWH(100, -50, 20, 20));
  });

  test('zoomAt hält den Weltpunkt unter dem Anker fest und begrenzt 5 %…400 %', () {
    const c = Camera(30, 40, 1);
    const anchor = Offset(200, 100);
    final before = c.toWorld(anchor);
    final z = c.zoomAt(anchor, 2.5);
    expect(z.z, 2.5);
    expect(z.toWorld(anchor).dx, closeTo(before.dx, 1e-9));
    expect(z.toWorld(anchor).dy, closeTo(before.dy, 1e-9));
    expect(c.zoomAt(anchor, 100).z, maxZoom);
    expect(c.zoomAt(anchor, 0.0001).z, minZoom);
  });

  test('fit passt ein Rechteck mit Rand ein, höchstens 100 %', () {
    final c = Camera.fit(const Rect.fromLTWH(0, 0, 1000, 500), const Size(580, 380), padding: const FitPadding.all(40));
    expect(c.z, 0.5);
    expect(c.toScreen(const Offset(500, 250)), const Offset(290, 190));
    expect(Camera.fit(const Rect.fromLTWH(0, 0, 10, 10), const Size(500, 500)).z, 1);
    expect(Camera.fit(const Rect.fromLTWH(0, 0, 1e7, 10), const Size(500, 500)).z, minZoom);
  });

  test('Pinch: Weltpunkt unter den Fingern bleibt, auch beim Verschieben', () {
    const start = Camera(0, 0, 1);
    final t = PinchTracker(start, const Offset(100, 100));
    final c = t.update(const Offset(150, 120), 2);
    expect(c.z, 2);
    expect(c.toWorld(const Offset(150, 120)), const Offset(100, 100));
    // pan only (one finger)
    expect(t.update(const Offset(110, 90), 1), const Camera(10, -10, 1));
  });

  test('Trägheit: Strecke wächst und läuft aus, Dauer endlich', () {
    final i = PanInertia(const Offset(1000, 0));
    expect(i.offsetAt(0), Offset.zero);
    final d1 = i.offsetAt(0.1).dx, d2 = i.offsetAt(0.5).dx, dEnd = i.offsetAt(10).dx;
    expect(d1, greaterThan(0));
    expect(d2, greaterThan(d1));
    expect(dEnd - i.offsetAt(5).dx, lessThan(1));
    expect(i.duration, greaterThan(0));
    expect(i.duration, lessThan(3));
    expect(i.speedAt(i.duration), closeTo(20, 0.01));
    expect(PanInertia(const Offset(5, 0)).duration, 0);
  });
}
