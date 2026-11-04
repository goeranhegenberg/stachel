import 'package:flutter/material.dart';

import '../../editor/board_editor.dart';
import '../../editor/desktop.dart';
import '../../editor/registry/menu_item_def.dart';
import '../../editor/registry/registry.dart';
import '../../editor/registry/tool_def.dart';
import 'shortcuts_help.dart';

/// Desktop: mouse and keyboard like the web (docs/features/desktop.md). The keyboard itself is a widget
/// ([BoardKeyboard] in `keyboard.dart`, the app puts it around the board); here:
///
/// - Werkzeug `hand` · 20 „Verschieben“ (web: key H, hidden on the phone): dragging pans the view.
/// - Board-Menü `view.wheelMode` · 55 „Mausrad“ Zoomen/Schwenken (web: same id, not on touch devices) and
///   `tools.boardKeys` · 90 „Tastenkürzel“ (web: not on touch devices) – both only in the desktop app.
void registerDesktop(BoardRegistry r) {
  r.defineTool(
    ToolDef(
      id: 'hand',
      label: 'Verschieben',
      icon: Icons.pan_tool_outlined,
      order: 20,
      phone: ToolPlace.hide,
      once: false,
      keyName: 'stachelToolHand',
      subtitle: 'Ansicht verschieben',
      behavior: handToolBehavior,
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'view.wheelMode',
      on: MenuTarget.board,
      order: 55,
      section: MenuSection.view,
      entry: (ui, at) => !BoardDesktop.enabled
          ? null
          : MenuEntry(
              key: 'stachelBoardWheel',
              label: 'Mausrad',
              icon: Icons.mouse_outlined,
              subtitle: BoardDesktop.wheel.value == WheelMode.zoom ? 'Zoomen' : 'Schwenken',
              onSelect: (context, ui) =>
                  setWheelMode(BoardDesktop.wheel.value == WheelMode.zoom ? WheelMode.pan : WheelMode.zoom),
            ),
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'tools.boardKeys',
      on: MenuTarget.board,
      order: 90,
      section: MenuSection.more,
      entry: (ui, at) => !BoardDesktop.enabled
          ? null
          : MenuEntry(
              key: 'stachelBoardKeys',
              label: 'Tastenkürzel',
              icon: Icons.keyboard_outlined,
              onSelect: (context, ui) => showBoardShortcuts(context, ui),
            ),
    ),
  );
}

/// Last screen point of the hand tool's drag per editor.
final _handFrom = Expando<Offset>('handFrom');

/// The hand tool (web `hand`): one finger or the mouse drags the view.
final handToolBehavior = BoardToolBehavior(
  draws: true,
  onDrawStart: (e) => _handFrom[e.editor] = e.screen,
  onDrawUpdate: (e) => _pan(e.editor, e.screen),
  onDrawEnd: (e) => _pan(e.editor, e.screen),
  onDrawCancel: (editor) => _handFrom[editor] = null,
);

void _pan(BoardEditor editor, Offset screen) {
  final from = _handFrom[editor];
  if (from != null) editor.camera.panBy(screen - from);
  _handFrom[editor] = screen;
}
