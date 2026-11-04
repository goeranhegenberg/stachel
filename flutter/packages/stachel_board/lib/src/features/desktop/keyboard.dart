import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../editor/board_editor.dart';
import '../../editor/board_view.dart';
import '../../editor/camera.dart';
import '../../editor/desktop.dart';
import '../../editor/registry/board_ui.dart';
import '../../editor/registry/menu_item_def.dart';
import '../../editor/registry/tool_def.dart';
import '../../editor/rich_text_field.dart';
import '../../editor/ui/board_context_bar.dart' show contextEntries;
import '../../model/board_object.dart';
import '../../model/board_source.dart';
import '../../protocol/native_messages.dart';
import '../../render/board_scene.dart' show objectRect, isVisibleObject;
import '../arrange/arrange.dart';
import '../clipboard/clipboard.dart';
import '../commands/palette.dart' show showCommandPalette;
import '../cursor_chat/chat_layer.dart' show CursorChatRuntime;
import '../frames/frames_model.dart' show framesInOrderWeb;
import '../frames/present.dart' show Presentation;
import '../richtext/format_bar.dart' show RichFormat, richLinkDialog;
import '../search/search_bar.dart' show openSearch, openReplace, closeSearch;
import '../shapes/catalog.dart' show entryById;
import '../shapes/shape_state.dart' show P2Tools;
import '../text_object/next_note.dart' show editNext;
import '../view/board_prefs.dart';
import '../view/view_camera.dart' show zoomStep, zoomToSelection, fitTo;
import '../view/view_layers.dart' show toggleUi;
import '../view/view_state.dart';
import 'shortcuts_help.dart';

// Keyboard of the board like the web (docs/features/desktop.md §2): `editor/core/shortcuts.ts`, the editor's own keys
// (`Editor.tsx` keyRef.down: Leertaste, Bild ↑/↓, Entf, Esc, Enter, Tab, Pfeile, Tippen, Werkzeug-Tasten) and the
// shortcuts of the feature modules (richtext, mindmap, tools, organize, versions, collab, Toolbar).
//
// Phases in the web's order: while writing only the `editing` shortcuts (format, Tab, Enter in a mind node, Esc);
// on the board the `board` shortcuts, then the editor's own keys, then the `late` ones (+, −, ?, /, R, O – typing on a
// selected note wins over them), then the tool keys. A shortcut whose action does not apply returns false and the next
// one is tried (web: `run() === false`). Strg/⌘ must match exactly, Umschalt/Alt only when named (web `matchKey`).

/// One key combination (web `KeySpec`): `mod+shift+g`, `shift+Digit1`, `PageDown`, `?`, `plus`.
class _Spec {
  _Spec(String spec) {
    final parts = spec.split('+');
    var k = parts.removeLast();
    // „mod++“ is written „mod+plus“
    if (k == 'plus') k = '+';
    key = k;
    mod = parts.contains('mod') || parts.contains('ctrl');
    shift = parts.contains('shift');
    alt = parts.contains('alt');
  }

  late final String key;
  late final bool mod, shift, alt;

  int get specificity => (mod ? 4 : 0) + (shift ? 2 : 0) + (alt ? 1 : 0);
}

/// Named keys (web `KeyboardEvent.key`) and codes (web `KeyboardEvent.code`, the place on the keyboard).
final _logical = <String, List<LogicalKeyboardKey>>{
  'Tab': [LogicalKeyboardKey.tab],
  'Enter': [LogicalKeyboardKey.enter, LogicalKeyboardKey.numpadEnter],
  'Escape': [LogicalKeyboardKey.escape],
  'Delete': [LogicalKeyboardKey.delete],
  'Backspace': [LogicalKeyboardKey.backspace],
  'ArrowLeft': [LogicalKeyboardKey.arrowLeft],
  'ArrowRight': [LogicalKeyboardKey.arrowRight],
  'ArrowUp': [LogicalKeyboardKey.arrowUp],
  'ArrowDown': [LogicalKeyboardKey.arrowDown],
  'PageUp': [LogicalKeyboardKey.pageUp],
  'PageDown': [LogicalKeyboardKey.pageDown],
  'Home': [LogicalKeyboardKey.home],
  'End': [LogicalKeyboardKey.end],
  'F11': [LogicalKeyboardKey.f11],
  ' ': [LogicalKeyboardKey.space],
};
final _physical = <String, PhysicalKeyboardKey>{
  'Digit0': PhysicalKeyboardKey.digit0,
  'Digit1': PhysicalKeyboardKey.digit1,
  'Digit2': PhysicalKeyboardKey.digit2,
  'Backslash': PhysicalKeyboardKey.backslash,
  'Quote': PhysicalKeyboardKey.quote,
  'Period': PhysicalKeyboardKey.period,
  'Slash': PhysicalKeyboardKey.slash,
  'KeyH': PhysicalKeyboardKey.keyH,
};

