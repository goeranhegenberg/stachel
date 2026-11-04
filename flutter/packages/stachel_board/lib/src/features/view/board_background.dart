import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../../editor/camera.dart';
import '../../editor/registry/board_ui.dart';
import 'board_prefs.dart';

// Board background from the board settings (M10–M12, web features/tools/settings.ts + background.tsx): pattern
// dots/lines/none and color for everyone (Y map `tools.settings`, written by the web action `tools.settings`), plus
// „Autor:in an Haftnotizen zeigen“ (`authors`, drawn by features/follow/author.dart).

/// Background colors (web `BG_COLORS`, default first) and their names.
const boardBgColors = ['#f3f3ef', '#ffffff', '#fbf6e9', '#f1f4e4', '#e9f1f8', '#fbeff4', '#ecebe6'];
const boardBgNames = {
  '#f3f3ef': 'Hellgrau',
  '#ffffff': 'Weiß',
  '#fbf6e9': 'Papier',
  '#f1f4e4': 'Salbei',
  '#e9f1f8': 'Eisblau',
  '#fbeff4': 'Rosé',
  '#ecebe6': 'Stein',
};
const boardPatterns = ['dots', 'lines', 'none'];
const boardPatternLabels = {'dots': 'Punkte', 'lines': 'Linien', 'none': 'Leer'};

/// Grid of the board in world units (web `GRID`).
const boardGrid = 24.0;

final _hex = RegExp(r'^#[0-9a-fA-F]{6}$');

