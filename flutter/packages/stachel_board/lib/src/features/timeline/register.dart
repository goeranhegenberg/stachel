import 'package:flutter/material.dart';

import '../../editor/registry/board_ui.dart';
import '../../editor/registry/context_action_def.dart';
import '../../editor/registry/menu_item_def.dart';
import '../../editor/registry/overlay_def.dart';
import '../../editor/registry/registry.dart';
import '../../editor/registry/type_behavior.dart';
import '../../model/board_object.dart';
import '../../render/types/timeline_renderer.dart' show tlOutsideRect;
import '../core/core_widgets.dart' show ColorSwatchDot, pickColor;
import '../shapes/shape_widgets.dart' show colorNameOf;
import 'timeline_actions.dart';
import 'timeline_dialog.dart';
import 'timeline_model.dart';
import 'timeline_overlay.dart';
import 'timeline_state.dart';

/// P9: Zeitleiste (act `timeline.*`): Treffer, Ziehen, Dialog, Spur-Menü, Zeitskala, Zeitraum, Notiz auf Spur.
///
/// Owner: P9 (parity audit §4, rows E19, I16–I23). Only this directory (`features/timeline/`, tests
/// `test/features/timeline/`) and `render/types/timeline_renderer.dart` belong to the package; core files change only
/// through the registries and `act`.
///
/// Entries (web id · order): context bar `structure.timeline` · 74 (Zeitskala, Spur hinzufügen, Eintrag hinzufügen),
/// `structure.timelineItem` · 75 (with an active item: Farbe, Meilenstein, Titel/Datum/Spur, Löschen), object menu
/// `structure.tl.item1–4` (on an item) and `structure.tl.lane1–6` (on a lane / lane name), type `timeline` (tap = active
/// item/lane, „‹ n“/„n ›“; double tap = title, lane name or new item; side handles = range), overlay
/// `structure.timeline` (drag items/ends, hold = dialog, lane grip, „+ Spur“, writing in place, notes onto a lane).
/// The structure tool's fourth kind „Zeitleiste“ lives in features/cards/register.dart (C15).
void registerTimeline(BoardRegistry r) {
  r.defineOverlay(
    OverlayDef(
      id: 'structure.timeline',
      order: 41,
      build: (context, ui) => TimelineOverlay(ui: ui),
    ),
  );
  r.defineContextAction(
    ContextActionDef(
      id: 'structure.timeline',
      order: 74,
      section: CtxSection.content,
      appliesTo: _isTimelineSel,
      items: (context, ui, c) {
        final o = c.single!;
        final unit = tlUnitOf(o.raw);
        final f = TimelineState.of(ui.editor).focusOf(o.id);
        final lane = f?.kind == 'lane' ? f!.id : null;
        return [
          if (ui.controller.canAct('timeline.setUnit'))
            CtxItem(
              key: 'stachelTlUnit',
              label: 'Zeitskala',
              width: 76,
              leading: (_) =>
                  Text(tlUnits.firstWhere((u) => u.$1 == unit).$2.toUpperCase(), style: ui.theme.label(size: 15)),
              onTap: (context, ui) async {
                final v = await _pickUnit(context, ui, unit);
                if (v != null && v != unit) tlSetUnit(ui, o.id, v);
              },
            ),
          if (ui.controller.canAct('timeline.addLane'))
            CtxItem(
              key: 'stachelTlLaneAdd',
              label: 'Spur hinzufügen',
              icon: Icons.playlist_add,
              onTap: (context, ui) => tlAddLane(ui, o.id, after: lane),
            ),
          if (ui.controller.canAct('timeline.addItem'))
            CtxItem(
              key: 'stachelTlItemAdd',
              label: 'Eintrag hinzufügen (heute)',
              icon: Icons.add_box_outlined,
              onTap: (context, ui) => tlNewItemAt(ui, o.id, lane, null),
            ),
        ];
      },
    ),
  );
  r.defineContextAction(
    ContextActionDef(
      id: 'structure.timelineItem',
      order: 75,
      section: CtxSection.content,
      appliesTo: (c, ui) => _isTimelineSel(c, ui) && _activeItem(ui, c.single!) != null,
      items: (context, ui, c) {
        final o = c.single!;
        final key = TimelineState.of(ui.editor).activeItem(o.id)!;
        final it = _activeItem(ui, o)!;
        return [
          if (ui.controller.canAct('timeline.patchItem')) ...[
            CtxItem(
              key: 'stachelTlColor',
              label: 'Farbe des Eintrags',
              leading: (_) => ColorSwatchDot(it.color ?? tlDefaultColor, ink: ui.theme.ink),
              onTap: (context, ui) async {
                final v = await pickColor(context, ui, tlColors, keyPrefix: 'stachelTlColor');
                if (v != null) _setColor(ui, o.id, key, v);
              },
            ),
            CtxItem(
              key: 'stachelTlMs',
              label: 'Meilenstein',
              icon: Icons.diamond_outlined,
              active: it.ms,
              onTap: (context, ui) => tlPatchItem(ui, o.id, key, ms: !it.ms),
            ),
          ],
          CtxItem(
            key: 'stachelTlDates',
            label: 'Titel, Datum und Spur',
            icon: Icons.edit_calendar_outlined,
            onTap: (context, ui) => openTimelineItemDialog(context, ui, o.id, key),
          ),
          if (ui.controller.canAct('timeline.removeItem'))
            CtxItem(
              key: 'stachelTlItemDel',
              label: 'Eintrag löschen',
              icon: Icons.event_busy_outlined,
              danger: true,
              onTap: (context, ui) => tlRemoveItem(ui, o.id, key),
            ),
        ];
      },
    ),
  );

  // ---- object menu (web `itemMenu` / `laneMenu`) ----------------------------------------------------------------
  void itemMenu(int order, MenuEntry? Function(BoardUi ui, BoardObject o, String key, TlItem it) build) =>
      r.defineMenuItem(
        MenuItemDef(
          id: 'structure.tl.item$order',
          on: MenuTarget.object,
          order: order.toDouble(),
          entry: (ui, at) {
            final m = _menuHit(ui, at);
            if (m == null || m.hit.kind != 'item') return null;
            final it = safeTimeline(m.o.raw['timeline']).items[m.hit.id];
            return it == null ? null : build(ui, m.o, m.hit.id!, it);
          },
        ),
      );
  itemMenu(
    1,
    (ui, o, key, it) => MenuEntry(
      key: 'stachelTlMenuDialog',
      label: 'Titel, Datum und Spur …',
      icon: Icons.edit_calendar_outlined,
      onSelect: (context, ui) => openTimelineItemDialog(context, ui, o.id, key),
    ),
  );
  itemMenu(
    2,
    (ui, o, key, it) => !ui.controller.canAct('timeline.patchItem')
        ? null
        : MenuEntry(
            key: 'stachelTlMenuColor',
            label: 'Farbe',
            icon: Icons.palette_outlined,
            items: [
              for (final c in tlColors)
                MenuEntry(
                  key: 'stachelTlMenuColor-$c',
                  label: colorNameOf(c),
                  onSelect: (context, ui) => _setColor(ui, o.id, key, c),
                ),
            ],
          ),
  );
  itemMenu(
    3,
    (ui, o, key, it) => !ui.controller.canAct('timeline.patchItem')
        ? null
        : MenuEntry(
            key: 'stachelTlMenuMs',
            label: it.ms ? 'Als Balken' : 'Als Meilenstein',
            icon: it.ms ? Icons.horizontal_rule : Icons.diamond_outlined,
            onSelect: (context, ui) => tlPatchItem(ui, o.id, key, ms: !it.ms),
          ),
  );
  itemMenu(
    4,
    (ui, o, key, it) => !ui.controller.canAct('timeline.removeItem')
        ? null
        : MenuEntry(
            key: 'stachelTlMenuDelete',
            label: 'Eintrag löschen',
            icon: Icons.event_busy_outlined,
            danger: true,
            onSelect: (context, ui) => tlRemoveItem(ui, o.id, key),
          ),
  );

  void laneMenu(int order, MenuEntry? Function(BoardUi ui, BoardObject o, String lane, TlLayout l, TlHit hit) build) =>
      r.defineMenuItem(
        MenuItemDef(
          id: 'structure.tl.lane$order',
          on: MenuTarget.object,
          order: order.toDouble(),
          entry: (ui, at) {
            final m = _menuHit(ui, at);
            if (m == null || (m.hit.kind != 'label' && m.hit.kind != 'lane')) return null;
            return build(ui, m.o, m.hit.lane!, m.l, m.hit);
          },
        ),
      );
  laneMenu(
    1,
    (ui, o, lane, l, hit) => hit.kind != 'lane' || !ui.controller.canAct('timeline.addItem')
        ? null
        : MenuEntry(
            key: 'stachelTlMenuItemHere',
            label: 'Eintrag hier anlegen',
            icon: Icons.add_box_outlined,
            onSelect: (context, ui) => tlNewItemAt(ui, o.id, lane, hit.day),
          ),
  );
  laneMenu(
    2,
    (ui, o, lane, l, hit) => !ui.controller.canAct('timeline.setLaneName')
        ? null
        : MenuEntry(
            key: 'stachelTlMenuRename',
            label: 'Spur umbenennen',
            icon: Icons.drive_file_rename_outline,
            onSelect: (context, ui) => TimelineState.of(ui.editor).startEdit(o.id, TlFocus.lane(lane)),
          ),
  );
  laneMenu(
    3,
    (ui, o, lane, l, hit) => !ui.controller.canAct('timeline.addLane')
        ? null
        : MenuEntry(
            key: 'stachelTlMenuLaneBelow',
            label: 'Spur darunter einfügen',
            icon: Icons.playlist_add,
            onSelect: (context, ui) => tlAddLane(ui, o.id, after: lane),
          ),
  );
  laneMenu(4, (ui, o, lane, l, hit) {
    if (!ui.controller.canAct('timeline.moveLane')) return null;
    final i = l.lanes.indexWhere((x) => x.id == lane);
    return MenuEntry(
      key: 'stachelTlMenuLaneUp',
      label: 'Spur nach oben',
      icon: Icons.arrow_upward,
      disabled: i <= 0,
      onSelect: (context, ui) => tlMoveLane(ui, o.id, lane, i - 1),
    );
  });
  laneMenu(5, (ui, o, lane, l, hit) {
    if (!ui.controller.canAct('timeline.moveLane')) return null;
    final i = l.lanes.indexWhere((x) => x.id == lane);
    return MenuEntry(
      key: 'stachelTlMenuLaneDown',
      label: 'Spur nach unten',
      icon: Icons.arrow_downward,
      disabled: i >= l.lanes.length - 1,
      onSelect: (context, ui) => tlMoveLane(ui, o.id, lane, i + 1),
    );
  });
  laneMenu(
    6,
    (ui, o, lane, l, hit) => !ui.controller.canAct('timeline.removeLane')
        ? null
        : MenuEntry(
            key: 'stachelTlMenuLaneDelete',
            label: 'Spur löschen',
            icon: Icons.delete_outline,
            danger: true,
            disabled: l.lanes.length <= 1,
            onSelect: (context, ui) => tlRemoveLane(ui, o.id, lane),
          ),
  );

  r.defineType(
    TypeBehavior(
      type: 'timeline',
      label: 'Zeitleiste',
      // side handles change the range (the day width stays), corners scale everything (web `resize`)
      resize: (o, box, handle) => tlResize(o, box, handle, tlToday()),
      onTap: _tap,
      onDoubleTap: _doubleTap,
    ),
  );
}

