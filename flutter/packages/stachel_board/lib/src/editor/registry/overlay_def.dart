import 'package:flutter/widgets.dart';

import 'board_ui.dart';
import 'registry.dart';

/// Something drawn or shown over the board by a package (web `defineSlot` 'overlay'/'world'): voting panel, timer,
/// laser trails, snap guides, presentation controls … Stacked over the [BoardView] in [order] by `BoardOverlays`.
/// Overlays get pointer events only where they draw something hit-testable (wrap passive ones in `IgnorePointer`).
///
/// Below the objects there is no widget layer: the board background (P4) goes through `RenderContext.background`.
class OverlayDef implements RegistryEntry {
  const OverlayDef({required this.id, required this.order, required this.build, this.presenting = false});

  @override
  final String id;
  @override
  final double order;

  /// Also shown in presentation mode (web `presenting`); others are hidden there.
  final bool presenting;
  final Widget Function(BuildContext context, BoardUi ui) build;
}
