// Desktop-Symbole der Stachel-App aus der Bildmarke (web/public/favicon.svg, 64er-Raster): schwarze Kachel mit
// abgerundeten Ecken, weißer Stachel, grüner Kopf. Rechnet jede Größe für sich (16-fach überabgetastet, damit kleine
// Größen scharf bleiben) und schreibt
//   windows/runner/resources/app_icon.ico             Windows (16 … 256 px, Exe, Startmenü, Installer)
//   windows/packaging/stachel_logo.png                MSIX (512 px; das msix-Paket rechnet daraus die Kacheln)
//   linux/packaging/icons/hicolor/<n>x<n>/apps/…png   Linux (.deb, AppImage, Snap; Name = Anwendungs-ID)
// Aufruf in flutter/app: dart run tool/gen_desktop_icons.dart   (docs/release/desktop.md)
import 'dart:io';
import 'dart:math' as math;

import 'package:image/image.dart' as img;

const appId = 'com.intsode.stachel';

const _ink = (0x0a, 0x0a, 0x0a);
const _white = (0xff, 0xff, 0xff);
const _green = (0xc9, 0xe1, 0x4a);

void main() {
  final ico = img.IcoEncoder().encodeImages([for (final s in [16, 20, 24, 32, 40, 48, 64, 128, 256]) render(s)]);
  _write('windows/runner/resources/app_icon.ico', ico);
  _write('windows/packaging/stachel_logo.png', img.encodePng(render(512)));
  for (final s in [16, 24, 32, 48, 64, 128, 256, 512]) {
    _write('linux/packaging/icons/hicolor/${s}x$s/apps/$appId.png', img.encodePng(render(s)));
  }
}

void _write(String path, List<int> bytes) {
  File(path)
    ..parent.createSync(recursive: true)
    ..writeAsBytesSync(bytes);
  stdout.writeln('$path (${bytes.length} B)');
}

/// The mark at [size] px: coverage per pixel from 16×16 samples, colors blended over transparent.
img.Image render(int size) {
  const n = 16;
  final out = img.Image(width: size, height: size, numChannels: 4);
  final unit = 64 / size;
  for (var py = 0; py < size; py++) {
    for (var px = 0; px < size; px++) {
      var r = 0.0, g = 0.0, b = 0.0, a = 0.0;
      for (var sy = 0; sy < n; sy++) {
        for (var sx = 0; sx < n; sx++) {
          final x = (px + (sx + 0.5) / n) * unit, y = (py + (sy + 0.5) / n) * unit;
          final c = _colorAt(x, y);
          if (c == null) continue;
          r += c.$1;
          g += c.$2;
          b += c.$3;
          a += 1;
        }
      }
      if (a == 0) continue;
      out.setPixelRgba(px, py, (r / a).round(), (g / a).round(), (b / a).round(), (255 * a / (n * n)).round());
    }
  }
  return out;
}

/// Color of the mark at (x, y) in the 64-unit box, null = outside. Order like the SVG (later shapes on top).
(int, int, int)? _colorAt(double x, double y) {
  if (!_roundedRect(x, y, 64, 14)) return null;
  if (_dist(x, y, 32, 17) <= 8) return _green;
  if (_pin(x, y)) return _white;
  return _ink;
}

bool _roundedRect(double x, double y, double size, double r) {
  if (x < 0 || y < 0 || x > size || y > size) return false;
  final cx = x.clamp(r, size - r), cy = y.clamp(r, size - r);
  return _dist(x, y, cx, cy) <= r;
}

/// `M32 54 L27.5 24 a4.5 4.5 0 0 1 9 0 Z`: triangle (32,54)–(27.5,24)–(36.5,24) plus the half disc on top of its base.
bool _pin(double x, double y) {
  if (y <= 24) return _dist(x, y, 32, 24) <= 4.5;
  if (y > 54) return false;
  final half = 4.5 * (54 - y) / 30;
  return (x - 32).abs() <= half;
}

double _dist(double x, double y, double cx, double cy) => math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