bool _isTimelineSel(CtxInfo c, BoardUi ui) => ui.editor.editable && c.single?.type == 'timeline' && !c.single!.locked;

TlItem? _activeItem(BoardUi ui, BoardObject o) {
  final key = TimelineState.of(ui.editor).activeItem(o.id);
  return key == null ? null : safeTimeline(o.raw['timeline']).items[key];
}

void _setColor(BoardUi ui, String id, String key, String c) =>
    tlPatchItem(ui, id, key, color: c == tlDefaultColor ? null : c, clearColor: c == tlDefaultColor);

/// Hit of a long press in the selected, unlocked timeline (web `menuHit`).
({BoardObject o, TlLayout l, TlHit hit})? _menuHit(BoardUi ui, MenuAt at) {
  final sel = ui.editor.selected;
  final o = sel.length == 1 ? sel.single : null;
  if (o == null || o.type != 'timeline' || o.locked || !ui.editor.editable) return null;
  final l = tlLayoutFor(o.raw, tlToday());
  final q = tlToLocal(o, l, at.world.dx, at.world.dy);
  final hit = tlHitLocal(l, q.lx, q.ly);
  return hit == null ? null : (o: o, l: l, hit: hit);
}

/// Hit of a tap in timeline [o].
({TlLayout l, TlHit hit, double lx, double ly})? _hitOf(TypeTapEvent e) {
  final o = e.object;
  final l = tlLayoutFor(o.raw, tlToday());
  final q = tlToLocal(o, l, e.world.dx, e.world.dy);
  final hit = tlHitLocal(l, q.lx, q.ly);
  return hit == null ? null : (l: l, hit: hit, lx: q.lx, ly: q.ly);
}

