import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../model/board_object.dart';
import '../registry/board_ui.dart';
import '../registry/context_action_def.dart';
import '../registry/registry.dart';
import 'multi_select_chip.dart';

/// German description of the selection for the context bar: „Haftnotiz: Bühne“, „3 Objekte“, an unknown type with
/// the hint to look at it in the browser.
String describeSelection(BoardRegistry registry, List<BoardObject> objs) {
  if (objs.isEmpty) return '';
  if (objs.length > 1) return '${objs.length} Objekte';
  return describeObject(registry, objs.single);
}

/// „Art: erste Zeile“ from the type registry ([TypeBehavior.label]/[TypeBehavior.describe]).
String describeObject(BoardRegistry registry, BoardObject o) {
  if (!o.isKnownType) return 'Neuer Objekttyp „${o.type}“ – im Browser ansehen';
  final t = registry.typeOf(o.type);
  final own = t?.describe;
  if (own != null) return own(o);
  final kind = t?.label ?? o.type;
  final text = (o.type == 'frame' ? o.title : o.displayText)?.trim() ?? '';
  return text.isEmpty ? kind : '$kind: ${text.split('\n').first}';
}

/// The entries of the context bar for the current selection, in registry order (web `contextActions.list()`).
List<CtxItem> contextItems(BuildContext context, BoardUi ui, List<BoardObject> objs) => [
  for (final (i, _) in contextEntries(context, ui, objs)) i,
];

/// [contextItems] with the section of each entry in the overflow sheet (item's own, else its definition's, else
/// [CtxSection.more]).
List<(CtxItem, CtxSection)> contextEntries(BuildContext context, BoardUi ui, List<BoardObject> objs) {
  if (objs.isEmpty) return const [];
  final info = CtxInfo(objs);
  return [
    for (final a in ui.registry.contextActions.list())
      if (a.appliesTo(info, ui))
        for (final i in a.items(context, ui, info)) (i, i.section ?? a.section ?? CtxSection.more),
  ];
}

/// How the phone bar splits [items] (UX P4): the [CtxItem.primary] ones first (labeled, [labelW] each), then the
/// others in registry order as icon buttons while they fit next to a labeled „Mehr“; [more] = the rest.
({List<CtxItem> primary, List<CtxItem> inline, List<CtxItem> more}) splitContextItems(
  List<CtxItem> items,
  double avail, {
  double labelW = BoardContextBar.labelWidth,
}) {
  final primary = [
    for (final i in items)
      if (i.primary) i,
  ];
  final rest = [
    for (final i in items)
      if (!i.primary) i,
  ];
  final left = avail - primary.length * labelW;
  final n = fitCount([for (final i in rest) i.width], left, moreW: labelW);
  return (primary: primary, inline: rest.sublist(0, n), more: rest.sublist(n));
}

/// Context bar of the selection, docked at the bottom on the phone instead of the tool bar (web D44 < 700 px): what
/// it is (and „gesperrt“), the switch „Mehrfachauswahl“ (D02), the entries of the registry. UX P4: the core actions
/// (Farbe, Text, Kommentar, Duplizieren, Löschen – [CtxItem.primary]) stand labeled in the row, what does not fit lies
/// behind „Mehr“ („Weitere Aktionen“, grouped by [CtxSection]). Popovers are sheets that a new selection closes
/// ([BoardUi.openSheet]).
class BoardContextBar extends StatelessWidget {
  const BoardContextBar({super.key, required this.ui, this.label, this.onClose, this.floating = false});

  final BoardUi ui;

  /// Large windows ([BoardFloatingContextBar]): one row of icon buttons with tooltips (like the web's bar over the
  /// selection), the rest behind „Mehr“; no label row.
  final bool floating;

  /// Widest a floating bar gets.
  static const floatingMaxWidth = 760.0;

  /// Overrides [describeSelection].
  final String? label;
  final VoidCallback? onClose;

  static const moreWidth = 48.0;

  /// Width of a labeled button (core action, „Mehr“) when the row has room; on a phone they share the row evenly.
  static const labelWidth = 64.0;

