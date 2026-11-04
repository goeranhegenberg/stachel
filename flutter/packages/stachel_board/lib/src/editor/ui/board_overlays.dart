import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';

import '../registry/board_ui.dart';
import 'board_hints.dart';

/// The registered overlays over the board in order (web slots 'overlay'/'world'); in presentation mode only those
/// with `presenting`. Put it into the screen's `Stack` right above the `BoardView`.
class BoardOverlays extends StatelessWidget {
  const BoardOverlays({super.key, required this.ui});
  final BoardUi ui;

  @override
  Widget build(BuildContext context) => ValueListenableBuilder<bool>(
    valueListenable: ui.presenting,
    builder: (context, presenting, _) => Stack(
      fit: StackFit.expand,
      children: [
        for (final o in ui.registry.overlays.list())
          if (!presenting || o.presenting) KeyedSubtree(key: ValueKey('overlay-${o.id}'), child: o.build(context, ui)),
      ],
    ),
  );
}

/// Small dark pill over the board (tool hint, „Leeres Board …“, „Wieder verbunden“, „wird ausgeführt …“).
class BoardHintPill extends StatelessWidget {
  const BoardHintPill({super.key, required this.text, this.icon, this.color});
  final String text;
  final IconData? icon;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final ui = BoardUiScope.maybeOf(context);
    final ink = color ?? ui?.theme.canvasInk ?? const Color(0xFF161118);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(color: ink, borderRadius: BorderRadius.circular(6)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null)
            Padding(
              padding: const EdgeInsets.only(right: 6),
              child: Icon(icon, size: 16, color: Colors.white),
            ),
          Flexible(
            child: Text(text, style: const TextStyle(color: Colors.white, fontSize: 13)),
          ),
        ],
      ),
    );
  }
}

/// Status pills of the hint service: „Wieder verbunden“ (B06), web actions waiting (O04). The empty-board hint
/// ([BoardHintTexts.emptyBoard]) sits in the middle of the board.
class BoardStatusHints extends StatelessWidget {
  const BoardStatusHints({super.key, required this.ui, this.showEmpty = true});
  final BoardUi ui;
  final bool showEmpty;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: Listenable.merge([ui.hints, ui.controller, ui.editor]),
    builder: (context, _) {
      final h = ui.hints;
      final running = h.running;
      final empty = showEmpty && h.emptyBoard && ui.editor.editingId == null && ui.editor.tool.name == 'select';
      return Stack(
        children: [
          if (empty)
            const Center(
              child: Padding(
                padding: EdgeInsets.symmetric(horizontal: 32),
                child: IgnorePointer(
                  child: BoardHintPill(key: Key('stachelEmptyHint'), text: BoardHintTexts.emptyBoard),
                ),
              ),
            ),
          Positioned.fill(
            child: BoardTopSlot(
              ui: ui,
              order: BoardTopSlot.statusOrder,
              child: IgnorePointer(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (h.reconnected)
                      BoardHintPill(
                        key: const Key('stachelReconnected'),
                        text: BoardHintTexts.reconnected,
                        icon: Icons.cloud_done_outlined,
                        color: const Color(0xFF2B8A3E),
                      ),
                    for (final (i, a) in running.indexed)
                      Padding(
                        padding: EdgeInsets.only(top: i == 0 && !h.reconnected ? 0 : 6),
                        child: BoardHintPill(
                          key: ValueKey('stachelActRunning-${a.req}'),
                          icon: a.queued ? Icons.cloud_queue : Icons.hourglass_top,
                          text: '${a.label ?? a.name} – ${a.queued ? BoardHintTexts.queued : BoardHintTexts.running}',
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
        ],
      );
    },
  );
}

/// A bar on top of the board that stacks with the others instead of covering them (UX-Review P2): it sits below
/// every slot with a smaller [order] that shows something (heights in [BoardUi.topBars]). Fills its parent (put it
/// into a `Stack` with `Positioned.fill` or as an overlay); only the bar itself takes touches. [stretch] = full width
/// with [side] margin (search), else centered (pills).
class BoardTopSlot extends StatefulWidget {
  const BoardTopSlot({
    super.key,
    required this.ui,
    required this.order,
    required this.child,
    this.stretch = false,
    this.gap = 8,
    this.side = 8,
  });

  /// Orders of the stack (top to bottom): connection banner, search, private-mode band, vote/following/timer,
  /// mention, status pills.
  static const bannerOrder = 0.0,
      searchOrder = 10.0,
      privateOrder = 15.0,
      noticesOrder = 20.0,
      mentionOrder = 30.0,
      statusOrder = 40.0;

  final BoardUi ui;
  final double order;
  final Widget child;
  final bool stretch;

  /// Space above the bar when it shows something.
  final double gap;
  final double side;

  @override
  State<BoardTopSlot> createState() => _BoardTopSlotState();
}

class _BoardTopSlotState extends State<BoardTopSlot> {
  final _id = Object();
  late final BoardTopBars _bars = widget.ui.topBars;

  @override
  void dispose() {
    _bars.remove(_id);
    super.dispose();
  }

  void _report(Size size) => _bars.report(_id, order: widget.order, height: size.height, gap: widget.gap);

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: _bars,
    builder: (context, _) {
      final child = _Measured(onSize: _report, child: widget.child);
      return Stack(
        children: [
          Positioned(
            top: _bars.topOf(_id, widget.order, widget.gap),
            left: widget.side,
            right: widget.side,
            child: widget.stretch ? child : Center(child: child),
          ),
        ],
      );
    },
  );
}

/// Reports its child's size after every layout.
class _Measured extends SingleChildRenderObjectWidget {
  const _Measured({required this.onSize, required super.child});
  final void Function(Size size) onSize;

  @override
  RenderObject createRenderObject(BuildContext context) => _RenderMeasured(onSize);

  @override
  void updateRenderObject(BuildContext context, _RenderMeasured renderObject) => renderObject.onSize = onSize;
}

class _RenderMeasured extends RenderProxyBox {
  _RenderMeasured(this.onSize);
  void Function(Size size) onSize;

  @override
  void performLayout() {
    super.performLayout();
    onSize(size);
  }
}