/// Characters a key event stands for (the typed character, else the key's label; the number pad's + − count too).
Set<String> _chars(KeyEvent e) => {
  if (e.character case final c? when c.isNotEmpty && c.codeUnitAt(0) >= 0x20) c.toLowerCase(),
  e.logicalKey.keyLabel.toLowerCase(),
  if (e.logicalKey == LogicalKeyboardKey.numpadAdd || e.logicalKey == LogicalKeyboardKey.add) '+',
  if (e.logicalKey == LogicalKeyboardKey.numpadSubtract || e.logicalKey == LogicalKeyboardKey.minus) '-',
  if (e.logicalKey == LogicalKeyboardKey.equal) '=',
};

bool get _modDown => HardwareKeyboard.instance.isControlPressed || HardwareKeyboard.instance.isMetaPressed;
bool get _shiftDown => HardwareKeyboard.instance.isShiftPressed;
bool get _altDown => HardwareKeyboard.instance.isAltPressed;

bool _match(_Spec s, KeyEvent e) {
  if (_modDown != s.mod) return false;
  if (s.shift && !_shiftDown) return false;
  if (s.alt && !_altDown) return false;
  final k = s.key;
  if (k.length == 1 && k != ' ') return _chars(e).contains(k.toLowerCase());
  final logical = _logical[k];
  if (logical != null && logical.contains(e.logicalKey)) return true;
  final physical = _physical[k];
  return physical != null && e.physicalKey == physical;
}

enum _Scope { board, editing, both }

/// A registered shortcut (web `ShortcutDef`): [run] returns false when it does not apply (the next one is tried).
class _Def {
  _Def(this.id, List<String> keys, this.run, {this.scope = _Scope.board, this.late = false})
    : specs = [for (final k in keys) _Spec(k)];
  final String id;
  final List<_Spec> specs;
  final bool Function(_Keys k, KeyEvent e) run;
  final _Scope scope;
  final bool late;
}

/// The keyboard of a board screen: put it around the board area (below [BoardUiScope]). It takes the focus when the
/// board is shown ([autofocus]) and when the board is clicked ([focusBoard]); keys go to text fields first – a search
/// field or chat field keeps its letters (web `isEditableTarget`).
class BoardKeyboard extends StatefulWidget {
  const BoardKeyboard({super.key, required this.ui, required this.child, this.autofocus = true});

  final BoardUi ui;
  final Widget child;
  final bool autofocus;

  /// Gives the keyboard back to the board of [context] (the board view calls it on a click on the board).
  static void focusBoard(BuildContext context) {
    final s = context.findAncestorStateOfType<BoardKeyboardState>();
    if (s != null && !s._node.hasPrimaryFocus) s._node.requestFocus();
  }

  @override
  State<BoardKeyboard> createState() => BoardKeyboardState();
}

class BoardKeyboardState extends State<BoardKeyboard> {
  final _node = FocusNode(debugLabel: 'BoardKeyboard');

  /// The keyboard's focus node (tests, hosts that move the focus themselves).
  FocusNode get focusNode => _node;

  late final _Keys _keys = _Keys(this);
  String? _wasEditing;

  /// Last mouse position (global) – pasting goes there like the web's „am Mauszeiger“.
  Offset? _pointer;

  BoardUi get ui => widget.ui;

  @override
  void initState() {
    super.initState();
    loadWheelSetting();
    ui.editor.addListener(_editorChanged);
  }

