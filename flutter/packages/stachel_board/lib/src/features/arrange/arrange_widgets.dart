import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../editor/registry/board_ui.dart';
import '../../model/board_object.dart';
import '../../render/board_scene.dart';
import '../core/core_widgets.dart';
import 'arrange.dart';

Color _hex(String? s, [Color fallback = const Color(0xFF0A0A0A)]) {
  final v = s == null ? null : int.tryParse(s.replaceFirst('#', ''), radix: 16);
  if (v == null) return fallback;
  return Color(s!.length == 9 ? v : 0xFF000000 | v);
}

/// Black or white text on [c] (web `textOn`).
Color _textOn(Color c) => c.computeLuminance() > 0.45 ? const Color(0xFF0A0A0A) : Colors.white;

/// „Ausrichten“ popover as a sheet (web `ctx-pop--arrange`): six directions, distribute from three units.
class AlignSheet extends StatelessWidget {
  const AlignSheet({super.key, required this.ui});
  final BoardUi ui;

  static const _icons = {
    'left': Icons.align_horizontal_left,
    'hcenter': Icons.align_horizontal_center,
    'right': Icons.align_horizontal_right,
    'top': Icons.align_vertical_top,
    'vcenter': Icons.align_vertical_center,
    'bottom': Icons.align_vertical_bottom,
  };

