import 'package:flutter/widgets.dart';

import '../../model/board_object.dart';
import '../board_editor.dart';
import 'registry.dart';

/// A tap/double tap on an object of a type with own behavior (table cell, timeline bar, document page bar …).
class TypeTapEvent {
  const TypeTapEvent({
    required this.editor,
    required this.object,
    required this.world,
    required this.screen,
    this.selected = false,
  });
  final BoardEditor editor;
  final BoardObject object;
  final Offset world;
  final Offset screen;

  /// The object was selected before the tap.
  final bool selected;
}

/// How the editor treats objects of [type] (web `ObjectTypeDef` behavior parts): German [label] for the selection
/// panel and menus, what editing means ([edit]), which handles it has, and own tap/double tap handling (return true =
/// handled, the editor's default does nothing more). The core registers the existing types with today's behavior;
/// P1 (handles), P3 (card/table), P7 (document), P9 (timeline) fill in theirs.
class TypeBehavior implements RegistryEntry {
  const TypeBehavior({
    required this.type,
    required this.label,
    this.edit,
    this.handles,
    this.onTap,
    this.onDoubleTap,
    this.describe,
    this.resize,
  });

  final String type;

  @override
  String get id => type;
  @override
  double get order => 0;

  /// „Haftnotiz“, „Form“ …
  final String label;

  /// `text` (rich text in place), `title` (frame title), `label` (connector label); null = nothing to write.
  final String? edit;

  /// Handle ids of a single selected object (`nw`/`n`/…, `rotate`, `add-e`, `anchor-s` …); null = editor default.
  final List<String> Function(BoardObject o)? handles;

  final bool Function(TypeTapEvent e)? onTap;
  final bool Function(TypeTapEvent e)? onDoubleTap;

  /// Text of the selection panel; null = „label: first line“.
  final String Function(BoardObject o)? describe;

  /// Size while a resize handle is dragged (web `ObjectTypeDef.resize`): gets the object, the box the editor computed
  /// (`x`/`y`/`w`/`h`) and the handle id, returns the patch to write (card: width ≥ 160, height from the content;
  /// table: height from the wrapped cells). Null = the editor's box.
  final Map<String, Object?> Function(BoardObject o, Map<String, Object?> box, String handle)? resize;
}