  @override
  void didUpdateWidget(BoardKeyboard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.ui, widget.ui)) {
      oldWidget.ui.editor.removeListener(_editorChanged);
      widget.ui.editor.addListener(_editorChanged);
    }
  }

  @override
  void dispose() {
    ui.editor.removeListener(_editorChanged);
    BoardDesktop.spaceDown.value = false;
    _node.dispose();
    super.dispose();
  }

  /// Writing ended (Esc, a click elsewhere): the keyboard comes back to the board unless another field has it.
  void _editorChanged() {
    final now = ui.editor.editingId;
    if (_wasEditing != null && now == null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        final p = FocusManager.instance.primaryFocus;
        if (p == null || p.context == null || !p.context!.mounted || _isTextField(p) == false) _node.requestFocus();
      });
    }
    _wasEditing = now;
  }

  static bool? _isTextField(FocusNode p) {
    final c = p.context;
    if (c == null) return null;
    return c.findAncestorStateOfType<EditableTextState>() != null || c.widget is EditableText;
  }

  KeyEventResult _onKey(FocusNode _, KeyEvent e) {
    if (e is KeyUpEvent) {
      if (e.logicalKey == LogicalKeyboardKey.space) BoardDesktop.spaceDown.value = false;
      return KeyEventResult.ignored;
    }
    final primary = FocusManager.instance.primaryFocus;
    final inBoardText =
        ui.editor.editingId != null && primary?.context?.findAncestorStateOfType<BoardTextEditorState>() != null;
    if (inBoardText) return _keys.editing(e) ? KeyEventResult.handled : KeyEventResult.ignored;
    // another text field (search, chat, …) keeps its keys
    if (primary != null && primary != _node && _isTextField(primary) == true) return KeyEventResult.ignored;
    return _keys.board(e) ? KeyEventResult.handled : KeyEventResult.ignored;
  }

  @override
  Widget build(BuildContext context) => Listener(
    behavior: HitTestBehavior.translucent,
    onPointerHover: (e) => _pointer = e.position,
    onPointerMove: (e) => _pointer = e.position,
    onPointerDown: (e) => _pointer = e.position,
    child: Focus(
      focusNode: _node,
      autofocus: widget.autofocus,
      onKeyEvent: _onKey,
      onFocusChange: (on) {
        if (!on) BoardDesktop.spaceDown.value = false;
      },
      child: widget.child,
    ),
  );
}

/// Reads the wheel setting („Mausrad“) from the device settings.
void loadWheelSetting() {
  final v = BoardPrefs.get(BoardDesktop.wheelKey);
  // like the web (`getWheelMode`): only „pan“ pans, everything else zooms
  if (v != null) BoardDesktop.wheel.value = v == 'pan' ? WheelMode.pan : WheelMode.zoom;
}

/// Tool keys (web `ToolDef.key`): key → tool id of the registry.
const boardToolKeys = {
  'v': 'select',
  'h': 'hand',
  'n': 'sticky',
  't': 'text',
  's': 'shape',
  'l': 'connector',
  'p': 'pen',
  'e': 'eraser',
  'f': 'frame',
  'c': 'comment',
};

/// The shortcuts and the editor's own keys of one board.
class _Keys {
  _Keys(this.s);
  final BoardKeyboardState s;

  BoardUi get ui => s.ui;
  BoardEditor get editor => ui.editor;
  BoardController get controller => ui.controller;
  BuildContext get context => s.context;
  bool get editable => editor.editable;

  /// Index of the frame Bild ↑/↓ went to last (web `frameCursor`).
  int _frameCursor = -1;

