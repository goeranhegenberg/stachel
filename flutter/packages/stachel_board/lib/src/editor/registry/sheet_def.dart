import 'package:flutter/widgets.dart';

import 'board_ui.dart';
import 'registry.dart';

/// A bottom sheet a package opens by name (web `defineModal`): templates gallery, version history, export, shape
/// library, gestures help … Open it with [BoardUi.openRegisteredSheet].
class SheetDef implements RegistryEntry {
  const SheetDef({
    required this.id,
    required this.build,
    this.order = 0,
    this.closeOnSelectionChange = false,
    this.scrollControlled = true,
  });

  @override
  final String id;
  @override
  final double order;

  /// The sheet's content ([args] from the caller).
  final Widget Function(BuildContext context, BoardUi ui, Map<String, Object?> args) build;

  /// Popover of the context bar: a new selection closes it (D44).
  final bool closeOnSelectionChange;
  final bool scrollControlled;
}
