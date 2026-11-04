import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

import '../../editor/registry/board_ui.dart';
import '../../protocol/native_messages.dart';
import '../tables/table_overlay.dart';
import 'card_model.dart';
import 'live_text.dart';
import 'structure_state.dart';

// The overlay of package P3 over the board (web: the module's views and slots `structure.bridge`, `structure.people`,
// `structure.tableAdd`): knows the board's size (templates go to its middle), notes my name for „Zuständig“ once
// (`structure.people`), measures a selected card like the web's `onMeasured` (height follows the content), writes a
// card's title in place, and shows the table parts (active cell, borders, „+“, cell editor).

class StructureOverlay extends StatefulWidget {
  const StructureOverlay({super.key, required this.ui});
  final BoardUi ui;

  @override
  State<StructureOverlay> createState() => _StructureOverlayState();
}

class _StructureOverlayState extends State<StructureOverlay> {
  late final StructureState st = StructureState.of(widget.ui.editor);
  final _drag = TableDrag();
  bool _registered = false;
  String _measured = '';

  BoardUi get ui => widget.ui;

  @override
  void initState() {
    super.initState();
    st.ui = ui;
    ui.editor.selection.addListener(_selection);
  }

  @override
  void dispose() {
    ui.editor.selection.removeListener(_selection);
    _drag.dispose();
    super.dispose();
  }

  /// A new selection without the edited object ends writing (web: the editor loses focus).
  void _selection() {
    final e = st.edit;
    if (e != null && !ui.editor.selection.value.contains(e.id)) st.stopEdit();
  }

  /// My name in `structure.people` (web `useRegisterMe` when the board opens), only if it is missing or different.
  void _registerMe() {
    final c = ui.controller;
    if (_registered || !c.loaded || !c.canAct('structure.people') || !ui.editor.editable) return;
    final me = c.user;
    if (me == null) return;
    _registered = true;
    final stored = c.state.ext['structure.people'];
    if (stored is Map && stored[me.key] == me.name) return;
    // Called from build: `act` notifies the controller's listeners right away (setState during build), so it runs
    // after the frame.
    SchedulerBinding.instance.addPostFrameCallback((_) {
      if (mounted) c.act('structure.people', const {});
    });
  }

  /// Web `onMeasured`: a selected card (not being written) whose height differs from its content by more than 2 gets
  /// the measured height.
  void _measureCard() {
    final sel = ui.editor.selection.value;
    if (sel.length != 1 || !ui.editor.editable) return;
    final o = ui.controller.state[sel.single];
    if (o == null || o.type != 'card' || o.locked || st.edit?.id == o.id) return;
    final h = cardContentHeight(o);
    final key = '${o.id}|${o.raw.hashCode}';
    if ((h - o.h).abs() <= 2 || key == _measured) return;
    _measured = key;
    SchedulerBinding.instance.addPostFrameCallback((_) {
      final now = ui.controller.state[o.id];
      if (now == null || !mounted) return;
      ui.controller.apply([
        UpdateOp({
          o.id: {'h': cardContentHeight(now)},
        }),
      ]);
    });
  }

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, c) {
      st.viewSize = Size(c.maxWidth, c.maxHeight);
      return AnimatedBuilder(
        animation: Listenable.merge([st, ui.editor.camera, ui.editor.selection, ui.controller, _drag]),
        builder: (context, _) {
          _registerMe();
          _measureCard();
          final children = <Widget>[...tableDecorations(context, ui, st, _drag)];
          final e = st.edit;
          if (e != null && e.cell == null) {
            final o = ui.controller.state[e.id];
            if (o != null) {
              final l = cardLayout(o);
              final cam = ui.editor.camera.value;
              final tl = cam.toScreen(Offset(o.x + CardLayout.padLeft, o.y + CardLayout.padTop));
              final lines = l.titleLines.isEmpty ? 1 : l.titleLines.length;
              children.add(
                Positioned(
                  left: tl.dx - 2,
                  top: tl.dy - 2,
                  width: l.inner * cam.z + 4,
                  height: (lines * CardLayout.titleLine + 4) * cam.z + 4,
                  child: CardTitleEditor(key: ValueKey('title-${o.id}'), ui: ui, id: o.id),
                ),
              );
            }
          }
          return Stack(clipBehavior: Clip.none, children: children);
        },
      );
    },
  );
}

/// The card's title in place (web `Editable` with placeholder „Titel der Karte“): live (`card.title` with its base),
/// Enter/„Fertig“ ends writing.
class CardTitleEditor extends StatefulWidget {
  const CardTitleEditor({super.key, required this.ui, required this.id});
  final BoardUi ui;
  final String id;

  @override
  State<CardTitleEditor> createState() => _CardTitleEditorState();
}

class _CardTitleEditorState extends State<CardTitleEditor> {
  late final LiveText _live;
  final _focus = FocusNode();

  BoardUi get ui => widget.ui;

  @override
  void initState() {
    super.initState();
    _live = LiveText(
      read: () => ui.controller.state[widget.id]?.text ?? '',
      send: (base, text) {
        if (!ui.controller.canAct('card.title')) return;
        ui.controller.act('card.title', {'id': widget.id, 'base': base, 'text': text});
      },
    );
    ui.controller.addListener(_live.pull);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _focus.requestFocus();
    });
  }

  @override
  void dispose() {
    ui.controller.removeListener(_live.pull);
    _live.dispose();
    _live.controller.dispose();
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final z = ui.editor.camera.value.z;
    final o = ui.controller.state[widget.id];
    return Material(
      color: Colors.white,
      child: TextField(
        key: const Key('stachelCardTitleInline'),
        controller: _live.controller,
        focusNode: _focus,
        maxLines: null,
        textInputAction: TextInputAction.done,
        onSubmitted: (_) => StructureState.of(ui.editor).stopEdit(),
        style: TextStyle(
          fontSize: CardLayout.titleSize * z,
          height: 1.3,
          fontWeight: FontWeight.w600,
          color: o?.status == 'done' ? const Color(0xFF6B6B66) : const Color(0xFF0A0A0A),
        ),
        decoration: InputDecoration.collapsed(
          hintText: cardPlaceholder,
          hintStyle: TextStyle(fontSize: CardLayout.titleSize * z, color: const Color(0x590A0A0A)),
        ),
      ),
    );
  }
}
