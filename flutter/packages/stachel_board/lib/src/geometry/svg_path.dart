import 'dart:ui';

/// Parses SVG path data (`d`) into a [Path]: M L H V C S Q T A Z, absolute and relative, implicit repeats.
///
/// The web builds every shape and icon as SVG path string; parsing the same strings keeps the native shapes
/// identical to the web (and comparable with the web fixtures as text). Malformed data ends the path where it
/// breaks instead of throwing.
Path parseSvgPath(String d) {
  final path = Path();
  final t = _Tokens(d);
  var cx = 0.0, cy = 0.0; // current point
  var sx = 0.0, sy = 0.0; // subpath start
  double? qx, qy; // last quadratic control point (for T)
  double? kx, ky; // last cubic second control point (for S)
  String? cmd;
  while (true) {
    final c = t.command();
    if (c != null) {
      cmd = c;
    } else if (cmd == null || !t.hasNumber) {
      break;
    } else if (cmd == 'M') {
      cmd = 'L'; // numbers after a moveto are implicit linetos
    } else if (cmd == 'm') {
      cmd = 'l';
    }
    final op = cmd;
    final rel = op == op.toLowerCase();
    final ox = rel ? cx : 0.0, oy = rel ? cy : 0.0;
    try {
      switch (op.toUpperCase()) {
        case 'Z':
          path.close();
          cx = sx;
          cy = sy;
          qx = qy = kx = ky = null;
          if (!t.hasNumber && t.peekCommand == null) return path;
          if (t.hasNumber) cmd = null; // numbers after Z are invalid
          continue;
        case 'M':
          cx = ox + t.number();
          cy = oy + t.number();
          sx = cx;
          sy = cy;
          path.moveTo(cx, cy);
          qx = qy = kx = ky = null;
        case 'L':
          cx = ox + t.number();
          cy = oy + t.number();
          path.lineTo(cx, cy);
          qx = qy = kx = ky = null;
        case 'H':
          cx = ox + t.number();
          path.lineTo(cx, cy);
          qx = qy = kx = ky = null;
        case 'V':
          cy = oy + t.number();
          path.lineTo(cx, cy);
          qx = qy = kx = ky = null;
        case 'C':
          final x1 = ox + t.number(), y1 = oy + t.number();
          final x2 = ox + t.number(), y2 = oy + t.number();
          cx = ox + t.number();
          cy = oy + t.number();
          path.cubicTo(x1, y1, x2, y2, cx, cy);
          kx = x2;
          ky = y2;
          qx = qy = null;
        case 'S':
          final x1 = kx == null ? cx : 2 * cx - kx;
          final y1 = ky == null ? cy : 2 * cy - ky;
          final x2 = ox + t.number(), y2 = oy + t.number();
          cx = ox + t.number();
          cy = oy + t.number();
          path.cubicTo(x1, y1, x2, y2, cx, cy);
          kx = x2;
          ky = y2;
          qx = qy = null;
        case 'Q':
          final x1 = ox + t.number(), y1 = oy + t.number();
          cx = ox + t.number();
          cy = oy + t.number();
          path.quadraticBezierTo(x1, y1, cx, cy);
          qx = x1;
          qy = y1;
          kx = ky = null;
        case 'T':
          final x1 = qx == null ? cx : 2 * cx - qx;
          final y1 = qy == null ? cy : 2 * cy - qy;
          cx = ox + t.number();
          cy = oy + t.number();
          path.quadraticBezierTo(x1, y1, cx, cy);
          qx = x1;
          qy = y1;
          kx = ky = null;
        case 'A':
          final rx = t.number().abs(), ry = t.number().abs();
          final rot = t.number();
          final large = t.flag();
          final sweep = t.flag();
          final x = ox + t.number(), y = oy + t.number();
          if (rx == 0 || ry == 0) {
            path.lineTo(x, y);
          } else {
            // SVG sweep-flag 1 = positive angle direction = clockwise on screen (y down), like Flutter's clockwise.
            path.arcToPoint(
              Offset(x, y),
              radius: Radius.elliptical(rx, ry),
              rotation: rot,
              largeArc: large,
              clockwise: sweep,
            );
          }
          cx = x;
          cy = y;
          qx = qy = kx = ky = null;
        default:
          return path; // unknown command
      }
    } on FormatException {
      return path;
    }
  }
  return path;
}

class _Tokens {
  _Tokens(this.s);
  final String s;
  int i = 0;

  static const _commands = 'MmLlHhVvCcSsQqTtAaZz';

  void _skip() {
    while (i < s.length) {
      final c = s.codeUnitAt(i);
      if (c == 0x20 || c == 0x2C || c == 0x09 || c == 0x0A || c == 0x0D) {
        i++;
      } else {
        break;
      }
    }
  }

  String? get peekCommand {
    _skip();
    if (i < s.length && _commands.contains(s[i])) return s[i];
    return null;
  }

  String? command() {
    final c = peekCommand;
    if (c != null) i++;
    return c;
  }

  bool get hasNumber {
    _skip();
    if (i >= s.length) return false;
    final c = s[i];
    return '0123456789.-+'.contains(c);
  }

  /// Arc flags may be written without separators (`a1 1 0 104 4`).
  bool flag() {
    _skip();
    if (i < s.length && (s[i] == '0' || s[i] == '1')) {
      return s[i++] == '1';
    }
    throw const FormatException('flag');
  }

  double number() {
    _skip();
    final start = i;
    if (i < s.length && (s[i] == '-' || s[i] == '+')) i++;
    var dot = false, digits = false;
    while (i < s.length) {
      final c = s[i];
      if (c.codeUnitAt(0) >= 0x30 && c.codeUnitAt(0) <= 0x39) {
        digits = true;
        i++;
      } else if (c == '.' && !dot) {
        dot = true;
        i++;
      } else {
        break;
      }
    }
    if (digits && i < s.length && (s[i] == 'e' || s[i] == 'E')) {
      final save = i;
      i++;
      if (i < s.length && (s[i] == '-' || s[i] == '+')) i++;
      var exp = false;
      while (i < s.length && s.codeUnitAt(i) >= 0x30 && s.codeUnitAt(i) <= 0x39) {
        i++;
        exp = true;
      }
      if (!exp) i = save;
    }
    if (!digits) throw const FormatException('number');
    return double.parse(s.substring(start, i));
  }
}
