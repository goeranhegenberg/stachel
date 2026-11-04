import '../../editor/registry/board_ui.dart';
import '../../model/board_object.dart' show BoardObject;
import '../../model/board_source.dart';
import '../../protocol/native_messages.dart';
import 'timeline_model.dart';
import 'timeline_state.dart';

// The web actions `timeline.*` (server: web/src/features/structure/timeline/native.ts) with a local preview
// (`predicted`): the same change computed with the ported model, shown until the server's patch arrives.

/// Ungesperrte Zeitleiste [id] (null = not there, locked or no rights).
BoardObject? editableTimeline(BoardUi ui, String id) {
  final o = ui.controller.state[id];
  return o != null && o.type == 'timeline' && !o.locked && ui.editor.editable ? o : null;
}

/// Runs [name] if the server offers it; [next] = predicted data, [extra] = predicted object fields.
Future<ActDone?> tlAct(
  BoardUi ui,
  String id,
  String name,
  Map<String, Object?> args, {
  TimelineData Function(TimelineData d)? next,
  Map<String, Object?> extra = const {},
  String? key,
  String? label,
}) async {
  final o = editableTimeline(ui, id);
  if (o == null || !ui.controller.canAct(name)) return null;
  final today = tlToday();
  final patch = next == null && extra.isEmpty
      ? const <String, Object?>{}
      : tlEditPatch(o, today, next: next?.call(safeTimeline(o.raw['timeline']).copy()), extra: extra);
  return ui.controller.act(
    name,
    args,
    key: key,
    label: label,
    predicted: patch.isEmpty
        ? const []
        : [
            UpdateOp({id: patch}),
          ],
  );
}

/// New item (web `createAndEdit`): own step, active, its title written right away. Returns its id (`<key>-1`).
String? tlAddItem(BoardUi ui, String id, String lane, int a, int b, {bool edit = true}) {
  if (editableTimeline(ui, id) == null || !ui.controller.canAct('timeline.addItem')) return null;
  final key = BoardController.newActKey();
  final item = '$key-1';
  final it = TlItem(lane: lane, start: tlFmtDay(a), end: tlFmtDay(b));
  tlAct(
    ui,
    id,
    'timeline.addItem',
    {'id': id, 'lane': lane, 'start': it.start, 'end': it.end},
    key: key,
    label: 'Eintrag anlegen',
    next: (d) => d..items[item] = it.copyWith(lane: d.lanes.contains(lane) ? lane : d.lanes.first),
  );
  final st = TimelineState.of(ui.editor);
  if (edit) {
    st.startEdit(id, TlFocus.item(item));
  } else {
    st.setFocus(id, TlFocus.item(item));
  }
  return item;
}

/// New item at [day] (null: today or the range's start) in [lane] (null: the active item's lane, else the first) –
/// double tap, „Eintrag hinzufügen (heute)“, „Eintrag hier anlegen“ (web `newItemAt`).
String? tlNewItemAt(BoardUi ui, String id, String? lane, int? day) {
  final o = editableTimeline(ui, id);
  if (o == null) return null;
  final today = tlToday();
  final l = tlLayoutFor(o.raw, today);
  final (a, b) = tlNewItemSpan(l, day, today);
  final act = TimelineState.of(ui.editor).activeItem(id);
  final fromItem = act == null ? null : safeTimeline(o.raw['timeline']).items[act]?.lane;
  return tlAddItem(ui, id, lane ?? fromItem ?? l.lanes.first.id, a, b);
}

/// Fields of an item (drag, lane, color; [clearColor] = default color; [ms] = bar ↔ milestone like the web).
void tlPatchItem(
  BoardUi ui,
  String id,
  String key, {
  int? a,
  int? b,
  String? lane,
  String? color,
  bool clearColor = false,
  bool? ms,
  String? label,
}) {
  final o = editableTimeline(ui, id);
  final it = o == null ? null : safeTimeline(o.raw['timeline']).items[key];
  if (o == null || it == null) return;
  var n = it.copyWith(
    start: a == null ? null : tlFmtDay(a),
    end: b == null ? null : tlFmtDay(b),
    lane: lane,
    color: color,
    clearColor: clearColor,
  );
  if (ms != null && ms != it.ms) {
    final p = tlToggleMsPatch(n, tlUnitOf(o.raw));
    n = n.copyWith(end: p['end']! as String, ms: p['ms'] == true);
  }
  tlAct(
    ui,
    id,
    'timeline.patchItem',
    {
      'id': id,
      'key': key,
      if (a != null) 'start': tlFmtDay(a),
      if (b != null) 'end': tlFmtDay(b),
      'lane': ?lane,
      if (clearColor) 'color': null else 'color': ?color,
      'ms': ?ms,
    },
    label: label,
    next: (d) => d..items[key] = n,
  );
}