/// Web pointer down: „‹ n“ / „n ›“ extend the range; an item or lane becomes the active one (the editor selects).
bool _tap(TypeTapEvent e) {
  final h = _hitOf(e);
  if (h == null) return false;
  final o = e.object;
  final ui = TimelineState.of(e.editor).ui;
  if (h.hit.kind == 'header' && ui != null && editableTimeline(ui, o.id) != null) {
    for (final (side, n) in [('before', h.l.before), ('after', h.l.after)]) {
      if (n > 0 && tlOutsideRect(h.l, side, n).contains(Offset(h.lx, h.ly))) {
        tlExtend(ui, o.id, side);
        return true;
      }
    }
  }
  final st = TimelineState.of(e.editor);
  if (h.hit.kind == 'item') st.setFocus(o.id, TlFocus.item(h.hit.id!));
  if (h.hit.kind == 'label' || h.hit.kind == 'lane') st.setFocus(o.id, TlFocus.lane(h.hit.lane!));
  return false;
}

/// Web double click: item → title, lane name → rename, lane → new item from that day (then its title).
bool _doubleTap(TypeTapEvent e) {
  final st = TimelineState.of(e.editor);
  final ui = st.ui;
  if (ui == null || editableTimeline(ui, e.object.id) == null) return false;
  final h = _hitOf(e);
  if (h == null) return false;
  final id = e.object.id;
  switch (h.hit.kind) {
    case 'item':
      st.startEdit(id, TlFocus.item(h.hit.id!));
      return true;
    case 'label':
      if (!ui.controller.canAct('timeline.setLaneName')) return false;
      st.startEdit(id, TlFocus.lane(h.hit.lane!));
      return true;
    case 'lane':
      e.editor.select({id});
      return tlNewItemAt(ui, id, h.hit.lane, h.hit.day) != null;
  }
  return false;
}

Future<String?> _pickUnit(BuildContext context, BoardUi ui, String current) => ui.openSheet<String>(
  context,
  (ctx) => SafeArea(
    child: Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      child: Wrap(
        spacing: 8,
        children: [
          for (final (unit, label) in tlUnits)
            ChoiceChip(
              key: Key('stachelTlUnit-$unit'),
              label: Text(label),
              selected: current == unit,
              onSelected: (_) => Navigator.of(ctx).pop(unit),
            ),
        ],
      ),
    ),
  ),
);
