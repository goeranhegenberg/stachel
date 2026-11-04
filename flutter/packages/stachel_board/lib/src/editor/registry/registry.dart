import 'package:flutter/widgets.dart';

import '../../model/board_state.dart';
import '../board_editor.dart';
import '../camera.dart';
import 'board_ui.dart';
import 'context_action_def.dart';
import 'menu_item_def.dart';
import 'overlay_def.dart';
import 'sheet_def.dart';
import 'tool_def.dart';
import 'type_behavior.dart';

/// An entry of a registry: unique [id], sorted by [order] (ties: first defined first, like the web's registries).
abstract class RegistryEntry {
  String get id;
  double get order;
}

/// Ordered entries by id (web `editor/ext/registry.ts`): [define] adds or replaces (a package may replace a core
/// entry with the same id, e.g. a richer tool), [remove] takes one out, [list] is sorted by order.
class Registry<T extends RegistryEntry> {
  final _entries = <String, T>{};
  final _seq = <String, int>{};
  int _next = 0;
  List<T>? _sorted;

  /// Adds [entry] or replaces the one with the same id (keeps its place among equal orders).
  void define(T entry) {
    _seq.putIfAbsent(entry.id, () => _next++);
    _entries[entry.id] = entry;
    _sorted = null;
  }

  void remove(String id) {
    if (_entries.remove(id) != null) _sorted = null;
  }

  T? operator [](String id) => _entries[id];
  bool contains(String id) => _entries.containsKey(id);
  int get length => _entries.length;

  /// All entries by order.
  List<T> list() => _sorted ??= (_entries.values.toList()
    ..sort((a, b) {
      final c = a.order.compareTo(b.order);
      return c != 0 ? c : _seq[a.id]!.compareTo(_seq[b.id]!);
    }));
}

/// Hook after a drag move (see [BoardRegistry.afterMoves]).
typedef AfterMove = void Function(BoardEditor editor, List<String> ids, String? grabbed);

/// Everything the board UI is built from (audit §4 „Register wie im Web“): tools, context bar entries, menu entries
/// (object / empty board / board menu), sheets, overlays and per-type behavior. Every feature package fills it from
/// its own `features/<paket>/register.dart` (collected in `editor/registry/all_features.dart`); the app adds its own
/// entries (link, browser, comments …) the same way.
class BoardRegistry {
  final tools = Registry<ToolDef>();
  final contextActions = Registry<ContextActionDef>();
  final menuItems = Registry<MenuItemDef>();
  final sheets = Registry<SheetDef>();
  final overlays = Registry<OverlayDef>();
  final types = Registry<TypeBehavior>();

  /// Asked before the selection is deleted from the context bar or menu (mind nodes with subtopics ask first); all
  /// must return true.
  final deleteGuards = <Future<bool> Function(BuildContext context, BoardUi ui)>[];

  /// New object of a type at a world point (web `ObjectTypeDef.create`: tool tap, double tap, „… hier“) – P2 sets the
  /// note's shape/color, the shape's library size, the text's measured width; null = the editor's defaults.
  final creates = <String, Map<String, Object?>? Function(BoardEditor editor, Offset p, String? shape)>{};

  /// First camera of a board instead of „Alles einpassen“ (P4: on the phone never below 35 %, web
  /// `PHONE_MIN_START_ZOOM`): gets the content [bounds] and the view [size], null = fit everything.
  Camera? Function(BoardState state, Rect bounds, Size size)? startCamera;

  /// Things drawn over the board that can be held and dragged to a new place, by kind of the overlay hit (P5:
  /// `comment` = comment pin, web L02): gets the hit's reference (thread id), the new world point of what it marks and
  /// the object there (null = free); the dragged thing stays at the drop until the returned future completes (null =
  /// snaps back at once). Kinds without an entry cannot be dragged.
  final overlayDrops =
      <String, Future<void>? Function(BoardEditor editor, String ref, Offset world, String? objectId)>{};

  /// After the selection was dragged to a new place (web `ObjectTypeDef.afterMove`, Q2 note stacks): the moved ids and
  /// the one grabbed (null = moved without grabbing one), called once the move is applied.
  final afterMoves = <AfterMove>[];

  /// Shorthands (read like the web's `defineTool` …).
  void defineTool(ToolDef t) => tools.define(t);
  void defineContextAction(ContextActionDef a) => contextActions.define(a);
  void defineMenuItem(MenuItemDef m) => menuItems.define(m);
  void defineSheet(SheetDef s) => sheets.define(s);
  void defineOverlay(OverlayDef o) => overlays.define(o);
  void defineType(TypeBehavior t) => types.define(t);

  /// Behavior of [type] (null = none registered, the editor's defaults apply).
  TypeBehavior? typeOf(String type) => types[type];
}