/// Dark background? (pattern drawn light; web `isDark`).
bool isDarkColor(String hex) {
  if (!_hex.hasMatch(hex)) return false;
  final r = int.parse(hex.substring(1, 3), radix: 16);
  final g = int.parse(hex.substring(3, 5), radix: 16);
  final b = int.parse(hex.substring(5, 7), radix: 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.45;
}

/// The board's settings (web `readSettings`: missing or foreign values → default).
class BoardSettings {
  const BoardSettings({this.pattern = 'dots', this.color = '#f3f3ef', this.authors = false});

  factory BoardSettings.fromExt(Map<String, Object?> ext) {
    final m = ext['tools.settings'];
    final p = m is Map ? m['pattern'] : null;
    final c = m is Map ? m['color'] : null;
    return BoardSettings(
      authors: m is Map && m['authors'] == true,
      pattern: boardPatterns.contains(p) ? p as String : 'dots',
      color: c is String && _hex.hasMatch(c) ? c.toLowerCase() : '#f3f3ef',
    );
  }

  final String pattern;
  final String color;

  /// The creator's name at every sticky note („Autor:in an Haftnotizen zeigen“, web `authors`, for everyone).
  final bool authors;

  bool get dark => isDarkColor(color);

  @override
  bool operator ==(Object other) =>
      other is BoardSettings && other.pattern == pattern && other.color == color && other.authors == authors;

  @override
  int get hashCode => Object.hash(pattern, color, authors);
}

BoardSettings boardSettingsOf(BoardUi ui) => BoardSettings.fromExt(ui.controller.state.ext);

Color hexColor(String hex) => Color(0xFF000000 | int.parse(hex.substring(1), radix: 16));

/// Paints the background like the web's `.board` (dot grid: 24 world units, doubled until ≥ 14 px, dot radius
/// `clamp(z × 1.3, 0.9, 1.6)`, anchored at the camera origin; lines 1 px; light ink on dark colors).
void paintBoardBackground(Canvas canvas, Size size, Camera cam, BoardSettings s) {
  canvas.drawRect(Offset.zero & size, Paint()..color = hexColor(s.color));
  if (s.pattern == 'none') return;
  var gap = boardGrid * cam.z;
  while (gap < 14) {
    gap *= 2;
  }
  final ox = cam.x % gap, oy = cam.y % gap;
  final cols = (size.width / gap).ceil() + 1, rows = (size.height / gap).ceil() + 1;
  if (s.pattern == 'lines') {
    final p = Paint()..color = s.dark ? const Color(0x14FFFFFF) : const Color(0x120A0A0A);
    for (var k = 0; k < cols; k++) {
      canvas.drawRect(Rect.fromLTWH(ox + (k - 1) * gap, 0, 1, size.height), p);
    }
    for (var r = 0; r < rows; r++) {
      canvas.drawRect(Rect.fromLTWH(0, oy + (r - 1) * gap, size.width, 1), p);
    }
    return;
  }
  if (cols * rows > 40000) return;
  final dot = (cam.z * 1.3).clamp(0.9, 1.6).toDouble();
  final pts = Float32List(cols * rows * 2);
  var i = 0;
  for (var r = 0; r < rows; r++) {
    for (var k = 0; k < cols; k++) {
      pts[i++] = ox + (k - 1) * gap + dot;
      pts[i++] = oy + (r - 1) * gap + dot;
    }
  }
  canvas.drawRawPoints(
    ui.PointMode.points,
    pts,
    Paint()
      ..color = s.dark ? const Color(0x38FFFFFF) : const Color(0x330A0A0A)
      ..strokeWidth = dot * 2
      ..strokeCap = StrokeCap.round,
  );
}

/// Hooks the background into the board view's painter (the one hook of `board_painter.dart`).
void installBoardBackground(BoardUi ui) {
  final ctx = ui.view?.renderContext;
  if (ctx == null || ctx.background != null) return;
  ctx.background = (canvas, size, cam) {
    paintBoardBackground(canvas, size, cam, boardSettingsOf(ui));
    return true;
  };
}

/// Writes the settings for everyone (web action, without undo like the web).
void writeBoardSettings(BoardUi ui, {String? pattern, String? color, bool? authors, bool toggleGrid = false}) {
  ui.controller.act('tools.settings', {
    'pattern': ?pattern,
    'color': ?color,
    'authors': ?authors,
    if (toggleGrid) 'toggleGrid': true,
  }, label: toggleGrid ? 'Raster' : (authors != null ? 'Autor:in an Haftnotizen' : 'Hintergrund'));
}

bool canWriteSettings(BoardUi ui) => ui.controller.mayEdit && ui.controller.canAct('tools.settings');

/// „Autor:in an Haftnotizen zeigen“ needs version 2 of the web action (older servers reject `authors`).
bool canWriteAuthors(BoardUi ui) => ui.controller.mayEdit && ui.controller.canAct('tools.settings', 2);

/// Snap to the grid while dragging – only for me (web prefs `snap`); read by the snapping package (P1).
const snapPrefKey = 'stachel.tools.snap';
bool get snapToGridPref => BoardPrefs.get(snapPrefKey) == '1';

// ---- sheet „Board-Einstellungen“ (M11) ----------------------------------------------------------------------------

/// Sheet id of „Board-Einstellungen“ / „Hintergrund & Raster …“.
const boardSettingsSheet = 'tools.settings';

class BoardSettingsSheet extends StatelessWidget {
  const BoardSettingsSheet({super.key, required this.ui});
  final BoardUi ui;

  @override
  Widget build(BuildContext context) {
    final t = ui.theme;
    return SafeArea(
      child: ListenableBuilder(
        listenable: Listenable.merge([ui.controller, BoardPrefs.changes]),
        builder: (context, _) {
          final s = boardSettingsOf(ui);
          final can = canWriteSettings(ui);
          return SingleChildScrollView(
            key: const Key('stachelSettingsSheet'),
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('BOARD-EINSTELLUNGEN', style: t.label(size: 15)),
                const SizedBox(height: 14),
                Text('Hintergrund', style: t.label(size: 13)),
                Text('Gilt für alle auf diesem Board.', style: TextStyle(color: t.grey, fontSize: 13)),
                const SizedBox(height: 8),
                Row(
                  children: [
                    for (final p in boardPatterns)
                      Expanded(
                        child: Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: _PatternChoice(
                            key: Key('stachelPattern-$p'),
                            pattern: p,
                            color: s.color,
                            active: s.pattern == p,
                            ink: t.ink,
                            onTap: can ? () => writeBoardSettings(ui, pattern: p) : null,
                          ),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 12),
                Text('Farbe', style: t.label(size: 13)),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 10,
                  runSpacing: 10,
                  children: [
                    for (final c in boardBgColors)
                      Semantics(
                        label: 'Farbe ${boardBgNames[c]}',
                        selected: s.color == c,
                        button: true,
                        child: InkWell(
                          key: Key('stachelBgColor-$c'),
                          customBorder: const CircleBorder(),
                          onTap: can ? () => writeBoardSettings(ui, color: c) : null,
                          child: Container(
                            width: 40,
                            height: 40,
                            decoration: BoxDecoration(
                              color: hexColor(c),
                              shape: BoxShape.circle,
                              border: Border.all(
                                color: s.color == c ? t.accent : t.ink.withValues(alpha: 0.35),
                                width: s.color == c ? 3 : 1.5,
                              ),
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 16),
                Text('Haftnotizen', style: t.label(size: 13)),
                SwitchListTile(
                  key: const Key('stachelAuthorsSwitch'),
                  contentPadding: EdgeInsets.zero,
                  value: s.authors,
                  onChanged: canWriteAuthors(ui) ? (v) => writeBoardSettings(ui, authors: v) : null,
                  title: const Text('Autor:in an Haftnotizen zeigen'),
                  subtitle: const Text('Gilt für alle. Der Name steht klein unten an jeder Notiz.'),
                ),
                const SizedBox(height: 8),
                Text('Raster', style: t.label(size: 13)),
                SwitchListTile(
                  key: const Key('stachelSnapSwitch'),
                  contentPadding: EdgeInsets.zero,
                  value: snapToGridPref,
                  onChanged: (v) => BoardPrefs.set(snapPrefKey, v ? '1' : null),
                  title: const Text('Am Raster einrasten'),
                  subtitle: const Text('Nur für dich. Beim Ziehen landen Objekte auf dem 24er-Raster.'),
                ),
                Align(
                  alignment: Alignment.centerRight,
                  child: FilledButton(
                    key: const Key('stachelSettingsDone'),
                    onPressed: () => Navigator.of(context).maybePop(),
                    child: const Text('FERTIG'),
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _PatternChoice extends StatelessWidget {
  const _PatternChoice({
    super.key,
    required this.pattern,
    required this.color,
    required this.active,
    required this.ink,
    this.onTap,
  });
  final String pattern;
  final String color;
  final bool active;
  final Color ink;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    selected: active,
    button: true,
    child: InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(6),
        decoration: BoxDecoration(
          border: Border.all(color: active ? ink : ink.withValues(alpha: 0.25), width: active ? 2.5 : 1),
        ),
        child: Column(
          children: [
            SizedBox(
              height: 44,
              child: CustomPaint(
                painter: _PreviewPainter(BoardSettings(pattern: pattern, color: color)),
                size: Size.infinite,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              boardPatternLabels[pattern]!,
              style: TextStyle(fontWeight: active ? FontWeight.w700 : FontWeight.w400),
            ),
          ],
        ),
      ),
    ),
  );
}

class _PreviewPainter extends CustomPainter {
  _PreviewPainter(this.s);
  final BoardSettings s;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.clipRect(Offset.zero & size);
    // preview at 12 px like the web dialog
    paintBoardBackground(canvas, size, const Camera(0, 0, 0.5), s);
  }

  @override
  bool shouldRepaint(_PreviewPainter old) => old.s != s;
}
