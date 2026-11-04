import 'package:flutter/widgets.dart';

import '../../model/board_object.dart';
import 'board_ui.dart';
import 'registry.dart';

/// What the context bar knows about the selection (web `CtxInfo`).
class CtxInfo {
  CtxInfo(this.selected) : types = {for (final o in selected) o.type};

  final List<BoardObject> selected;
  final Set<String> types;
  BoardObject get first => selected.first;
  BoardObject? get single => selected.length == 1 ? selected.single : null;

  /// Every selected object is locked.
  bool get locked => selected.isNotEmpty && selected.every((o) => o.locked);

  /// Only objects of [type].
  bool only(String type) => types.length == 1 && types.contains(type);
}

/// Group of the context bar's overflow sheet „Mehr“ in the app (UX P4; the web keeps its bar). Headings in this order;
/// an entry without a section lands in [more].
enum CtxSection {
  text('SCHRIFT'),
  style('DARSTELLUNG'),
  content('INHALT'),
  arrange('ANORDNEN'),
  link('VERKNÜPFEN'),
  collab('ZUSAMMENARBEIT'),
  more('MEHR');

  const CtxSection(this.title);

  /// Heading in the sheet.
  final String title;
}

/// One button of the context bar. Data, not a widget: the bar shows the [primary] entries first (beschriftet: Farbe,
/// Text, Kommentar, Duplizieren, Löschen), fills the rest of the row in registry order and puts what does not fit
/// behind „Mehr“ (web D44) – there the same entry is a list row with [label] under the heading of its [section].
class CtxItem {
  const CtxItem({
    required this.key,
    required this.label,
    required this.onTap,
    this.icon,
    this.leading,
    this.danger = false,
    this.active = false,
    this.width = 48,
    this.primary = false,
    this.short,
    this.section,
  });

  /// Widget key (`stachelCtx…`), the same inline and in the overflow sheet.
  final String key;

  /// Tooltip / row text („Farbe“).
  final String label;
  final IconData? icon;

  /// Instead of [icon] (color dot …).
  final Widget Function(BuildContext context)? leading;
  final void Function(BuildContext context, BoardUi ui) onTap;
  final bool danger;
  final bool active;

  /// Width in the bar (px) of the icon-only button (the web's); the app's labeled buttons share the row evenly.
  final double width;

  /// Core action of the phone bar (UX P4): always in the row, before every other entry.
  final bool primary;

  /// Label under the icon in the bar (null = [label]), e.g. „Text“ for „Text bearbeiten“.
  final String? short;

  /// Overrides the section of its [ContextActionDef] (e.g. „Nach vorne“ in [CtxSection.arrange] next to Duplizieren).
  final CtxSection? section;
}

/// An entry of the context bar (web `defineContextAction`): [appliesTo] the selection, then its [items] in [order]
/// (core 10–90; packages put their groups in between, like the web). [section] = heading of its items in the app's
/// overflow sheet (null = [CtxSection.more]; an item may override it).
class ContextActionDef implements RegistryEntry {
  const ContextActionDef({
    required this.id,
    required this.order,
    required this.appliesTo,
    required this.items,
    this.section,
  });

  @override
  final String id;
  @override
  final double order;
  final bool Function(CtxInfo c, BoardUi ui) appliesTo;
  final List<CtxItem> Function(BuildContext context, BoardUi ui, CtxInfo c) items;
  final CtxSection? section;
}

/// How many of [widths] fit into [avail] (web `fitCount`): all of them if they fit, else as many as fit next to the
/// „···“ button of width [moreW].
int fitCount(List<double> widths, double avail, {double moreW = 48}) {
  final total = widths.fold(0.0, (s, w) => s + w);
  if (total <= avail) return widths.length;
  var sum = 0.0;
  for (var i = 0; i < widths.length; i++) {
    if (sum + widths[i] + moreW > avail) return i;
    sum += widths[i];
  }
  return widths.length;
}