  late final List<_Def> _defs = _sorted([
    // ---- Bearbeiten (editor/core/shortcuts.ts) ----
    _Def('edit.undo', ['mod+z'], (k, e) => k._history(undo: true)),
    _Def('edit.redo', ['mod+shift+z', 'mod+y'], (k, e) => k._history(undo: false)),
    _Def('edit.copy', ['mod+c'], (k, e) => k._copy()),
    _Def('edit.cut', ['mod+x'], (k, e) => k._cut()),
    _Def('edit.paste', ['mod+v'], (k, e) => k._paste()),
    _Def('edit.duplicate', ['mod+d'], (k, e) => k._withSelection(() => k.editor.duplicateSelection())),
    _Def('edit.selectAll', ['mod+a'], (k, e) {
      k.editor.selectAll();
      return true;
    }),
    _Def('edit.group', ['mod+g'], (k, e) => k._group()),
    _Def('edit.ungroup', ['mod+shift+g'], (k, e) => k._ungroup()),
    _Def('edit.tab', ['Tab'], (k, e) => k._editTab(), scope: _Scope.editing),
    _Def('format.bold', ['mod+b'], (k, e) => k._format('bold'), scope: _Scope.both),
    _Def('format.italic', ['mod+i'], (k, e) => k._format('italic'), scope: _Scope.both),
    _Def('format.underline', ['mod+u'], (k, e) => k._format('underline'), scope: _Scope.both),
    _Def('format.strike', ['mod+shift+s'], (k, e) => k._format('strike'), scope: _Scope.both),
    _Def('format.link', ['mod+k'], (k, e) => k._link(), scope: _Scope.both),
    // ---- Ansicht ----
    _Def('view.fit', ['shift+Digit1', 'shift+!'], (k, e) => k._view((v) => v.fitAll())),
    _Def('view.zoomSelection', ['shift+Digit2', 'shift+"', 'shift+@'], (k, e) => zoomToSelection(k.ui)),
    _Def('view.zoomReset', ['mod+0', 'mod+Digit0'], (k, e) => k._view((v) => v.zoomTo100())),
    _Def('view.zoomResetShift', ['shift+Digit0'], (k, e) => k._view((v) => v.zoomTo100()), late: true),
    _Def('view.zoomIn', ['mod+plus', 'mod+='], (k, e) => k._zoom(1)),
    _Def('view.zoomOut', ['mod+-'], (k, e) => k._zoom(-1)),
    _Def('view.zoomInKey', ['plus', '='], (k, e) => k._zoom(1), late: true),
    _Def('view.zoomOutKey', ['-'], (k, e) => k._zoom(-1), late: true),
    _Def('view.help', ['?'], (k, e) => k._help(), late: true),
    _Def('view.helpMod', ['mod+/', 'mod+Slash'], (k, e) => k._help()),
    _Def('view.hideUi', ['mod+\\', 'mod+Backslash'], (k, e) {
      toggleUi(k.ui);
      return true;
    }),
    _Def('view.fullscreen', ['F11'], (k, e) {
      final p = BoardViewPrefs.of(k.ui);
      p.setImmersive(!p.immersive.value);
      return true;
    }),
    // ---- tools/register.tsx, organize.tsx ----
    _Def('tools.palette', ['mod+k', 'mod+shift+k'], (k, e) => k._palette()),
    _Def('tools.search', ['mod+f'], (k, e) {
      openSearch(k.ui);
      return true;
    }),
    _Def('tools.replace', ['mod+h'], (k, e) => k._replace()),
    _Def('tools.grid', ["mod+'", 'mod+Quote'], (k, e) => k._menu('tools.boardGrid', MenuTarget.board)),
    _Def('tools.copyStyle', ['mod+alt+c'], (k, e) => k._copyStyle()),
    _Def('tools.pasteStyle', ['mod+alt+v'], (k, e) => k._pasteStyle()),
    _Def('tools.forward', ['mod+]'], (k, e) => k._arrange(() => layerStep(k.ui, 1))),
    _Def('tools.backward', ['mod+['], (k, e) => k._arrange(() => layerStep(k.ui, -1))),
    _Def('tools.front', ['mod+shift+]', 'mod+shift+}'], (k, e) => k._arrange(() => k.editor.order(toFront: true))),
    _Def('tools.back', ['mod+shift+[', 'mod+shift+{'], (k, e) => k._arrange(() => k.editor.order(toFront: false))),
    _Def('tools.lock', ['mod+shift+l'], (k, e) => k._withSelection(() => toggleLock(k.ui))),
    _Def('tools.hide', ['mod+shift+h'], (k, e) => k._withSelection(() => toggleHidden(k.ui))),
    _Def('versions.history', ['mod+alt+h', 'mod+alt+KeyH'], (k, e) => k._menu('versions.history', MenuTarget.board)),
    // ---- Mindmap (features/structure/mindmap) ----
    _Def('structure.mindTab', ['Tab'], (k, e) => k._mindTab()),
    _Def('structure.mindEnter', ['Enter'], (k, e) => k._mindEnter(), scope: _Scope.both),
    _Def('structure.mindArrows', ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'], (k, e) => k._mindArrow(e)),
    _Def('structure.mindCollapse', ['mod+Period', 'mod+.'], (k, e) => k._mindCollapse()),
    // ---- Zusammenarbeit, Formen ----
    _Def('collab.cursorChat', ['/'], (k, e) => k._cursorChat(), late: true),
    _Def('shapes.rect', ['r'], (k, e) => k._pickShape('rect'), late: true),
    _Def('shapes.circle', ['o'], (k, e) => k._pickShape('circle'), late: true),
  ]);

  static List<_Def> _sorted(List<_Def> defs) {
    // more modifiers first (web `specificity`), else registration order
    final indexed = [
      for (final (i, d) in defs.indexed)
        for (final s in d.specs) (i, d, s),
    ];
    indexed.sort((a, b) {
      final c = b.$3.specificity.compareTo(a.$3.specificity);
      return c != 0 ? c : a.$1.compareTo(b.$1);
    });
    return [
      for (final x in indexed) _Def(x.$2.id, const [], x.$2.run, scope: x.$2.scope, late: x.$2.late)..specs.add(x.$3),
    ];
  }

  bool _run(KeyEvent e, {required bool editing, bool late = false}) {
    for (final d in _defs) {
      if (editing ? d.scope == _Scope.board : d.scope == _Scope.editing) continue;
      if (!editing && d.late != late) continue;
      if (!_match(d.specs.single, e)) continue;
      if (d.run(this, e)) return true;
    }
    return false;
  }

  // ---- phases -------------------------------------------------------------------------------------------------------

  /// Keys while writing in the board's own text field; everything else stays with the field (caret, Strg Z …).
  bool editing(KeyEvent e) {
    if (e.logicalKey == LogicalKeyboardKey.escape && !_modDown) {
      ui.view?.finishEditing();
      return true;
    }
    return _run(e, editing: true);
  }

  /// Keys on the board (web keyRef.down).
  bool board(KeyEvent e) {
    final key = e.logicalKey;
    final repeat = e is KeyRepeatEvent;
    // presentation: only paging and ending
    final present = Presentation.of(ui);
    if (present.running) {
      if (const [
        LogicalKeyboardKey.arrowRight,
        LogicalKeyboardKey.arrowDown,
        LogicalKeyboardKey.pageDown,
        LogicalKeyboardKey.space,
        LogicalKeyboardKey.enter,
      ].contains(key)) {
        present.next();
      } else if (const [
        LogicalKeyboardKey.arrowLeft,
        LogicalKeyboardKey.arrowUp,
        LogicalKeyboardKey.pageUp,
        LogicalKeyboardKey.backspace,
      ].contains(key)) {
        present.previous();
      } else if (key == LogicalKeyboardKey.home) {
        present.go(0);
      } else if (key == LogicalKeyboardKey.end) {
        present.go(present.frames.length - 1);
      } else if (key == LogicalKeyboardKey.escape) {
        present.stop();
      } else {
        return false;
      }
      return true;
    }
    if (key == LogicalKeyboardKey.space) {
      if (!repeat) BoardDesktop.spaceDown.value = true;
      return true;
    }
    if (_run(e, editing: false)) return true;
    if (_modDown) return false;
    if (key == LogicalKeyboardKey.pageDown || key == LogicalKeyboardKey.pageUp) {
      return _goFrame(_frameCursor + (key == LogicalKeyboardKey.pageDown ? 1 : -1));
    }
    if (key == LogicalKeyboardKey.delete || key == LogicalKeyboardKey.backspace) {
      if (!editable) return false;
      editor.deleteSelection();
      return true;
    }
    if (key == LogicalKeyboardKey.escape) return _escape();
    if (key == LogicalKeyboardKey.enter || key == LogicalKeyboardKey.numpadEnter) return _enter();
    if (key == LogicalKeyboardKey.tab && !_altDown) return _focusStep(back: _shiftDown);
    if (_arrows.containsKey(key)) {
      _nudge(_arrows[key]! * (_shiftDown ? 10.0 : 1.0));
      return true; // the arrows never move the focus away from the board
    }
    final ch = e.character;
    final printable = ch != null && ch.length == 1 && ch.codeUnitAt(0) >= 0x20 && !_altDown;
    final sel = editor.selected;
    final typesInto = sel.length == 1 && _typesIntoText(sel.single) && editable;
    if (printable && editor.tool == BoardTool.select && typesInto && editor.editingId == null && !repeat) {
      return _typeInto(sel.single, ch);
    }
    if (_run(e, editing: false, late: true)) return true;
    // tool keys: with one text object selected the key typed (above), else the tool changes
    if (_altDown || typesInto) return false;
    final id = boardToolKeys[_chars(e).firstWhere(boardToolKeys.containsKey, orElse: () => '')];
    return id != null && _useTool(id);
  }

  static final _arrows = {
    LogicalKeyboardKey.arrowLeft: Offset(-1, 0),
    LogicalKeyboardKey.arrowRight: Offset(1, 0),
    LogicalKeyboardKey.arrowUp: Offset(0, -1),
    LogicalKeyboardKey.arrowDown: Offset(0, 1),
  };

  // ---- actions ------------------------------------------------------------------------------------------------------

  bool _view(void Function(BoardViewState v) run) {
    final v = ui.view;
    if (v == null) return false;
    run(v);
    return true;
  }

  bool _zoom(int dir) {
    if (ui.view == null) return false;
    zoomStep(ui, dir);
    return true;
  }

  bool _history({required bool undo}) {
    if (!editable) return false;
    if (undo ? controller.canUndo : controller.canRedo) {
      if (undo) {
        controller.undo();
      } else {
        controller.redo();
      }
    }
    return true;
  }

  bool _withSelection(void Function() run) {
    if (!editable || editor.selection.value.isEmpty) return false;
    run();
    return true;
  }

  bool _arrange(void Function() run) => _withSelection(run);

  bool _copy() {
    if (editor.selection.value.isEmpty) return false;
    unawaited(copySelection(ui));
    return true;
  }

  bool _cut() {
    if (!editable || editor.selection.value.isEmpty) return false;
    unawaited(cutSelection(ui));
    return true;
  }

  bool _paste() {
    if (!editable) return false;
    unawaited(pasteAt(ui, pointerWorld(), context: context));
    return true;
  }

  bool _group() {
    if (!editable || !canGroup(ui) || !controller.canAct('core.group')) return false;
    groupSelection(ui);
    return true;
  }

  bool _ungroup() {
    if (!editable || editor.selection.value.isEmpty || !controller.canAct('core.ungroup')) return false;
    ungroupSelection(ui);
    return true;
  }

  bool _copyStyle() {
    final sel = editor.selected;
    if (!editable || sel.isEmpty || !controller.canAct('tools.copyStyle')) return false;
    unawaited(ArrangeModes.of(ui).copyStyle(sel.first.id));
    return true;
  }

  bool _pasteStyle() {
    if (!editable || editor.selection.value.isEmpty || copiedStyle == null || !controller.canAct('tools.pasteStyle')) {
      return false;
    }
    ArrangeModes.of(ui).pasteStyle();
    return true;
  }

  /// Runs the menu entry [id] like a click in its menu (its own rules: rights, loaded board …).
  bool _menu(String id, MenuTarget on) {
    final def = ui.registry.menuItems[id];
    if (def == null || def.on != on) return false;
    final entry = def.entry(ui, MenuAt(pointerWorld()));
    final run = entry?.onSelect;
    if (entry == null || entry.disabled || run == null) return false;
    run(context, ui);
    return true;
  }

  /// Runs the context bar item [key] of the selection (bold on a selected note, „Link für den Text“).
  bool _ctxItem(String key) {
    final objs = editor.selected;
    if (objs.isEmpty) return false;
    for (final (item, _) in contextEntries(context, ui, objs)) {
      if (item.key == key) {
        item.onTap(context, ui);
        return true;
      }
    }
    return false;
  }

  bool _format(String mark) {
    if (editor.editingId != null) {
      final f = RichFormat.of(editor);
      if (f == null || !editable) return false;
      f.mark((d, a, b) => d.toggleMark(a, b, mark));
      return true;
    }
    if (!editable) return false;
    return _ctxItem(switch (mark) {
      'bold' => 'stachelCtxBold',
      'italic' => 'stachelCtxItalic',
      'underline' => 'stachelCtxUnderline',
      _ => 'stachelCtxStrike',
    });
  }

  /// Strg K: while writing the link field for the selected text; on a selected object with text the link for all of
  /// its text (richtext comes before the palette in the web).
  bool _link() {
    if (editor.editingId != null) {
      final f = RichFormat.of(editor);
      if (f == null || !editable) return false;
      unawaited(richLinkDialog(context, f));
      return true;
    }
    final o = editor.single;
    if (!editable || o == null || o.locked || o.type == 'connector' || o.displayText.trim().isEmpty) return false;
    return _ctxItem('stachelCtxRichLink');
  }

  bool _palette() {
    if (!controller.loaded) return false;
    unawaited(showCommandPalette(context, ui));
    return true;
  }

  bool _replace() {
    if (!editable || !controller.canAct('tools.replace')) return false;
    openReplace(ui);
    return true;
  }

  bool _help() {
    unawaited(showBoardShortcuts(context, ui));
    return true;
  }

  bool _cursorChat() {
    if (!controller.features.contains('extra') || !controller.loaded) return false;
    return CursorChatRuntime.of(ui).start();
  }

  bool _pickShape(String entry) {
    if (!editable) return false;
    final e = entryById(entry);
    if (e == null) return false;
    P2Tools.of(editor).setShape(e.kind, e.id);
    editor.useTool('shape');
    editor.select(const {});
    return true;
  }

  /// Tool [id] of the registry (web `setTool`); the comment tool also with comment rights.
  bool _useTool(String id) {
    ToolDef? def;
    for (final t in ui.registry.tools.list()) {
      if (t.id == id || t.tool?.name == id) {
        def = t;
        break;
      }
    }
    if (def == null || def.isAction || !(def.available?.call(ui) ?? true)) return false;
    final name = def.tool?.name ?? def.id;
    if (name == 'comment' ? !editor.commentable : (!editable && name != 'select' && name != 'hand')) return false;
    if (name == 'comment') {
      editor.tool = BoardTool.comment;
    } else {
      editor.useTool(name);
    }
    return true;
  }

  // ---- writing ------------------------------------------------------------------------------------------------------

  bool _typesIntoText(BoardObject o) => (textTypes.contains(o.type) || o.type == 'mindnode') && !o.locked;

  /// Typing on a selected note starts writing with that character at the end (web `typeInto`).
  bool _typeInto(BoardObject o, String ch) {
    final v = ui.view;
    if (v == null || !v.editText(o.id)) return false;
    final doc = editor.editingDoc;
    if (doc == null) return true;
    final next = doc.text + ch;
    if (o.type == 'mindnode') {
      editor.textChanged(next, caret: next.length);
      editor.docVersion++;
      editor.refresh();
    } else {
      editor.formatText((d, a, b) => d.setText(next, caret: next.length));
    }
    return true;
  }

  bool _enter() {
    final sel = editor.selected;
    if (sel.length != 1 || !editable) return false;
    final o = sel.single;
    if (o.locked) return false;
    if (_typesIntoText(o)) return ui.view?.editText(o.id) ?? false;
    final edit = ui.registry.typeOf(o.type)?.edit;
    if ((edit == 'label' || edit == 'title') && editor.onEditField != null) {
      editor.onEditField!(o);
      return true;
    }
    return false;
  }

  /// Tab while writing: in a list it indents (Umschalt: outdents), in a mind node a subtopic, else the next note.
  bool _editTab() {
    final id = editor.editingId;
    final o = id == null ? null : controller.state[id];
    if (o == null || !editable) return false;
    if (o.type == 'mindnode') {
      if (_shiftDown) return true;
      editor.mindTab();
      return true;
    }
    final f = RichFormat.of(editor);
    if (f != null && f.list != null) {
      editor.formatText((d, a, b) => _shiftDown ? d.outdent(a, b) : d.indent(a, b));
      return true;
    }
    editNext(ui, back: _shiftDown);
    return true;
  }

  // ---- mind map -----------------------------------------------------------------------------------------------------

  BoardObject? get _selectedNode {
    final o = editor.single;
    return o != null && o.type == 'mindnode' && editor.selection.value.length == 1 ? o : null;
  }

  bool _mindTab() {
    final o = _selectedNode;
    if (o == null || _shiftDown || _altDown || !editable) return false;
    editor.mindChild(o.id);
    return true;
  }

  bool _mindEnter() {
    if (_shiftDown || _modDown || !editable) return false;
    final id = editor.editingId;
    if (id != null) {
      if (controller.state[id]?.type != 'mindnode') return false;
      editor.mindEnter();
      return true;
    }
    final o = _selectedNode;
    if (o == null || editor.isMindRootNode(o.id)) return false;
    editor.mindSibling(o.id);
    return true;
  }

  bool _mindCollapse() {
    final o = _selectedNode;
    if (o == null || !editable || editor.mindChildren(o.id).isEmpty) return false;
    editor.mindCollapse(o.id, !o.mind.collapsed);
    return true;
  }

  /// Arrows on a selected mind node move between topics (web `neighbor`); at the edge nothing moves – only the root
  /// moves with ↑/↓ along with its map.
  bool _mindArrow(KeyEvent e) {
    final o = _selectedNode;
    if (o == null || _shiftDown || _altDown) return false;
    final key = e.logicalKey;
    final root = editor.isMindRootNode(o.id);
    final n = _neighbor(o, key, root);
    if (n == null) {
      return !root || key == LogicalKeyboardKey.arrowLeft || key == LogicalKeyboardKey.arrowRight;
    }
    editor.select({n.id});
    final v = ui.view;
    if (v != null && v.viewSize != Size.zero) {
      final c = Offset(n.x + n.w / 2, n.y + n.h / 2);
      final sp = v.camera.value.toScreen(c);
      final size = v.viewSize;
      if (sp.dx < 60 || sp.dy < 60 || sp.dx > size.width - 60 || sp.dy > size.height - 60) {
        final z = v.camera.value.z;
        v.camera.value = Camera(size.width / 2 - c.dx * z, size.height / 2 - c.dy * z, z);
      }
    }
    return true;
  }

  BoardObject? _neighbor(BoardObject node, LogicalKeyboardKey key, bool root) {
    List<BoardObject> kids(String id) => [
      for (final k in editor.mindChildren(id))
        if (controller.state[k] case final c? when !c.mind.hidden) c,
    ];
    final side = node.mind.side ?? 'r';
    final children = kids(node.id);
    final parent = root ? null : controller.state[node.mind.parent ?? ''];
    final right = key == LogicalKeyboardKey.arrowRight, left = key == LogicalKeyboardKey.arrowLeft;
    if (root && (right || left)) {
      return children.where((k) => (k.mind.side ?? 'r') == (right ? 'r' : 'l')).firstOrNull;
    }
    final outward = side == 'r' ? right : left;
    final inward = side == 'r' ? left : right;
    if (!root && outward) return children.firstOrNull;
    if (!root && inward) return parent;
    if (parent != null && (key == LogicalKeyboardKey.arrowUp || key == LogicalKeyboardKey.arrowDown)) {
      final sibs = kids(parent.id).where((k) => (k.mind.side ?? 'r') == side).toList();
      final i = sibs.indexWhere((k) => k.id == node.id) + (key == LogicalKeyboardKey.arrowUp ? -1 : 1);
      return i >= 0 && i < sibs.length ? sibs[i] : null;
    }
    return null;
  }

  // ---- board keys ---------------------------------------------------------------------------------------------------

  /// Esc (web): stop a pick mode, close the search, back to Auswahl, else drop the selection.
  bool _escape() {
    final modes = ArrangeModes.of(ui);
    if (modes.painter.value != null || modes.picking.value != null) {
      modes
        ..stopPainter()
        ..stopPicking();
      return true;
    }
    final prefs = BoardViewPrefs.of(ui);
    if (prefs.searchOpen.value) {
      closeSearch(ui);
      return true;
    }
    if (editor.tool != BoardTool.select) {
      editor.useTool('select');
      return true;
    }
    if (editor.selection.value.isEmpty && !editor.multiSelect) return false;
    editor.select(const {});
    editor.multiSelect = false;
    return true;
  }

  /// Arrow keys move the selection by [d] (web: 1 px, Umschalt 10 px; frames take what lies inside).
  void _nudge(Offset d) {
    if (!editable) return;
    final objs = editor.movableObjects(editor.selection.value);
    if (objs.isEmpty) return;
    final patches = movePatches(objs.values, d.dx, d.dy);
    if (patches.isEmpty) return;
    controller.apply(editor.mindDragOps(patches, end: true) ?? [UpdateOp(patches)]);
  }

  /// Tab on the board: the next object in z order gets selected (web `focusStep`, keyboard access); at the end the
  /// focus leaves the board.
  bool _focusStep({required bool back}) {
    final list = controller.state.ordered.where(isVisibleObject).toList();
    if (list.isEmpty) return false;
    final sel = editor.selection.value;
    final cur = sel.isEmpty ? -1 : list.indexWhere((o) => o.id == sel.last);
    final next = back ? (cur < 0 ? list.length - 1 : cur - 1) : cur + 1;
    if (next < 0 || next >= list.length) return false;
    final o = list[next];
    editor.select({o.id});
    final v = ui.view;
    if (v != null && v.viewSize != Size.zero) {
      final r = v.camera.value.rectToScreen(objectRect(o));
      if (!(Offset.zero & v.viewSize).contains(r.topLeft) || !(Offset.zero & v.viewSize).contains(r.bottomRight)) {
        final c = objectRect(o).center;
        final z = v.camera.value.z;
        v.camera.value = Camera(v.viewSize.width / 2 - c.dx * z, v.viewSize.height / 2 - c.dy * z, z);
      }
    }
    return true;
  }

  /// Bild ↑/↓: camera on the previous/next frame (web `goFrame` outside a presentation, at most 200 %).
  bool _goFrame(int i) {
    final list = framesInOrderWeb(controller.state.ordered);
    if (list.isEmpty) return false;
    final idx = i.clamp(0, list.length - 1);
    _frameCursor = idx;
    fitTo(ui, objectRect(list[idx]));
    return true;
  }

  // ---- where ---------------------------------------------------------------------------------------------------------

  /// World point under the mouse if it is over the board, else the middle of the view.
  Offset pointerWorld() {
    final v = ui.view;
    if (v == null) return Offset.zero;
    final size = v.viewSize;
    final cam = v.camera.value;
    final p = s._pointer;
    final box = v.mounted ? v.context.findRenderObject() : null;
    if (p != null && box is RenderBox && box.hasSize) {
      final local = box.globalToLocal(p);
      if ((Offset.zero & box.size).contains(local)) return cam.toWorld(local);
    }
    return cam.toWorld(size.center(Offset.zero));
  }
}
