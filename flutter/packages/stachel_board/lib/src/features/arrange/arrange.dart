import 'dart:math' as math;
import 'dart:ui';

import 'package:flutter/foundation.dart';

import '../../editor/camera.dart';
import '../../editor/registry/board_ui.dart';
import '../../model/board_object.dart';
import '../../protocol/native_messages.dart';
import '../../render/board_scene.dart';

/// Arranging like the web (P1, audit D08–D12, D27–D31): what the web computes (align, distribute, group, layer step,
/// format) runs as web action on the server (`core.*`, `tools.*`, contract §8.12); locking, hiding, links and tags are
/// plain `update` ops like the web writes them.

/// Hint texts of the web (`features/tools/*.tsx`).
abstract final class ArrangeTexts {
  static const hiddenOne = 'Ausgeblendet. Zurückholen: Board-Menü → Ausgeblendete zeigen.';
  static String hiddenMany(int n) => '$n Objekte ausgeblendet.';
  static String shown(int n) => n == 1 ? '1 Objekt eingeblendet.' : '$n Objekte eingeblendet.';
  static const linkGone = 'Das verlinkte Ziel gibt es nicht mehr.';
  static const linkSelf = 'Ein Objekt kann nicht auf sich selbst verlinken.';
  static String linked(String name) => 'Verlinkt mit „$name“.';
  static const painterPill = 'Format übertragen: Objekte antippen';
  static const pickPill = 'Link-Ziel antippen (Objekt oder Rahmen)';
  static const styleCopied = 'Format kopiert.';
}

/// Align modes of `core.align` with their German names (web `ALIGNS` / menu `ALIGN_ITEMS`).
const alignModes = [
  ('left', 'Links', 'Links ausrichten'),
  ('hcenter', 'Horizontal zentriert', 'Horizontal zentrieren'),
  ('right', 'Rechts', 'Rechts ausrichten'),
  ('top', 'Oben', 'Oben ausrichten'),
  ('vcenter', 'Vertikal zentriert', 'Vertikal zentrieren'),
  ('bottom', 'Unten', 'Unten ausrichten'),
];

/// Tag colors (web `TAG_COLORS`), longest tag, most tags per note.
const tagColors = ['#c9e14a', '#ec4e92', '#1763b5', '#ffd08a', '#9fd3ff', '#e2d5ff', '#ffb3d1', '#0a0a0a'];
const tagMaxLen = 40;
const tagMax = 8;

List<String> _ids(BoardUi ui) => [for (final o in ui.editor.selected) o.id];

bool allLocked(BoardUi ui) => ui.editor.selected.isNotEmpty && ui.editor.selected.every((o) => o.locked);

// ---- web actions --------------------------------------------------------------------------------------------------

/// Align the selection (D11, `core.align`).
void alignSelection(BoardUi ui, String mode) =>
    ui.controller.act('core.align', {'ids': _ids(ui), 'mode': mode}, label: 'Ausrichten');

/// Distribute the selection along [axis] `x`/`y` (D12, `core.distribute`).
void distributeSelection(BoardUi ui, String axis) =>
    ui.controller.act('core.distribute', {'ids': _ids(ui), 'axis': axis}, label: 'Verteilen');

/// Group (≥ 2 unlocked) / ungroup the selection (D08).
void groupSelection(BoardUi ui) => ui.controller.act('core.group', {'ids': _ids(ui)}, label: 'Gruppieren');
void ungroupSelection(BoardUi ui) => ui.controller.act('core.ungroup', {'ids': _ids(ui)}, label: 'Gruppierung lösen');

/// One layer forward ([dir] 1) or back (−1), past the next overlapping object (D27, `tools.layerStep`).
void layerStep(BoardUi ui, int dir) =>
    ui.controller.act('tools.layerStep', {'ids': _ids(ui), 'dir': dir}, label: 'Ebene');

/// Units for arranging (web `arrangeUnits`).
int arrangeUnitCount(BoardUi ui) => ui.editor.units().length;

/// At least two unlocked selected objects (web: „Gruppieren“ enabled).
bool canGroup(BoardUi ui) => ui.editor.selected.where((o) => !o.locked).length >= 2;

// ---- lock, hide ---------------------------------------------------------------------------------------------------

/// Lock / unlock the selection (D09, web `toggleLock`: all locked → unlock, else lock all).
void toggleLock(BoardUi ui) {
  final objs = ui.editor.selected;
  if (objs.isEmpty || !ui.editor.editable) return;
  final lock = !objs.every((o) => o.locked);
  ui.controller.apply([
    UpdateOp({
      for (final o in objs) o.id: {'locked': lock ? true : null},
    }),
  ]);
}

