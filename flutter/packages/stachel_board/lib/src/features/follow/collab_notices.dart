import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';

import '../../editor/registry/board_ui.dart';
import '../../editor/ui/board_overlays.dart' show BoardTopSlot;
import '../timer/timer_views.dart';
import '../voting/vote_views.dart';
import 'follow.dart';

/// The collab notices on top in the middle, stacked like the web's `Notices` (overlay `collab.notices`, also while
/// presenting): vote bar, following, timer.
class CollabNotices extends StatelessWidget {
  const CollabNotices({super.key, required this.ui});
  final BoardUi ui;

  @override
  Widget build(BuildContext context) => BoardTopSlot(
    // UX-Review P2: one column under the search bar instead of all at the top edge
    ui: ui,
    order: BoardTopSlot.noticesOrder,
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        VoteBar(ui: ui),
        _gap(FollowNotice(ui: ui)),
        _gap(TimerNotice(ui: ui)),
      ],
    ),
  );

  /// The gap only where something shows (an empty notice keeps the column's height at 0).
  static Widget _gap(Widget child) => _TopGap(child: child);
}

/// 6 px above [child] – only when [child] shows something (height > 0).
class _TopGap extends SingleChildRenderObjectWidget {
  const _TopGap({required super.child});

  @override
  RenderObject createRenderObject(BuildContext context) => _RenderTopGap();
}

class _RenderTopGap extends RenderShiftedBox {
  _RenderTopGap() : super(null);
  static const gap = 6.0;

  @override
  void performLayout() {
    final c = child;
    if (c == null) {
      size = constraints.smallest;
      return;
    }
    c.layout(constraints.loosen(), parentUsesSize: true);
    final g = c.size.height > 0 ? gap : 0.0;
    (c.parentData! as BoxParentData).offset = Offset(0, g);
    size = constraints.constrain(Size(c.size.width, c.size.height + g));
  }
}