/// Dialog: start or end (web `setDay`).
void tlSetDay(BoardUi ui, String id, String key, String which, int day) {
  final o = editableTimeline(ui, id);
  final it = o == null ? null : safeTimeline(o.raw['timeline']).items[key];
  if (o == null || it == null) return;
  final p = tlDayPatch(it, which, day);
  tlAct(ui, id, 'timeline.setDay', {
    'id': id,
    'key': key,
    'which': which,
    'day': tlFmtDay(day),
  }, next: (d) => d..items[key] = it.copyWith(start: p['start'], end: p['end']));
}

void tlRemoveItem(BoardUi ui, String id, String key) {
  tlAct(
    ui,
    id,
    'timeline.removeItem',
    {'id': id, 'key': key},
    label: 'Eintrag löschen',
    next: (d) => d..items.remove(key),
  );
  TimelineState.of(ui.editor).setFocus(id, null);
}

/// New lane under [after] (or at the end), named right away (web `addLaneAndName`); null = 40 lanes already.
String? tlAddLane(BoardUi ui, String id, {String? after}) {
  final o = editableTimeline(ui, id);
  if (o == null || !ui.controller.canAct('timeline.addLane')) return null;
  if (safeTimeline(o.raw['timeline']).lanes.length >= tlMaxLanes) {
    ui.host.showMessage('Mehr Spuren gehen nicht.');
    return null;
  }
  final key = BoardController.newActKey();
  final lane = '$key-1';
  tlAct(
    ui,
    id,
    'timeline.addLane',
    {'id': id, 'after': ?after},
    key: key,
    label: 'Spur hinzufügen',
    next: (d) {
      final i = after == null ? -1 : d.lanes.indexOf(after);
      d.lanes.insert(i < 0 ? d.lanes.length : i + 1, lane);
      d.names[lane] = '';
      return d;
    },
  );
  TimelineState.of(ui.editor).startEdit(id, TlFocus.lane(lane));
  return lane;
}

/// Lane to index [to] of the new order (web `moveLane`).
void tlMoveLane(BoardUi ui, String id, String lane, int to) {
  tlAct(
    ui,
    id,
    'timeline.moveLane',
    {'id': id, 'lane': lane, 'to': to},
    label: 'Spur verschieben',
    next: (d) {
      final from = d.lanes.indexOf(lane);
      final dest = to.clamp(0, d.lanes.length - 1);
      if (from < 0 || from == dest) return d;
      d.lanes
        ..remove(lane)
        ..insert(dest, lane);
      return d;
    },
  );
}

/// Lane with its items (the last one stays).
void tlRemoveLane(BoardUi ui, String id, String lane) {
  tlAct(
    ui,
    id,
    'timeline.removeLane',
    {'id': id, 'lane': lane},
    label: 'Spur löschen',
    next: (d) {
      if (d.lanes.length <= 1) return d;
      d.lanes.remove(lane);
      d.names.remove(lane);
      d.items.removeWhere((_, it) => it.lane == lane);
      return d;
    },
  );
}

/// Range to the items before/after (button „‹ n“ / „n ›“).
void tlExtend(BoardUi ui, String id, String side) {
  final o = editableTimeline(ui, id);
  if (o == null) return;
  final r = tlExtendRange(o.raw, side, tlToday());
  tlAct(
    ui,
    id,
    'timeline.setRange',
    {'id': id, 'extend': side},
    label: 'Zeitraum erweitern',
    extra: {'tlStart': tlFmtDay(r.start), 'tlEnd': tlFmtDay(r.end)},
  );
}

/// Zeitskala Tag/Woche/Monat.
void tlSetUnit(BoardUi ui, String id, String unit) {
  tlAct(
    ui,
    id,
    'timeline.setUnit',
    {'id': id, 'unit': unit},
    label: 'Zeitskala',
    extra: {'tlUnit': unit == 'week' ? null : unit},
  );
}