/// Hide / show the selection (D28, web `toggleHidden`): only unlocked ones; hiding drops the selection and says how
/// to get them back (unless „Ausgeblendete zeigen“ is on).
void toggleHidden(BoardUi ui) {
  final list = [
    for (final o in ui.editor.selected)
      if (!o.locked) o,
  ];
  if (list.isEmpty || !ui.editor.editable) return;
  final hide = !list.every((o) => o.hidden);
  ui.controller.apply([
    UpdateOp({
      for (final o in list) o.id: {'hidden': hide ? true : null},
    }),
  ]);
  if (hide && !showHiddenObjects) {
    ui.editor.select(const {});
    ui.hints.show(list.length == 1 ? ArrangeTexts.hiddenOne : ArrangeTexts.hiddenMany(list.length));
  }
}

/// IDs of all hidden objects.
List<String> hiddenIds(BoardUi ui) => [
  for (final o in ui.controller.state.objects.values)
    if (o.hidden) o.id,
];

/// „Alle einblenden“ (web `showAll`).
void showAllHidden(BoardUi ui) {
  final ids = hiddenIds(ui);
  if (ids.isEmpty || !ui.editor.editable) return;
  ui.controller.apply([
    UpdateOp({
      for (final id in ids) id: {'hidden': null},
    }),
  ]);
  ui.hints.show(ArrangeTexts.shown(ids.length));
}

// ---- format painter (D30) -----------------------------------------------------------------------------------------

/// The copied format (`tools.copyStyle` data, web module variable `copied`: lives across boards).
Map<String, Object?>? copiedStyle;

/// Per board screen: format painter and link target picking (web `painter`/`picking`).
class ArrangeModes {
  ArrangeModes._(this.ui);
  final BoardUi ui;

  static final _all = Expando<ArrangeModes>();
  static ArrangeModes of(BoardUi ui) => _all[ui] ??= ArrangeModes._(ui);

  /// Painter on: the object whose format is painted (null = off).
  final painter = ValueNotifier<String?>(null);

  /// Picking a link target: the objects that get the link (null = off).
  final picking = ValueNotifier<List<String>?>(null);

  /// „Format kopieren“ (`tools.copyStyle`): the server extracts the format (positive list per type) like the web.
  Future<void> copyStyle(String id) async {
    final d = await ui.controller.act('tools.copyStyle', {'id': id}, label: 'Format kopieren');
    final data = d.result?.data;
    if (data is Map) copiedStyle = Map<String, Object?>.from(data);
  }

  /// „Format einfügen“ on the selection (`tools.pasteStyle`).
  void pasteStyle() {
    final s = copiedStyle;
    if (s == null) return;
    ui.controller.act('tools.pasteStyle', {'ids': _ids(ui), 'style': s}, label: 'Format einfügen');
  }

  /// Painter on with the format of [from] (web `startPainter`): every tapped object gets it, until „Fertig“ or a tap
  /// on the empty board.
  void startPainter(String from) {
    stopPicking();
    painter.value = from;
    // the format is copied as well (web: `copied = painter`)
    copyStyle(from);
    ui.editor.select(const {});
    ui.editor.tapInterceptor = _painterTap;
  }

  void stopPainter() {
    if (painter.value == null) return;
    painter.value = null;
    if (ui.editor.tapInterceptor == _painterTap) ui.editor.tapInterceptor = null;
  }

  bool _painterTap(String? id, Offset world) {
    final from = painter.value;
    if (from == null) return false;
    if (id == null) {
      stopPainter();
      return true;
    }
    // the whole group like a tap
    final ids = ui.editor.groupOf(id).toList();
    final s = copiedStyle;
    ui.controller.act('tools.pasteStyle', {
      'ids': ids,
      if (s != null) 'style': s else 'from': from,
      'painter': true,
    }, label: 'Format übertragen');
    return true;
  }

  // ---- link to (D29) ----------------------------------------------------------------------------------------------

  /// „Ziel auf dem Board wählen“: the next tap picks the target (web `startPicking`).
  void startPicking([List<String>? ids]) {
    final src = [
      for (final id in ids ?? _ids(ui))
        if (ui.controller.state[id] case final o? when linkable(o) && !o.locked) id,
    ];
    if (src.isEmpty) return;
    stopPainter();
    picking.value = src;
    ui.editor.tapInterceptor = _pickTap;
  }

  void stopPicking() {
    if (picking.value == null) return;
    picking.value = null;
    if (ui.editor.tapInterceptor == _pickTap) ui.editor.tapInterceptor = null;
  }

  bool _pickTap(String? id, Offset world) {
    final src = picking.value;
    if (src == null) return false;
    stopPicking();
    final target = id == null ? null : ui.controller.state[id];
    if (target == null) return true;
    if (src.contains(target.id) && src.length == 1) {
      ui.hints.show(ArrangeTexts.linkSelf);
      return true;
    }
    setLink(ui, src, target.id);
    ui.editor.select(src.toSet());
    ui.hints.show(ArrangeTexts.linked(linkTargetName(target)));
    return true;
  }

