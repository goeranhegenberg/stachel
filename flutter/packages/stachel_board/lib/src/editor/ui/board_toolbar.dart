import 'package:flutter/material.dart';

import '../registry/board_ui.dart';
import '../registry/tool_def.dart';

/// Tool bar at the bottom from the tool registry (web `Toolbar` on the phone, C01): at most [phoneBarMax] buttons,
/// the rest behind „···“ („Weitere Werkzeuge“, a sheet with names); if the active tool lies there, its icon replaces
/// the „···“. The active tool's options (pen colors, line style …) sit above the bar.
///
/// With [history] (UX-Review P1) Rückgängig/Wiederholen sit at the left end – under the thumb instead of the far corner
/// of the app bar – and the bar shows as many tools as fit at [minButton] each (the rest behind „···“).
class BoardToolbar extends StatelessWidget {
  const BoardToolbar({
    super.key,
    required this.ui,
    this.enabled = true,
    this.max = phoneBarMax,
    this.history = false,
    this.beforeHistory,
  });

  final BoardUi ui;

  /// False while editing is paused (offline too long, read only).
  final bool enabled;
  final int max;

  /// Rückgängig/Wiederholen at the left.
  final bool history;

  /// Runs before undo/redo (the board ends writing first, so undo takes back what was just written).
  final VoidCallback? beforeHistory;

  /// Smallest width of a tool button when [history] is on (target size, UX-Review B16).
  static const minButton = 44.0;

  /// Width of the undo/redo buttons.
  static const historyButton = 40.0;

  List<ToolDef> _tools() => [
    for (final t in ui.registry.tools.list())
      if (t.phone != ToolPlace.hide && (t.available?.call(ui) ?? true)) t,
  ];

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, c) {
      var n = max;
      if (history && c.maxWidth.isFinite) n = ((c.maxWidth - 2 * historyButton - 1) / minButton).floor().clamp(4, max);
      return _bar(context, n);
    },
  );

  Widget _historyButtons() {
    final theme = ui.theme;
    final c = ui.controller;
    Widget button(String key, String tip, IconData icon, bool can, void Function() run) => SizedBox(
      width: historyButton,
      child: IconButton(
        key: Key(key),
        tooltip: tip,
        color: theme.ink,
        disabledColor: theme.grey.withValues(alpha: 0.4),
        icon: Icon(icon, size: 22),
        onPressed: enabled && can
            ? () {
                beforeHistory?.call();
                run();
              }
            : null,
      ),
    );
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        button('stachelUndo', 'Rückgängig', Icons.undo, c.canUndo, c.undo),
        button('stachelRedo', 'Wiederholen', Icons.redo, c.canRedo, c.redo),
        Container(width: 1, height: 32, color: theme.ink.withValues(alpha: 0.15)),
      ],
    );
  }

  Widget _bar(BuildContext context, int max) {
    final theme = ui.theme;
    final bar = phoneToolBar(_tools(), max: max);
    final activeMore = bar.more.where((t) => t.isActive(ui)).firstOrNull;
    final active = [...bar.shown, ...bar.more].where((t) => t.isActive(ui) && t.options != null).firstOrNull;
    Widget button(String key, IconData icon, String label, bool isActive, VoidCallback onTap) => Expanded(
      child: InkWell(
        key: Key(key),
        onTap: enabled ? onTap : null,
        child: Semantics(
          button: true,
          selected: isActive,
          label: label,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  padding: const EdgeInsets.all(4),
                  decoration: BoxDecoration(
                    color: isActive ? theme.accent : null,
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Icon(
                    icon,
                    size: 21,
                    color: !enabled ? theme.grey.withValues(alpha: 0.5) : (isActive ? Colors.white : theme.ink),
                  ),
                ),
                const SizedBox(height: 2),
                FittedBox(
                  fit: BoxFit.scaleDown,
                  child: ExcludeSemantics(
                    child: Text(label, maxLines: 1, style: theme.label(color: enabled ? theme.ink : theme.grey)),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );

    return Material(
      color: theme.surface,
      child: Container(
        decoration: BoxDecoration(
          border: Border(top: BorderSide(color: theme.ink, width: 3)),
        ),
        child: SafeArea(
          top: false,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (active != null && enabled) active.options!(context, ui),
              Row(
                children: [
                  if (history) _historyButtons(),
                  for (final t in bar.shown)
                    button(
                      t.keyName ?? 'stachelTool-${t.id}',
                      t.icon,
                      t.barLabel,
                      t.isActive(ui),
                      () => pickTool(context, ui, t),
                    ),
                  if (bar.more.isNotEmpty)
                    button(
                      'stachelToolMore',
                      activeMore?.icon ?? Icons.more_horiz,
                      activeMore?.barLabel ?? 'MEHR',
                      activeMore != null,
                      () => _more(context, bar.more),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _more(BuildContext context, List<ToolDef> more) async {
    final t = await ui.openSheet<ToolDef>(
      context,
      (ctx) => SafeArea(
        child: SingleChildScrollView(
          child: Column(
            key: const Key('stachelToolMoreSheet'),
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(dense: true, title: Text('WEITERE WERKZEUGE', style: ui.theme.label(size: 14))),
              for (final t in more)
                ListTile(
                  key: Key(t.moreKey ?? t.keyName ?? 'stachelTool-${t.id}'),
                  leading: Icon(t.icon, color: t.isActive(ui) ? ui.theme.accentDark : ui.theme.ink),
                  title: Text(t.label),
                  subtitle: t.subtitle == null ? null : Text(t.subtitle!),
                  selected: t.isActive(ui),
                  onTap: () => Navigator.of(ctx).pop(t),
                ),
            ],
          ),
        ),
      ),
      closeOnSelectionChange: false,
    );
    if (t != null && context.mounted) await pickTool(context, ui, t);
  }
}

/// Picks [t] like a tap on its button: its own [ToolDef.onPick] (picker first, action), else the tool itself;
/// tapping the active tool again goes back to Auswahl.
Future<void> pickTool(BuildContext context, BoardUi ui, ToolDef t) async {
  final pick = t.onPick;
  if (pick != null) return pick(context, ui);
  if (t.isAction) return;
  final id = t.tool?.name ?? t.id;
  if (t.isActive(ui) && id != 'select') {
    ui.editor.useTool('select');
  } else {
    ui.editor.useTool(id);
  }
}

/// The hint over the board for the active tool (registry [ToolDef.hint]), null if none.
String? activeToolHint(BoardUi ui) {
  for (final t in ui.registry.tools.list()) {
    if (t.hint != null && t.isActive(ui)) return t.hint!(ui);
  }
  return null;
}
