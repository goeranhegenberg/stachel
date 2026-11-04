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

/// Key letters of the web's tools (web `defineTool({key})`, docs/features/desktop.md): shown in the tooltips of the
/// large-window tool bar („Haftnotiz (N)“).
const webToolKeys = {
  'select': 'V',
  'hand': 'H',
  'desktop.hand': 'H',
  'sticky': 'N',
  'text': 'T',
  'shape': 'S',
  'connector': 'L',
  'pen': 'P',
  'eraser': 'E',
  'frame': 'F',
  'collab.comment': 'C',
};

/// Tooltip of a tool button: its name, with the web's key letter if it has one.
String toolTooltip(ToolDef t) {
  final k = webToolKeys[t.id];
  return k == null ? t.label : '${t.label} ($k)';
}

/// Large windows (desktop, tablet – UX-Review P12, [BoardDesktop.isWide]): the tool bar as a floating panel at the left
/// edge of the board like the web – every tool (also the phone's „Weitere Werkzeuge“ and tools hidden on the phone,
/// e.g. the hand), icons with tooltips incl. the web's key letter, Rückgängig/Wiederholen at the bottom. The active
/// tool's options stand in a panel to the right of the bar instead of above a bottom bar.
class BoardSideToolbar extends StatelessWidget {
  const BoardSideToolbar({super.key, required this.ui, this.enabled = true, this.beforeHistory});

  final BoardUi ui;

  /// False while editing is paused (offline too long, read only).
  final bool enabled;

  /// Runs before undo/redo (the board ends writing first).
  final VoidCallback? beforeHistory;

  /// Width of the bar's buttons.
  static const button = 44.0;

  /// Width of the options panel next to the bar.
  static const optionsWidth = 420.0;

  List<ToolDef> _tools() => [
    for (final t in ui.registry.tools.list())
      if (t.available?.call(ui) ?? true) t,
  ];

  @override
  Widget build(BuildContext context) {
    final theme = ui.theme;
    final tools = _tools();
    final active = tools.where((t) => t.isActive(ui) && t.options != null).firstOrNull;
    final c = ui.controller;
    Widget iconButton(String key, String tip, IconData icon, {bool on = false, VoidCallback? onTap}) => Tooltip(
      message: tip,
      preferBelow: false,
      child: Semantics(
        button: true,
        selected: on,
        label: tip,
        child: InkWell(
          key: Key(key),
          borderRadius: BorderRadius.circular(6),
          onTap: onTap,
          child: Container(
            width: button,
            height: button - 4,
            alignment: Alignment.center,
            decoration: on ? BoxDecoration(color: theme.accent, borderRadius: BorderRadius.circular(6)) : null,
            child: Icon(
              icon,
              size: 22,
              color: onTap == null ? theme.grey.withValues(alpha: 0.45) : (on ? Colors.white : theme.ink),
            ),
          ),
        ),
      ),
    );
    void history(void Function() run) {
      beforeHistory?.call();
      run();
    }

    final bar = theme.panelOf(
      key: const Key('stachelSideToolbar'),
      padding: const EdgeInsets.all(4),
      // the tools scroll in a low window, Rückgängig/Wiederholen stay visible at the bottom
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Flexible(
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  for (final t in tools)
                    iconButton(
                      t.keyName ?? 'stachelTool-${t.id}',
                      toolTooltip(t),
                      t.icon,
                      on: t.isActive(ui),
                      onTap: enabled ? () => pickTool(context, ui, t) : null,
                    ),
                ],
              ),
            ),
          ),
          Container(
            width: button - 12,
            height: 1,
            margin: const EdgeInsets.symmetric(vertical: 4),
            color: theme.ink.withValues(alpha: 0.15),
          ),
          iconButton(
            'stachelUndo',
            'Rückgängig (Strg Z)',
            Icons.undo,
            onTap: enabled && c.canUndo ? () => history(c.undo) : null,
          ),
          iconButton(
            'stachelRedo',
            'Wiederholen (Strg Y)',
            Icons.redo,
            onTap: enabled && c.canRedo ? () => history(c.redo) : null,
          ),
        ],
      ),
    );
    return Row(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        bar,
        if (active != null && enabled)
          Padding(
            padding: const EdgeInsets.only(left: 8),
            child: theme.panelOf(
              key: const Key('stachelSideToolOptions'),
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: SizedBox(width: optionsWidth, child: active.options!(context, ui)),
            ),
          ),
      ],
    );
  }
}