  @override
  Widget build(BuildContext context) {
    final units = arrangeUnitCount(ui);
    Widget btn(String key, String label, IconData icon, VoidCallback? onTap) => Tooltip(
      message: label,
      child: IconButton(
        key: Key(key),
        icon: Icon(icon),
        color: ui.theme.ink,
        onPressed: onTap == null
            ? null
            : () {
                Navigator.of(context).pop();
                onTap();
              },
      ),
    );
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 0, 12, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('AUSRICHTEN', style: ui.theme.label(size: 15)),
            const SizedBox(height: 8),
            Wrap(
              spacing: 4,
              children: [
                for (final (mode, _, label) in alignModes)
                  btn('stachelAlign-$mode', label, _icons[mode]!, () => alignSelection(ui, mode)),
                btn(
                  'stachelDistribute-x',
                  'Horizontal verteilen',
                  Icons.horizontal_distribute,
                  units < 3 ? null : () => distributeSelection(ui, 'x'),
                ),
                btn(
                  'stachelDistribute-y',
                  'Vertikal verteilen',
                  Icons.vertical_distribute,
                  units < 3 ? null : () => distributeSelection(ui, 'y'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Tags of the selected notes (web `TagsPop`): the board's tags on/off (alphabetical, ✓), a new tag (≤ 40 characters)
/// with one of 8 colors; the same name keeps its color; at most 8 per note. The keyboard does not open by itself (like
/// the web on touch devices).
class TagsSheet extends StatefulWidget {
  const TagsSheet({super.key, required this.ui});
  final BoardUi ui;

  @override
  State<TagsSheet> createState() => _TagsSheetState();
}

class _TagsSheetState extends State<TagsSheet> {
  final _label = TextEditingController();
  String? _color;

  BoardUi get ui => widget.ui;

  @override
  void initState() {
    super.initState();
    ui.controller.addListener(_changed);
  }

  @override
  void dispose() {
    ui.controller.removeListener(_changed);
    _label.dispose();
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final all = boardTags(ui.controller.state.objects.values);
    final sel = ui.editor.selected;
    final next = tagColors[all.length % tagColors.length];
    final full = sel.any((o) => o.tags.length >= tagMax);
    bool on(BoardTag t) => sel.isNotEmpty && sel.every((o) => hasTag(o, t));
    void add() {
      var l = _label.text.trim();
      if (l.isEmpty) return;
      if (l.length > tagMaxLen) l = l.substring(0, tagMaxLen);
      // the same name as an existing tag: its color (one tag = one color on the board)
      final known = all.where((t) => t.label.toLowerCase() == l.toLowerCase()).firstOrNull;
      setTag(ui, known ?? BoardTag(l, _color ?? next), true);
      _label.clear();
      setState(() => _color = null);
    }

    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(16, 0, 16, 16 + MediaQuery.viewInsetsOf(context).bottom),
        child: Column(
          key: const Key('stachelTagsSheet'),
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('TAGS', style: ui.theme.label(size: 15)),
            const SizedBox(height: 8),
            if (all.isNotEmpty)
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  for (final t in all)
                    () {
                      final active = on(t);
                      final bg = _hex(t.color, const Color(0xFFC9E14A));
                      return ActionChip(
                        key: Key('stachelTag-${t.label}'),
                        backgroundColor: bg,
                        side: BorderSide(color: active ? ui.theme.ink : Colors.transparent, width: 2),
                        label: Text('${active ? '✓ ' : ''}${t.label}', style: TextStyle(color: _textOn(bg))),
                        onPressed: !active && full ? null : () => setTag(ui, t, !active),
                      );
                    }(),
                ],
              ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    key: const Key('stachelTagInput'),
                    controller: _label,
                    maxLength: tagMaxLen,
                    decoration: const InputDecoration(hintText: 'Neuer Tag', counterText: ''),
                    onChanged: (_) => setState(() {}),
                    onSubmitted: (_) => add(),
                  ),
                ),
                const SizedBox(width: 8),
                FilledButton(
                  key: const Key('stachelTagAdd'),
                  onPressed: _label.text.trim().isEmpty || full ? null : add,
                  child: const Text('HINZUFÜGEN'),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              children: [
                for (final c in tagColors)
                  GestureDetector(
                    key: Key('stachelTagColor-$c'),
                    onTap: () => setState(() => _color = c),
                    child: Container(
                      padding: const EdgeInsets.all(2),
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        border: Border.all(color: (_color ?? next) == c ? ui.theme.ink : Colors.transparent, width: 2),
                      ),
                      child: ColorSwatchDot(c, ink: ui.theme.ink, size: 26),
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// „Link zu Rahmen oder Objekt“ (web `LinkPop`): the current link, the frames of the board, „Ziel auf dem Board
/// wählen …“, „Link entfernen“.
class LinkToSheet extends StatelessWidget {
  const LinkToSheet({super.key, required this.ui});
  final BoardUi ui;

  @override
  Widget build(BuildContext context) {
    final sel = ui.editor.selected;
    final ids = [for (final o in sel) o.id];
    final single = sel.length == 1 ? sel.single : null;
    final current = single?.linkTo == null ? null : ui.controller.state[single!.linkTo!];
    final frames = [
      for (final o in ui.controller.state.objects.values)
        if (o.type == 'frame' && isVisibleObject(o) && !ids.contains(o.id)) o,
    ];
    void close() => Navigator.of(context).pop();
    return SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.7),
        child: ListView(
          key: const Key('stachelLinkToSheet'),
          shrinkWrap: true,
          children: [
            ListTile(title: Text('LINK ZU …', style: ui.theme.label(size: 15))),
            if (current != null)
              ListTile(
                dense: true,
                leading: const Icon(Icons.link),
                title: Text('Verlinkt mit „${linkTargetName(current)}“'),
              ),
            for (final f in frames)
              ListTile(
                key: Key('stachelLinkFrame-${f.id}'),
                leading: const Icon(Icons.crop_free),
                title: Text(linkTargetName(f)),
                selected: single?.linkTo == f.id,
                onTap: () {
                  close();
                  setLink(ui, ids, f.id);
                },
              ),
            ListTile(
              key: const Key('stachelLinkPick'),
              leading: const Icon(Icons.ads_click),
              title: const Text('Ziel auf dem Board wählen …'),
              onTap: () {
                close();
                ArrangeModes.of(ui).startPicking(ids);
              },
            ),
            if (sel.any((o) => o.linkTo != null))
              ListTile(
                key: const Key('stachelLinkRemove'),
                leading: Icon(Icons.link_off, color: ui.theme.danger),
                title: Text('Link entfernen', style: TextStyle(color: ui.theme.danger)),
                onTap: () {
                  close();
                  setLink(ui, ids, null);
                },
              ),
          ],
        ),
      ),
    );
  }
}

/// Jump buttons at the top right of linked objects (web `tools-linkto`: from 24 px on screen, pink if the target is
/// gone) and the dashed outline of hidden objects while „Ausgeblendete zeigen“ is on.
class LinkBadges extends StatelessWidget {
  const LinkBadges({super.key, required this.ui});
  final BoardUi ui;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: Listenable.merge([ui.controller, ui.editor.camera, ui.editor]),
    builder: (context, _) {
      final cam = ui.editor.camera.value;
      final size = ui.editor.viewSize;
      final picking = ArrangeModes.of(ui).picking.value != null;
      final badges = <Widget>[];
      final hidden = <Rect>[];
      for (final o in ui.controller.state.objects.values) {
        if (o.hidden && showHiddenObjects) hidden.add(cam.rectToScreen(objectRect(o)));
        if (picking || o.linkTo == null || !linkable(o) || !isVisibleObject(o)) continue;
        final r = objectRect(o);
        if (r.width * cam.z < 24 && r.height * cam.z < 24) continue;
        final p = cam.toScreen(r.topRight);
        if (size != Size.zero && (p.dx < -20 || p.dy < -20 || p.dx > size.width + 20 || p.dy > size.height + 20)) {
          continue;
        }
        final t = ui.controller.state[o.linkTo!];
        final ok = t != null && isVisibleObject(t);
        badges.add(
          Positioned(
            left: p.dx - 12,
            top: p.dy - 12,
            child: Tooltip(
              message: ok ? 'Gehe zu: ${linkTargetName(t)}' : ArrangeTexts.linkGone,
              child: GestureDetector(
                key: Key('stachelLinkBadge-${o.id}'),
                behavior: HitTestBehavior.opaque,
                onTap: () => followLink(ui, o),
                child: Container(
                  width: 24,
                  height: 24,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: ok ? ui.theme.ink : const Color(0xFFEC4E92),
                    border: Border.all(color: Colors.white, width: 1.5),
                  ),
                  child: const Icon(Icons.call_made, size: 14, color: Colors.white),
                ),
              ),
            ),
          ),
        );
      }
      return Stack(
        fit: StackFit.expand,
        children: [
          if (hidden.isNotEmpty) IgnorePointer(child: CustomPaint(painter: _HiddenOutlines(hidden))),
          ...badges,
        ],
      );
    },
  );
}

/// Dashed blue outline 3 px outside hidden objects (web: `outline: 2px dashed`, `outline-offset: 3px`).
class _HiddenOutlines extends CustomPainter {
  _HiddenOutlines(this.rects);
  final List<Rect> rects;

  @override
  void paint(Canvas canvas, Size size) {
    final p = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2
      ..color = const Color(0xE61763B5);
    for (final r in rects) {
      final path = Path()..addRect(r.inflate(4));
      for (final m in path.computeMetrics()) {
        for (var d = 0.0; d < m.length; d += 10) {
          canvas.drawPath(m.extractPath(d, math.min(d + 6, m.length)), p);
        }
      }
    }
  }

  @override
  bool shouldRepaint(covariant _HiddenOutlines old) => true;
}
