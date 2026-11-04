import 'package:flutter/material.dart';

import '../../editor/registry/board_ui.dart';
import '../../model/board_object.dart';
import '../../render/text_layout.dart' show BoardFonts;
import 'stack_model.dart';

// Note stacks over the board (Q2, web `shapes/stack/view.tsx` `StackBadges`): the number of notes at the top right
// inside the top note (tap = next note); when the whole stack is selected also ‹ › and a horizontal swipe over the
// badge leafs through it. The paper edges below the top note are painted by the sticky renderer.

/// Leafs through the stack of [id] (`dir` 1 = next note on top, -1 = previous one).
Future<void> cycleStack(BoardUi ui, String id, int dir) =>
    ui.controller.act('shapes.stackCycle', {'id': id, 'dir': dir}, label: 'Stapel blättern');

/// Spreads the stack of [id] into a grid next to its corner (stack dissolved).
Future<void> spreadStack(BoardUi ui, String id) =>
    ui.controller.act('shapes.stackSpread', {'id': id}, label: 'Stapel auffächern');

/// Takes [which] (default: the top note) off the stack of [id]; it lands right next to the stack.
Future<void> takeFromStack(BoardUi ui, String id, {String? which}) =>
    ui.controller.act('shapes.stackTake', {'id': id, 'which': ?which}, label: 'Vom Stapel nehmen');

/// May [ui] change stacks (editable board, the server knows the actions)?
bool canStack(BoardUi ui) => ui.editor.editable && ui.controller.canAct('shapes.stackCycle');

class StackBadges extends StatelessWidget {
  const StackBadges({super.key, required this.ui});
  final BoardUi ui;

  @override
  Widget build(BuildContext context) {
    final view = ui.view;
    if (view == null) return const SizedBox.shrink();
    return ListenableBuilder(
      listenable: Listenable.merge([ui.editor, ui.editor.selection, ui.controller, view.camera]),
      builder: (context, _) {
        final state = ui.controller.state;
        final stacks = allStacks(state);
        if (stacks.isEmpty) return const SizedBox.shrink();
        final cam = view.camera.value;
        final size = view.viewSize;
        final sel = selectedStack(ui.editor.selection.value, state);
        final can = canStack(ui);
        final badges = <Widget>[];
        for (final MapEntry(key: g, value: members) in stacks.entries) {
          final top = members.last;
          if (top.w * cam.z < 40 || ui.editor.editingId == top.id) continue;
          final s = cam.toScreen(Offset(top.x + top.w, top.y));
          if (s.dx < -40 || s.dy < -40 || s.dx > size.width + 40 || s.dy > size.height + 40) continue;
          badges.add(
            Positioned(
              right: size.width - s.dx + 6,
              top: s.dy + 6,
              child: _Badge(
                key: Key('stachelStackBadge-$g'),
                n: members.length,
                active: sel != null && sel.first.groupId == g,
                onCycle: can ? (dir) => cycleStack(ui, top.id, dir) : null,
              ),
            ),
          );
        }
        return Stack(clipBehavior: Clip.hardEdge, children: badges);
      },
    );
  }
}

class _Badge extends StatelessWidget {
  const _Badge({super.key, required this.n, required this.active, required this.onCycle});
  final int n;
  final bool active;
  final void Function(int dir)? onCycle;

  @override
  Widget build(BuildContext context) {
    final cycle = onCycle;
    Widget btn(String text, String tip, int dir, Key key, {double size = 13}) => Semantics(
      button: cycle != null,
      label: tip,
      child: InkResponse(
        key: key,
        onTap: cycle == null ? null : () => cycle(dir),
        radius: 18,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minWidth: 26, minHeight: 26),
          child: Center(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 5),
              child: Text(
                text,
                style: TextStyle(
                  fontFamily: const BoardFonts().regular,
                  color: Colors.white,
                  fontSize: size,
                  fontWeight: FontWeight.w700,
                  height: 1,
                ),
              ),
            ),
          ),
        ),
      ),
    );
    return GestureDetector(
      // swipe over the badge leafs through the stack (left = next note)
      onHorizontalDragEnd: cycle == null
          ? null
          : (d) {
              final v = d.primaryVelocity ?? 0;
              if (v.abs() > 80) cycle(v < 0 ? 1 : -1);
            },
      child: Material(
        color: active ? const Color(0xFF1763B5) : const Color(0xFF0A0A0A),
        shape: const StadiumBorder(),
        elevation: 3,
        child: Padding(
          padding: const EdgeInsets.all(1),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (active) btn('‹', 'Vorige Notiz', -1, const Key('stachelStackPrev'), size: 18),
              btn('$n', 'Stapel mit $n Notizen – nächste Notiz zeigen', 1, const Key('stachelStackCount')),
              if (active) btn('›', 'Nächste Notiz', 1, const Key('stachelStackNext'), size: 18),
            ],
          ),
        ),
      ),
    );
  }
}

/// For the context bar: the whole stack selected ([whole]) or one note of a stack ([one]).
({List<BoardObject>? whole, BoardObject? one}) stackSelection(BoardUi ui, List<BoardObject> selected) {
  final state = ui.controller.state;
  final whole = selectedStack({for (final o in selected) o.id}, state);
  final one = whole == null && selected.length == 1 && stackOf(selected.single, state).isNotEmpty
      ? selected.single
      : null;
  return (whole: whole, one: one);
}