  void dispose() {
    stopPainter();
    stopPicking();
    painter.dispose();
    picking.dispose();
  }
}

/// Types without „Link zu …“ (lines, strokes; web `NO_LINK`).
bool linkable(BoardObject o) => o.type != 'connector' && o.type != 'pen';

/// Name of a link target for list and hint (web `targetName`).
String linkTargetName(BoardObject o) {
  if (o.type == 'frame') {
    final t = o.title?.trim() ?? '';
    return t.isEmpty ? 'Rahmen' : t;
  }
  final t = o.displayText.trim().split('\n').first;
  if (t.isEmpty) return 'Objekt';
  return t.length > 30 ? '${t.substring(0, 29)}…' : t;
}

/// Sets (or with null removes) the link of [ids] (web `setLink`, one undo step; an object never links itself).
void setLink(BoardUi ui, List<String> ids, String? target) {
  final valid = [
    for (final id in ids)
      if (id != target) id,
  ];
  if (valid.isEmpty || !ui.editor.editable) return;
  ui.controller.apply([
    UpdateOp({
      for (final id in valid) id: {'linkTo': target},
    }),
  ]);
}

/// Goes to the target of [o] and selects it (web `followLink`); a missing target says so.
void followLink(BoardUi ui, BoardObject o) {
  final target = o.linkTo == null ? null : ui.controller.state[o.linkTo!];
  if (target == null || !isVisibleObject(target)) {
    ui.hints.show(ArrangeTexts.linkGone);
    return;
  }
  final r = objectRect(target);
  final size = ui.editor.viewSize;
  if (size != Size.zero) {
    final pad = math.max(40.0, math.max(r.width, r.height) * 0.15);
    ui.editor.camera.value = Camera.fit(
      r.inflate(pad),
      size,
      padding: const FitPadding.all(0),
      maxZoomFit: target.type == 'frame' ? 4 : 1.5,
    );
  }
  if (!ui.presenting.value) ui.editor.select({target.id});
}

// ---- tags (D31) ---------------------------------------------------------------------------------------------------

String _tagKey(String label) => label.trim().toLowerCase();

List<BoardTag> _tagsOf(BoardObject o) => [
  for (final t in o.tags)
    if (t.label.trim().isNotEmpty) t,
];

/// All tags of the board (notes and cards), one per name (the first color wins), alphabetical (web `boardTags`).
List<BoardTag> boardTags(Iterable<BoardObject> objects) {
  final seen = <String, BoardTag>{};
  for (final o in objects) {
    for (final t in _tagsOf(o)) {
      seen.putIfAbsent(_tagKey(t.label), () => BoardTag(t.label.trim(), t.color));
    }
  }
  return seen.values.toList()..sort((a, b) => _compareDe(a.label, b.label));
}

/// German order without case and accents (close to `localeCompare(…, 'de')`).
int _compareDe(String a, String b) {
  String f(String s) =>
      s.toLowerCase().replaceAll('ä', 'a').replaceAll('ö', 'o').replaceAll('ü', 'u').replaceAll('ß', 'ss');
  final c = f(a).compareTo(f(b));
  return c != 0 ? c : a.compareTo(b);
}

bool hasTag(BoardObject o, BoardTag tag) => _tagsOf(o).any((t) => _tagKey(t.label) == _tagKey(tag.label));

/// Patch switching [tag] on or off on [o] (web `toggleTag`); null = nothing to do (at most [tagMax]).
Map<String, Object?>? toggleTagPatch(BoardObject o, BoardTag tag, bool on) {
  final list = _tagsOf(o);
  final has = hasTag(o, tag);
  if (on == has) return null;
  Map<String, Object?> json(BoardTag t) => {'label': t.label, 'color': t.color};
  if (on) {
    if (list.length >= tagMax) return null;
    final label = tag.label.trim();
    return {
      'tags': [
        ...list.map(json),
        {'label': label.length > tagMaxLen ? label.substring(0, tagMaxLen) : label, 'color': tag.color},
      ],
    };
  }
  final rest = [
    for (final t in list)
      if (_tagKey(t.label) != _tagKey(tag.label)) json(t),
  ];
  return {'tags': rest.isEmpty ? null : rest};
}

/// Switches [tag] on or off on every unlocked selected object (one step).
void setTag(BoardUi ui, BoardTag tag, bool on) {
  final patches = <String, Map<String, Object?>>{
    for (final o in ui.editor.selected)
      if (!o.locked) o.id: ?toggleTagPatch(o, tag, on),
  };
  if (patches.isEmpty || !ui.editor.editable) return;
  ui.controller.apply([UpdateOp(patches)]);
}
