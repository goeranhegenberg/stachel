import 'package:flutter/widgets.dart';

import 'board_ui.dart';
import 'registry.dart';

/// Which menu an entry belongs to (web `defineMenuItem({on})`).
enum MenuTarget {
  /// Long press on an object (D43).
  object,

  /// Long press on the empty board (D42).
  canvas,

  /// Board menu „···“ in the app bar (B09).
  board,
}

/// Where the menu was opened: world point and, for [MenuTarget.object], the pressed object.
class MenuAt {
  const MenuAt(this.world, {this.objectId});
  final Offset world;
  final String? objectId;
}

/// Group of the board menu in the app (UX P7, Göran 04.11.: only the phone groups, the web keeps its flat list; the
/// registry order and ids stay the web's). [quick] = row of big tiles at the top, then the groups with a heading in
/// this order; an entry without a section lands in [more]. Object and empty-board menus ignore sections.
enum MenuSection {
  quick(''),
  collab('ZUSAMMENARBEIT'),
  view('ANSICHT'),
  board('BOARD'),
  more('MEHR');

  const MenuSection(this.title);

  /// Heading in the sheet (empty for [quick]).
  final String title;
}

/// One row of a menu (web `MenuItem`): [items] = submenu (opens in place, like the web below 700 px), [sep] = line
/// above, [danger] = red, [disabled] = greyed.
class MenuEntry {
  const MenuEntry({
    required this.label,
    this.key,
    this.icon,
    this.subtitle,
    this.onSelect,
    this.items,
    this.sep = false,
    this.danger = false,
    this.disabled = false,
    this.short,
    this.badge,
  });

  final String label;
  final String? key;
  final IconData? icon;
  final String? subtitle;

  /// Runs after the menu closed (with the context of the screen).
  final void Function(BuildContext context, BoardUi ui)? onSelect;
  final List<MenuEntry>? items;
  final bool sep;
  final bool danger;
  final bool disabled;

  /// Text of the tile in [MenuSection.quick] (null = [label] without „ …“ and a trailing „(…)“).
  final String? short;

  /// Small counter on the tile / at the row's end (open comments „2“; null = none).
  final String? badge;
}

/// A menu entry (web `defineMenuItem`): [entry] builds the row for the current state (null = not shown).
///
/// [section] places a board-menu entry in the app's grouped sheet (null = [MenuSection.more]); [sectionOrder] sorts
/// inside the section (null = [order], so the web order holds unless a section wants it otherwise).
class MenuItemDef implements RegistryEntry {
  const MenuItemDef({
    required this.id,
    required this.on,
    required this.order,
    required this.entry,
    this.section,
    this.sectionOrder,
  });

  @override
  final String id;
  final MenuTarget on;
  @override
  final double order;
  final MenuEntry? Function(BoardUi ui, MenuAt at) entry;
  final MenuSection? section;
  final double? sectionOrder;
}
