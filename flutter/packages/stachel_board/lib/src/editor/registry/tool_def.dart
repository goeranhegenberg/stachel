import 'package:flutter/widgets.dart';

import '../board_editor.dart';
import 'board_ui.dart';
import 'registry.dart';

/// Where a tool sits on the phone (web `ToolDef.phone`).
enum ToolPlace {
  /// In the bar (the first [phoneBarMax] − 1 if there are more, the rest behind „···“).
  bar,

  /// Always behind „Weitere Werkzeuge“ (rare tools; web `phone: 'more'`).
  more,

  /// Not on the phone (web `phone: 'hide'`, e.g. the hand tool; the eraser lives in the pen options).
  hide,
}

/// At most this many buttons fit the phone's tool bar (web `COMPACT_MAX`); with more, the last one is „···“.
const phoneBarMax = 9;

/// A pointer event of a feature tool on the board (world and screen point, object under it).
class BoardToolEvent {
  const BoardToolEvent({
    required this.editor,
    required this.world,
    required this.screen,
    this.objectId,
    this.moved = false,
  });
  final BoardEditor editor;
  final Offset world;
  final Offset screen;
  final String? objectId;

  /// End of a drawing gesture: the finger moved beyond the slop.
  final bool moved;
}

/// What a registered feature tool does on the board (web `ToolDef.down`): tap, or – with [draws] – one finger draws
/// (start/update/end/cancel; two fingers still zoom).
class BoardToolBehavior {
  const BoardToolBehavior({
    this.draws = false,
    this.onTap,
    this.onDrawStart,
    this.onDrawUpdate,
    this.onDrawEnd,
    this.onDrawCancel,
  });

  final bool draws;
  final void Function(BoardToolEvent e)? onTap;
  final void Function(BoardToolEvent e)? onDrawStart;
  final void Function(BoardToolEvent e)? onDrawUpdate;
  final void Function(BoardToolEvent e)? onDrawEnd;
  final void Function(BoardEditor editor)? onDrawCancel;
}

/// A tool of the tool bar (web `defineTool`). Core tools carry their [tool] (enum of the editor); feature tools a
/// [behavior] (the editor then runs `BoardTool.feature` with [id]); entries with neither are actions (Bild, Vorlagen):
/// [onPick] runs, nothing stays active.
class ToolDef implements RegistryEntry {
  const ToolDef({
    required this.id,
    required this.label,
    required this.icon,
    required this.order,
    this.shortLabel,
    this.phone = ToolPlace.bar,
    this.tool,
    this.behavior,
    this.once = true,
    this.keyName,
    this.moreKey,
    this.subtitle,
    this.hint,
    this.options,
    this.onPick,
    this.available,
    this.active,
  });

  @override
  final String id;

  /// Full German name (overflow sheet, accessibility): „Haftnotiz“.
  final String label;

  /// Short name under the icon in the bar („NOTIZ“); null = [label] in capitals.
  final String? shortLabel;
  final IconData icon;
  @override
  final double order;
  final ToolPlace phone;

  /// Core tool of the editor.
  final BoardTool? tool;

  /// Feature tool on the board (tap/draw).
  final BoardToolBehavior? behavior;

  /// One-shot (back to Auswahl after one use: Notiz, Text, Form, Rahmen, Verbinder) vs. staying (Stift, Radierer,
  /// Stempel) – web C19.
  final bool once;

  /// Widget key of the bar button (tests, `stachelTool…`) and of the tile in the overflow sheet ([moreKey] wins there).
  final String? keyName;
  final String? moreKey;

  /// Second line in the overflow sheet.
  final String? subtitle;

  /// Hint over the board while the tool is active („Tippe auf das Board: …“); null = none.
  final String? Function(BoardUi ui)? hint;

  /// Option strip above the bar while the tool is active (pen colors, line style …).
  final Widget Function(BuildContext context, BoardUi ui)? options;

  /// Instead of just switching to the tool (shape picker first, image picker, mind map template …).
  final Future<void> Function(BuildContext context, BoardUi ui)? onPick;

  /// Shown at all (e.g. only with a server action, only with a host service); null = always.
  final bool Function(BoardUi ui)? available;

  /// Shown as active (default: the editor's current tool is this one).
  final bool Function(BoardUi ui)? active;

  bool get isAction => tool == null && behavior == null;

  String get barLabel => shortLabel ?? label.toUpperCase();

  bool isActive(BoardUi ui) {
    final a = active;
    if (a != null) return a(ui);
    if (isAction) return false;
    return ui.editor.activeToolId == (tool?.name ?? id);
  }
}

/// The phone bar from [tools] (web `Toolbar` compact): tools without [ToolPlace] first, `more` ones at the end, at
/// most [max] buttons – with more, the first `max − 1` and the rest behind „···“.
({List<ToolDef> shown, List<ToolDef> more}) phoneToolBar(List<ToolDef> tools, {int max = phoneBarMax}) {
  final all = [
    for (final t in tools)
      if (t.phone == ToolPlace.bar) t,
    for (final t in tools)
      if (t.phone == ToolPlace.more) t,
  ];
  if (all.length <= max) return (shown: all, more: const []);
  return (shown: all.sublist(0, max - 1), more: all.sublist(max - 1));
}