  @override
  Widget build(BuildContext context) {
    final editor = ui.editor;
    final objs = editor.selected;
    if (objs.isEmpty) return const SizedBox.shrink();
    final theme = ui.theme;
    final locked = objs.every((o) => o.locked);
    final text = label ?? describeSelection(ui.registry, objs);
    final entries = contextEntries(context, ui, objs);
    final items = [for (final (i, _) in entries) i];
    final sections = {for (final (i, s) in entries) i.key: s};
    if (floating) return _floatingBar(context, items, sections, locked: locked, text: text);
    return ui.theme.panelOf(
      key: const Key('stachelBoardSelection'),
      padding: const EdgeInsets.fromLTRB(12, 6, 2, 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              if (locked)
                Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: Icon(Icons.lock_outline, size: 18, color: theme.grey),
                ),
              Expanded(
                child: Text(
                  locked ? '$text · gesperrt' : text,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
              ),
              MultiSelectChip(ui: ui), // UX P6

              IconButton(
                tooltip: 'Auswahl aufheben',
                visualDensity: VisualDensity.compact,
                icon: const Icon(Icons.close),
                onPressed:
                    onClose ??
                    () {
                      editor.multiSelect = false;
                      editor.select(const {});
                    },
              ),
            ],
          ),
          LayoutBuilder(
            builder: (context, c) {
              final split = splitContextItems(items, c.maxWidth);
              final more = split.more;
              final labeled = [
                for (final i in split.primary)
                  _labeled(context, i.key, i.short ?? i.label, i, () => i.onTap(context, ui)),
                if (more.isNotEmpty)
                  _labeled(context, 'stachelCtxMore', 'Mehr', null, () => _more(context, more, sections)),
              ];
              // phone: the labeled buttons share the row (nothing else inline); wide: fixed width, then the icons
              if (split.inline.isEmpty && labeled.length * labelWidth >= c.maxWidth - labelWidth) {
                return Row(children: [for (final w in labeled) Expanded(child: w)]);
              }
              return Row(
                children: [
                  for (final w in labeled.take(split.primary.length)) SizedBox(width: labelWidth, child: w),
                  for (final i in split.inline) _button(context, i),
                  if (more.isNotEmpty) SizedBox(width: labelWidth, child: labeled.last),
                ],
              );
            },
          ),
        ],
      ),
    );
  }

  Widget _floatingBar(
    BuildContext context,
    List<CtxItem> items,
    Map<String, CtxSection> sections, {
    required bool locked,
    required String text,
  }) {
    final editor = ui.editor;
    return LayoutBuilder(
      builder: (context, c) {
        final avail = (c.maxWidth.isFinite ? c.maxWidth : floatingMaxWidth) - 2 * moreWidth - (locked ? 30 : 0) - 16;
        final n = fitCount([for (final i in items) i.width], avail, moreW: 0);
        final more = items.sublist(n);
        return ui.theme.panelOf(
          key: const Key('stachelBoardSelection'),
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
          child: Tooltip(
            message: locked ? '$text · gesperrt' : text,
            waitDuration: const Duration(milliseconds: 800),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (locked)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 6),
                    child: Icon(Icons.lock_outline, size: 18, color: ui.theme.grey),
                  ),
                for (final i in items.take(n)) _button(context, i),
                if (more.isNotEmpty)
                  SizedBox(
                    width: moreWidth,
                    child: IconButton(
                      key: const Key('stachelCtxMore'),
                      tooltip: 'Weitere Aktionen',
                      onPressed: () => _more(context, more, sections),
                      icon: Icon(Icons.more_horiz, color: ui.theme.ink),
                    ),
                  ),
                SizedBox(
                  width: moreWidth,
                  child: IconButton(
                    tooltip: 'Auswahl aufheben (Esc)',
                    onPressed:
                        onClose ??
                        () {
                          editor.multiSelect = false;
                          editor.select(const {});
                        },
                    icon: const Icon(Icons.close),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Color _color(CtxItem i) => i.danger ? ui.theme.danger : (i.active ? ui.theme.accentDark : ui.theme.ink);

  /// Icon with a short label below (core actions and „Mehr“); [i] null = „Mehr“.
  Widget _labeled(BuildContext context, String key, String text, CtxItem? i, VoidCallback onTap) {
    final color = i == null ? ui.theme.ink : _color(i);
    return Tooltip(
      message: i?.label ?? 'Weitere Aktionen',
      child: Semantics(
        button: true,
        selected: i?.active,
        child: InkWell(
          key: Key(key),
          borderRadius: BorderRadius.circular(8),
          onTap: onTap,
          child: Container(
            height: 52,
            decoration: i != null && i.active
                ? BoxDecoration(color: ui.theme.accent.withValues(alpha: 0.18), borderRadius: BorderRadius.circular(8))
                : null,
            padding: const EdgeInsets.symmetric(horizontal: 2),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                SizedBox(
                  height: 26,
                  child: Center(
                    child: i?.leading?.call(context) ?? Icon(i?.icon ?? Icons.more_horiz, size: 22, color: color),
                  ),
                ),
                const SizedBox(height: 2),
                FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Text(
                    text,
                    maxLines: 1,
                    style: TextStyle(fontSize: 11.5, height: 1.1, fontWeight: FontWeight.w600, color: color),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _button(BuildContext context, CtxItem i) => SizedBox(
    width: i.width,
    child: IconButton(
      key: Key(i.key),
      tooltip: i.label,
      isSelected: i.active,
      style: i.active ? IconButton.styleFrom(backgroundColor: ui.theme.accent.withValues(alpha: 0.18)) : null,
      onPressed: () => i.onTap(context, ui),
      icon: i.leading?.call(context) ?? Icon(i.icon, color: _color(i)),
    ),
  );

  /// „Weitere Aktionen“: [more] under the headings of their sections (order of [CtxSection]; registry order inside;
  /// no heading when everything is in one section).
  Future<void> _more(BuildContext context, List<CtxItem> more, Map<String, CtxSection> sections) async {
    final groups = <CtxSection, List<CtxItem>>{
      for (final s in CtxSection.values)
        s: [
          for (final i in more)
            if ((sections[i.key] ?? CtxSection.more) == s) i,
        ],
    }..removeWhere((_, l) => l.isEmpty);
    final headings = groups.length > 1;
    final picked = await ui.openSheet<CtxItem>(
      context,
      (ctx) => SafeArea(
        child: SingleChildScrollView(
          child: Column(
            key: const Key('stachelCtxMoreSheet'),
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              ListTile(dense: true, title: Text('WEITERE AKTIONEN', style: ui.theme.label(size: 14))),
              for (final MapEntry(key: s, value: list) in groups.entries) ...[
                if (headings) sectionHeading(ui, s.title, key: 'stachelCtxSection-${s.name}'),
                for (final i in list)
                  ListTile(
                    key: Key(i.key),
                    dense: true,
                    visualDensity: const VisualDensity(vertical: -1),
                    leading: i.leading?.call(ctx) ?? Icon(i.icon, color: i.danger ? ui.theme.danger : ui.theme.ink),
                    title: Text(i.label, style: TextStyle(fontSize: 15, color: i.danger ? ui.theme.danger : null)),
                    selected: i.active,
                    onTap: () => Navigator.of(ctx).pop(i),
                  ),
              ],
              const SizedBox(height: 8),
            ],
          ),
        ),
      ),
      scrollControlled: true,
    );
    if (picked != null && context.mounted) picked.onTap(context, ui);
  }
}

/// Large windows (desktop, tablet – UX-Review P12): the context bar floats above the selection like the web's (centered,
/// below it when there is no room above, always inside the view) and follows camera and selection. Hidden while the
/// selection is being dragged, resized or rotated.
class BoardFloatingContextBar extends StatelessWidget {
  const BoardFloatingContextBar({super.key, required this.ui, this.leftInset = 0});

  final BoardUi ui;

  /// Room kept free at the left edge (the side tool bar).
  final double leftInset;

  /// Space between the selection's box and the bar (room for the rotate handle above it).
  static const gap = 44.0;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: Listenable.merge([ui.editor.camera, ui.editor.selection, ui.editor, ui.controller]),
    builder: (context, _) {
      final editor = ui.editor;
      final ids = editor.selection.value;
      final box = ids.isEmpty ? null : editor.selectionBounds(ids);
      if (box == null || editor.dragging || editor.handling) return const SizedBox.shrink();
      final screen = editor.camera.value.rectToScreen(box);
      return CustomSingleChildLayout(
        delegate: _FloatingBarLayout(screen, leftInset: leftInset),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: BoardContextBar.floatingMaxWidth),
          child: BoardContextBar(ui: ui, floating: true),
        ),
      );
    },
  );
}

/// Places the floating bar centered above [selection] (screen), below it without room, clamped into the view.
class _FloatingBarLayout extends SingleChildLayoutDelegate {
  _FloatingBarLayout(this.selection, {required this.leftInset});
  final Rect selection;
  final double leftInset;

  static const margin = 8.0;

  @override
  BoxConstraints getConstraintsForChild(BoxConstraints constraints) =>
      BoxConstraints.loose(Size(math.max(0, constraints.maxWidth - leftInset - 2 * margin), constraints.maxHeight));

  @override
  Offset getPositionForChild(Size size, Size child) {
    final minX = leftInset + margin, maxX = math.max(minX, size.width - child.width - margin);
    final x = (selection.center.dx - child.width / 2).clamp(minX, maxX);
    var y = selection.top - BoardFloatingContextBar.gap - child.height;
    if (y < margin) y = selection.bottom + BoardFloatingContextBar.gap;
    y = y.clamp(margin, math.max(margin, size.height - child.height - margin));
    return Offset(x, y);
  }

  @override
  bool shouldRelayout(_FloatingBarLayout old) => old.selection != selection || old.leftInset != leftInset;
}

/// Small grey heading of a group in a sheet (context bar „Mehr“, board menu).
Widget sectionHeading(BoardUi ui, String title, {String? key}) => Padding(
  key: key == null ? null : Key(key),
  padding: const EdgeInsets.fromLTRB(16, 14, 16, 4),
  child: Text(title, style: ui.theme.label(size: 12.5, color: ui.theme.grey)),
);
