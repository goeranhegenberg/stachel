import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/painting.dart';

import '../mindmap/mind_editing.dart';
import '../model/board_object.dart';
import '../model/board_source.dart';
import '../model/rich_edit.dart';
import '../protocol/native_messages.dart';
import '../geometry/connector_route.dart';
import '../features/snapping/snapping.dart';
import '../render/board_scene.dart';
import '../web/web_constants.dart';
import 'camera.dart';
import 'editor_tools.dart';
import 'registry/registry.dart';
import 'transform.dart';

/// What a tap (or drag) on the board does. E3: connector (drag from an object or the board), pen (also highlighter,
/// [BoardEditorTools.penMarker]), eraser, frame, comment; `mindmap`: a new mind map there
/// ([BoardEditorMind.mindTemplate]); `feature`: a tool registered by a package ([BoardEditor.featureTool], its
/// `ToolDef.behavior` handles taps/drawing – F2 registry).
enum BoardTool { select, sticky, text, shape, connector, pen, eraser, frame, comment, mindmap, feature }

/// Tools after which the selection stays when switching to them (web C19: „außer Auswahl/Hand“).
const _keepsSelection = {BoardTool.select};

/// Tools that draw with one finger instead of panning (two fingers still zoom).
const drawingTools = {BoardTool.connector, BoardTool.pen, BoardTool.eraser};

/// Sticky note colors of the web (`STICKY_COLORS`, 12: the old seven first at their places, then Koralle, Mint,
/// Türkis, Mittelblau, Steingrau) – read from the web constants (`colors.sticky`), so the web stays the only source.
List<String> get stickyColors => _stickyColors ??= List.unmodifiable(WebConstants.instance.strings('colors.sticky'));
List<String>? _stickyColors;

/// Shape fills like the web (`SHAPE_FILLS`).
const shapeFills = ['#ffffff', '#000000', '#c9e14a', '#1763b5', '#ec4e92', '#fff27a', '#9fd3ff', '#ffb3d1', '#e9e9e4'];

/// Text colors like the web (`INK_COLORS`).
const inkColors = ['#0a0a0a', '#1763b5', '#ec4e92', '#7aa21b', '#e8590c', '#7048e8', '#8a8a85', '#ffffff'];

/// Basic shapes offered on the phone (the full library follows in E4).
const basicShapes = ['rect', 'roundrect', 'ellipse', 'triangle', 'diamond', 'star', 'arrowRight', 'cloud', 'callout'];

/// Types with editable text (rich text, contract §4).
const textTypes = {'sticky', 'text', 'shape'};

/// Types with plus handles on all four sides: an empty copy next to it, connected (web `addHandles`, D37).
const addHandleTypes = {'sticky', 'shape', 'card'};

/// Resize handles all around (web `ALL_HANDLES`).
const allHandles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/// Corner handles (web `CORNERS`).
const cornerHandles = ['nw', 'ne', 'se', 'sw'];

/// What a resize gives a type's hook (web `resize(o, base, ctx)`): the box before ([from]) and after ([to]) the
/// gesture, the object's new rect ([rect]) and whether only the width changes (side handle of a `sideResize: 'width'`
/// type).
class ResizeContext {
  const ResizeContext({required this.from, required this.to, required this.rect, this.widthOnly = false});
  final Rect from;
  final Rect to;
  final Rect rect;
  final bool widthOnly;
}

/// How a type resizes (web `ObjectTypeDef.handles`/`keepAspect`/`sideResize`/`resize`, D32). Packages replace the
/// entry of their type in [typeResize] (P9 timeline); a registered `TypeBehavior.handles` still wins for the handle
/// list and a registered `TypeBehavior.resize` for the patch (P3 card/table).
class TypeResize {
  const TypeResize({
    this.handles = allHandles,
    this.keepAspect = false,
    this.keepAspectCorners = false,
    this.widthOnlySides = false,
    this.resize,
  });

  /// Handles of a single selected object.
  final List<String> handles;

  /// Always keep the aspect ratio (web `keepAspect: true`).
  final bool keepAspect;

  /// Corners keep the ratio, sides are free (web `keepAspect: 'corner'`).
  final bool keepAspectCorners;

  /// Side handles change only the width (web `sideResize: 'width'`).
  final bool widthOnlySides;

  /// Patch from the rounded box [base] (null = [base] as it is).
  final Map<String, Object?> Function(BoardObject o, Map<String, Object?> base, ResizeContext ctx)? resize;
}

/// Resize behavior per type like the web's type registry (sticky with the shapes module: 8 handles, corners keep the
/// ratio; text: corners scale the font, sides fix the width; image/sticker/icon/PDF: corners keep the ratio; pen:
/// points scale; card: width only; connector: free ends follow a scaled selection). Unknown types: 8 free handles.
final typeResize = <String, TypeResize>{
  'sticky': const TypeResize(keepAspectCorners: true),
  'text': TypeResize(
    handles: const [...cornerHandles, 'e', 'w'],
    keepAspectCorners: true,
    widthOnlySides: true,
    resize: (o, base, ctx) => ctx.widthOnly
        ? {...base, 'autoWidth': null}
        : {...base, 'fontSize': math.max(6.0, round1((o.fontSize ?? 24) * (ctx.rect.height / o.h)))},
  ),
  'shape': const TypeResize(),
  'frame': const TypeResize(),
  'image': const TypeResize(handles: cornerHandles, keepAspect: true),
  'sticker': const TypeResize(handles: cornerHandles, keepAspect: true),
  'icon': const TypeResize(handles: cornerHandles, keepAspect: true),
  'document': const TypeResize(handles: cornerHandles, keepAspect: true),
  'pen': TypeResize(
    resize: (o, base, ctx) => o.points.isEmpty
        ? base
        : {...base, 'points': scalePoints(o.points, ctx.rect.width / o.w, ctx.rect.height / o.h)},
  ),
  'card': TypeResize(
    handles: const ['e', 'w'],
    widthOnlySides: true,
    resize: (o, base, ctx) =>
        ctx.widthOnly ? {...base, 'w': math.max(160.0, (base['w'] as num? ?? 280).toDouble())} : base,
  ),
  // the table's height follows its columns (P3's `TypeBehavior.resize` = `tableResize` wins in the editor)
  'table': const TypeResize(handles: ['e', 'w'], widthOnlySides: true),
  // the timeline's sides change its range (P9 registers its own resize)
  'timeline': const TypeResize(handles: [...cornerHandles, 'e', 'w'], keepAspectCorners: true),
  'mindnode': const TypeResize(handles: []),
  'connector': TypeResize(
    handles: const [],
    // a scaled selection: only the free ends move along
    resize: (o, base, ctx) {
      Map<String, Object?> mp(Map e) {
        final r = mapRect(
          Rect.fromLTWH((e['x'] as num).toDouble(), (e['y'] as num).toDouble(), 0, 0),
          ctx.from,
          ctx.to,
        );
        return {'x': jsRound(r.left), 'y': jsRound(r.top)};
      }

      bool free(Object? e) => e is Map && e['objectId'] == null && e['x'] is num && e['y'] is num;
      return {
        if (free(o.raw['from'])) 'from': mp(o.raw['from'] as Map),
        if (free(o.raw['to'])) 'to': mp(o.raw['to'] as Map),
      };
    },
  ),
};

/// Resize behavior of [type] (unknown: 8 free handles).
TypeResize resizeOf(String type) => typeResize[type] ?? const TypeResize();

/// Types whose rectangle must lie completely inside a selection rectangle (web `marquee: 'contain'`, D06).
const marqueeContainTypes = {'frame', 'connector', 'timeline'};

/// Types that are no snap target (web `snapTarget: false`).
const noSnapTargetTypes = {'pen', 'connector', 'mindnode'};

/// Distance of a sibling created by a plus handle (web `SIBLING_GAP`).
const siblingGap = 40.0;

/// Screen distance of plus and rotate handles from the object (web `ADD_GAP`).
const handleGap = 30.0;

/// Touch radius of handles (screen px).
const handleRadius = 22.0;

/// Smallest object size when resizing (world units).
const minObjectSize = 20.0;

/// Rotation snaps to multiples of 90° within this many degrees (web `ROTATE_SNAP_DEG`).
const rotateSnapDeg = 5.0;

/// Angle with snapping like the web's `snapAngle`: (−180, 180], multiples of 90° within ±5° snap.
({double deg, bool snapped}) snapAngle(double a) {
  var d = a % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  final right = (d / 90).round() * 90.0;
  if ((d - right).abs() <= rotateSnapDeg) {
    var r = right % 360;
    if (r > 180) r -= 360;
    return (deg: r == -180 ? 180 : r, snapped: true);
  }
  final r = (d * 10).round() / 10;
  return (deg: r == -180 ? 180 : r, snapped: false);
}

/// Handles of a single selected object, in screen space.
class BoardHandle {
  const BoardHandle(this.id, this.at);

  /// `nw`/`n`/`ne`/`e`/`se`/`s`/`sw`/`w` (resize), `rotate`, `add-n`/`add-e`/`add-s`/`add-w` (plus).
  final String id;
  final Offset at;
}

/// Unit direction of a handle side: x/y in {-1, 0, 1}.
(int, int) handleSigns(String h) =>
    (h.contains('w') ? -1 : (h.contains('e') ? 1 : 0), h.contains('n') ? -1 : (h.contains('s') ? 1 : 0));

/// New box when dragging resize handle [handle] of an object (x, y, w, h, rotation in degrees) to world point [p];
/// the opposite corner/side stays put. [keepAspect]: corners scale both sides alike.
Rect resizeBox(
  Rect box,
  double rotation,
  String handle,
  Offset p, {
  bool keepAspect = false,
  double min = minObjectSize,
}) {
  final (sx, sy) = handleSigns(handle);
  final a = rotation * math.pi / 180;
  final u = Offset(math.cos(a), math.sin(a)), v = Offset(-math.sin(a), math.cos(a));
  final c = box.center;
  final anchor = c + u * (-sx * box.width / 2) + v * (-sy * box.height / 2);
  final d = p - anchor;
  final dx = d.dx * u.dx + d.dy * u.dy, dy = d.dx * v.dx + d.dy * v.dy;
  var w = sx != 0 ? math.max(min, sx * dx) : box.width;
  var h = sy != 0 ? math.max(min, sy * dy) : box.height;
  if (keepAspect && sx != 0 && sy != 0) {
    final s = math.max(w / box.width, h / box.height);
    w = math.max(min, box.width * s);
    h = math.max(min, box.height * s);
  }
  final center = anchor + u * (sx * w / 2) + v * (sy * h / 2);
  return Rect.fromCenter(center: center, width: w, height: h);
}

/// Patches moving [objs] by whole units ([dx], [dy]) like the web's `movePatches`: connectors move with their free
/// ends (docked ends follow their objects); with [grid] („Am Raster einrasten“, web `gridMove`) every object but
/// connectors lands with its top left corner on the 24 grid.
Map<String, Map<String, Object?>> movePatches(Iterable<BoardObject> objs, double dx, double dy, {bool grid = false}) {
  Object? freeEnd(Object? e) => e is Map && e['objectId'] == null && e['x'] is num && e['y'] is num
      ? {'x': (e['x'] as num) + dx, 'y': (e['y'] as num) + dy}
      : null;
  final out = <String, Map<String, Object?>>{};
  for (final o in objs) {
    if (o.type == 'connector') {
      out[o.id] = {'x': o.x + dx, 'y': o.y + dy, 'from': ?freeEnd(o.raw['from']), 'to': ?freeEnd(o.raw['to'])};
    } else {
      final x = o.x + dx, y = o.y + dy;
      out[o.id] = grid ? {'x': snapToGrid(x), 'y': snapToGrid(y)} : {'x': x, 'y': y};
    }
  }
  return out;
}

/// Editing logic of the board (E2): tools, selection (groups as a whole), creating, moving, resizing, rotating,
/// deleting, duplicating, layers, format, text editing – everything goes out as ops through [controller]
/// (optimistic, contract §8.6). Gestures come from the view ([BoardView]); the app shows tool bar and context bar.
class BoardEditor extends ChangeNotifier with BoardEditorTools, BoardEditorMind {
  BoardEditor({
    required this.controller,
    required this.scene,
    required this.camera,
    ValueNotifier<Set<String>>? selection,
  }) : selection = selection ?? ValueNotifier(const {}),
       _ownSelection = selection == null;

  final bool _ownSelection;

  @override
  final BoardController controller;
  @override
  final BoardScene scene;
  @override
  final CameraController camera;
  @override
  final ValueNotifier<Set<String>> selection;

  /// Haptic feedback (grab, snap) – the view plugs in the platform's.
  @override
  VoidCallback? onHaptic;

  /// A short hint for the user (the board UI shows it as a snackbar; `BoardUi` plugs in its hint service).
  void Function(String text)? onNotice;

  /// Double tap on an object whose text is not written in place (connector label, frame title – type behavior `edit`
  /// `label`/`title`): the app opens its input for it. Null = double tap does nothing there.
  void Function(BoardObject o)? onEditField;

  /// Registers of the board UI (F2): type behavior (taps, handles), feature tools. Set by `BoardUi`.
  BoardRegistry? registry;

  BoardTool _tool = BoardTool.select;
  BoardTool get tool => _tool;

  /// Switching to another tool drops the selection (web C19), except to Auswahl.
  set tool(BoardTool t) {
    if (t == _tool) return;
    _tool = t;
    if (t != BoardTool.feature) _featureTool = null;
    if (!_keepsSelection.contains(t)) {
      _multiSelect = false;
      if (selection.value.isNotEmpty) selection.value = const {};
    }
    notifyListeners();
  }

  String? _featureTool;

  /// Id of the active registered feature tool (`ToolDef.id`) while [tool] is [BoardTool.feature].
  String? get featureTool => _tool == BoardTool.feature ? _featureTool : null;

  /// Id of the active tool as the registry names it: the enum name for core tools, else the feature tool's id.
  String get activeToolId => _tool == BoardTool.feature ? (_featureTool ?? 'select') : _tool.name;

  /// Activates the tool [id]: a core tool by its enum name (`sticky`, `pen` …), any other id as feature tool.
  void useTool(String id) {
    // a registered tool with own behavior wins over the core tool of the same name (P2: text, shape; P4: frame tool
    // with formats)
    final own = registry?.tools[id]?.behavior != null;
    final core = own ? null : BoardTool.values.where((t) => t.name == id && t != BoardTool.feature).firstOrNull;
    if (core != null) {
      tool = core;
      return;
    }
    if (_tool == BoardTool.feature && _featureTool == id) return;
    tool = BoardTool.select; // leave a core tool cleanly first
    _featureTool = id;
    tool = BoardTool.feature;
  }

  /// Shape for the shape tool (last used first, like the web's tool option).
  String shapeKind = 'rect';
  final recentShapes = <String>['rect'];

  /// Color for new sticky notes (last used).
  String stickyColor = stickyColors.first;

  @override
  bool get editable => controller.canEdit;

  List<BoardObject> get selected => [for (final id in selection.value) ?controller.state[id]];

  /// The one selected object (null for none or several).
  BoardObject? get single {
    final s = selected;
    return s.length == 1 ? s.single : null;
  }

  // ---- selection --------------------------------------------------------------------------------------------------

  bool _multiSelect = false;

  /// „Mehrfachauswahl“ (phone instead of Umschalt-Klick, D02): tapping an object adds its group to the selection or
  /// takes it out.
  bool get multiSelect => _multiSelect;

  /// Listeners rebuild (context bar …) after a package's local state changed – P9's active timeline item (web:
  /// „Auswahl neu setzen (gleicher Inhalt)“ so the context bar measures its entries again).
  void refresh() => notifyListeners();

  set multiSelect(bool v) {
    if (v == _multiSelect) return;
    _multiSelect = v;
    notifyListeners();
  }

  /// Adds the group of [id] to the selection, or takes it out if it is in already (web Umschalt-Klick, D02).
  void toggleInSelection(String id) {
    final g = groupOf(id);
    final cur = selection.value;
    select(cur.containsAll(g) ? cur.difference(g) : {...cur, ...g});
  }

  /// The selection is exactly one whole group (web `isWholeGroup`).
  bool get isWholeGroup {
    final s = selected;
    if (s.length < 2) return false;
    final g = s.first.groupId;
    return g != null && s.every((o) => o.groupId == g) && groupOf(s.first.id).length == s.length;
  }

  /// Units for arranging (web `arrangeUnits`): groups together, else single objects; without connectors and locked
  /// ones. Key = `g:<groupId>` or the object ID.
  Map<String, List<BoardObject>> units() {
    final u = <String, List<BoardObject>>{};
    for (final o in selected) {
      if (o.type == 'connector' || o.locked) continue;
      (u[o.groupId == null ? o.id : 'g:${o.groupId}'] ??= []).add(o);
    }
    return u;
  }

  /// IDs selected together with [id] (its group).
  Set<String> groupOf(String id) {
    final o = controller.state[id];
    final g = o?.groupId;
    if (g == null) return {id};
    return {
      for (final x in controller.state.objects.values)
        if (x.groupId == g) x.id,
    };
  }

  @override
  void select(Set<String> ids) {
    if (setEquals(ids, selection.value)) return;
    selection.value = Set.unmodifiable(ids);
    notifyListeners();
  }

  /// Drops selected IDs that are gone (after patches).
  void prune() {
    final s = selection.value;
    final keep = {
      for (final id in s)
        if (controller.state[id] != null) id,
    };
    if (keep.length != s.length) select(keep);
    final e = _editing;
    if (e != null && controller.state[e] == null) _closeEditing(send: false);
  }

  // ---- text editing -----------------------------------------------------------------------------------------------

  String? _editing;
  RichEditDoc? _doc;
  Map<String, Object?>? _baseDoc;
  int _baseRev = 0;
  String _baseEpoch = '';
  Timer? _textTimer;
  bool _dirty = false;

  /// Object whose text is being edited.
  @override
  String? get editingId => _editing;

  /// The edited rich text (null when not editing).
  RichEditDoc? get editingDoc => _doc;

  /// Bumped when the edited text is replaced from outside (merged server state): the text field takes it over.
  int docVersion = 0;

  /// Debounce of text ops while typing (concept §4.6).
  Duration textDebounce = const Duration(milliseconds: 300);

  /// Who else writes in [id] right now ('' = nobody): the first name, with [fullName] the whole name (web
  /// `RemoteHint` „Wird gerade auch von Mara Muster bearbeitet“; without a name „jemand anderem“ like the web).
  String writerOf(String id, {bool fullName = false}) {
    for (final p in controller.peers) {
      if (p.editing != id || p.key == controller.user?.key) continue;
      if (fullName) return p.name.trim().isEmpty ? 'jemand anderem' : p.name;
      return p.name.split(' ').first;
    }
    return '';
  }

  /// Starts editing the text of [id] (sticky, text, shape; mind node as plain text); false if not possible (locked,
  /// read only). Someone else writing there does not block (web: both type at once, the server merges; the edit bar
  /// shows „Wird gerade auch von … bearbeitet“).
  @override
  bool startEditing(String id) {
    if (_editing == id) return true;
    final o = controller.state[id];
    if (o == null || !(textTypes.contains(o.type) || o.type == 'mindnode') || o.locked || !editable) return false;
    if (_editing != null) stopEditing();
    _editing = id;
    // mind nodes are plain text (web `Editable`): no rich text
    _doc = RichEditDoc.forObject(o.type == 'mindnode' ? null : o.raw['content'], o.text);
    _baseDoc = _doc!.toJson();
    _baseRev = controller.confirmed.rev;
    _baseEpoch = controller.confirmed.epoch;
    _dirty = false;
    docVersion++;
    select({id});
    controller.presence.editing = id;
    notifyListeners();
    return true;
  }

  /// The text field changed [text] (caret at [caret]).
  void textChanged(String text, {int? caret}) {
    final d = _doc;
    if (d == null || !d.setText(text, caret: caret)) return;
    if (controller.state[_editing!]?.type == 'mindnode') {
      // plain text with the layout at once (the node grows while typing, like the web)
      mindText(_editing!, d.text);
      notifyListeners();
      return;
    }
    _dirty = true;
    _textTimer?.cancel();
    _textTimer = Timer(textDebounce, _sendText);
    notifyListeners();
  }

  void _sendText() {
    _textTimer?.cancel();
    _textTimer = null;
    final id = _editing, d = _doc;
    if (id == null || d == null || !_dirty) return;
    _dirty = false;
    final doc = d.toJson();
    if (controller.features.contains('text')) {
      controller.apply([TextOp(id, _baseRev, doc, epoch: _baseEpoch, baseDoc: _baseDoc)], step: false);
    } else {
      // older server without the text op: replace the rich text as a whole
      controller.apply([
        UpdateOp({
          id: {'content': doc, 'text': pmPlainText(doc)},
        }),
      ], step: false);
    }
    // the next op builds on what was just sent; the server merges concurrent edits of others
    _baseDoc = doc;
  }

  /// Selection in the open text field (offsets in [RichEditDoc.text]); the format bar works on it.
  ({int start, int end}) get textRange => _textRange;
  set textRange(({int start, int end}) r) {
    if (r == _textRange) return;
    _textRange = r;
    // the format bar shows what the selection has; later, the field may set it while building
    if (_rangeNotify) return;
    _rangeNotify = true;
    scheduleMicrotask(() {
      _rangeNotify = false;
      if (!_gone) notifyListeners();
    });
  }

  bool _rangeNotify = false;
  bool _gone = false;

  ({int start, int end}) _textRange = (start: 0, end: 0);

  /// Formats the selected text (empty selection: the whole text, like the web's format bar) with [change] on the
  /// edited document; goes out like typing (debounced `text` op). Returns false if nothing changed.
  bool formatText(bool Function(RichEditDoc doc, int from, int to) change) {
    final d = _doc;
    if (d == null || _editing == null) return false;
    final len = d.text.length;
    final a = textRange.start.clamp(0, len), b = textRange.end.clamp(0, len);
    if (!change(d, a, b)) return false;
    _dirty = true;
    docVersion++;
    _textTimer?.cancel();
    _textTimer = Timer(textDebounce, _sendText);
    notifyListeners();
    return true;
  }

  /// The confirmed text of the edited object changed (merged result, someone else): take it over when nothing of
  /// our own is on the way. Returns the new text (null = keep the field as it is).
  bool adoptRemoteText() {
    final id = _editing, d = _doc;
    if (id == null || d == null || _dirty || controller.hasPending(id, textOnly: true)) return false;
    final o = controller.confirmed[id];
    if (o == null) return false;
    final server = effectivePmDoc(o.raw['content'], o.text);
    if (canonicalJson(server) == canonicalJson(d.toJson())) return false;
    _doc = RichEditDoc(server);
    _baseDoc = _doc!.toJson();
    _baseRev = controller.confirmed.rev;
    _baseEpoch = controller.confirmed.epoch;
    docVersion++;
    notifyListeners();
    return true;
  }

  /// Ends editing: sends the last text, closes the undo step; an empty text object goes away (like the web).
  /// [measured]: size of the text as laid out (text objects follow their content).
  @override
  void stopEditing({Size? measured}) => _closeEditing(send: true, measured: measured);

  void _closeEditing({required bool send, Size? measured}) {
    final id = _editing;
    if (id == null) return;
    if (send) _sendText();
    _textTimer?.cancel();
    _textTimer = null;
    _editing = null;
    _doc = null;
    _baseDoc = null;
    controller.presence.editing = null;
    final o = controller.state[id];
    if (send && o != null) {
      if (o.type == 'mindnode') {
        mindEditDone(id);
      } else if (o.type == 'text' && o.text.trim().isEmpty) {
        controller.apply([
          RemoveOp([id]),
        ]);
        select(const {});
      } else if (o.type == 'text' && measured != null) {
        final patch = <String, Object?>{
          if (o.autoWidth && (measured.width - o.w).abs() > 1) 'w': measured.width.ceilToDouble(),
          if ((measured.height - o.h).abs() > 1) 'h': measured.height.ceilToDouble(),
        };
        controller.apply([
          if (patch.isNotEmpty) UpdateOp({id: patch}),
        ]);
        if (patch.isEmpty) controller.closeStep();
      } else {
        controller.closeStep();
      }
    }
    notifyListeners();
  }

  // ---- creating ---------------------------------------------------------------------------------------------------

  /// Creates an object of [type] centered at world point [p] (like the web's `create`), selects it and starts
  /// editing notes and texts. Returns its ID.
  String? create(String type, Offset p, {String? shape}) {
    if (!editable) return null;
    final id = BoardController.newId();
    // a package may define the new object (registry `creates`, web `ObjectTypeDef.create`)
    final Map<String, Object?> o =
        registry?.creates[type]?.call(this, p, shape) ??
        switch (type) {
          'sticky' => {
            'type': 'sticky',
            'x': (p.dx - 100).roundToDouble(),
            'y': (p.dy - 100).roundToDouble(),
            'w': 200,
            'h': 200,
            'color': stickyColor,
            'text': '',
          },
          'text' => {
            'type': 'text',
            'x': (p.dx - 8).roundToDouble(),
            'y': (p.dy - 18).roundToDouble(),
            'w': 120,
            'h': 36,
            'fontSize': 28,
            'text': '',
            'color': '#0a0a0a',
            'autoWidth': true,
          },
          _ => {
            'type': 'shape',
            'shape': shape ?? shapeKind,
            'x': (p.dx - 90).roundToDouble(),
            'y': (p.dy - 60).roundToDouble(),
            'w': 180,
            'h': 120,
            'color': '#ffffff',
            'stroke': '#0a0a0a',
            'strokeWidth': 2,
            'text': '',
            'fontSize': 20,
          },
        };
    controller.apply([
      CreateOp([
        {'id': id, ...o},
      ]),
    ]);
    if (type == 'shape') {
      final k = shape ?? shapeKind;
      recentShapes
        ..remove(k)
        ..insert(0, k);
      if (recentShapes.length > 4) recentShapes.removeLast();
    }
    tool = BoardTool.select;
    select({id});
    if (type != 'shape') startEditing(id);
    return id;
  }

  /// Empty copy of [o] next to it at [side] (`n`/`e`/`s`/`w`), connected by an arrow (plus handle, web
  /// `createSibling`). Returns the new ID.
  String? createSibling(BoardObject o, String side) {
    if (!editable) return null;
    final (dx, dy) = handleSigns(side);
    var at = Offset(o.x + dx * (o.w + siblingGap), o.y + dy * (o.h + siblingGap));
    for (var i = 1; i <= 50; i++) {
      final r = Rect.fromLTWH(
        o.x + dx * i * (o.w + siblingGap),
        o.y + dy * i * (o.h + siblingGap),
        o.w,
        o.h,
      ).deflate(2);
      final taken = scene.grid.query(r).any((id) {
        final q = controller.state[id];
        return q != null && q.id != o.id && q.type != 'connector' && q.type != 'frame' && objectRect(q).overlaps(r);
      });
      if (!taken) {
        at = r.inflate(2).topLeft;
        break;
      }
    }
    final id = BoardController.newId();
    final copy = _emptyCopy(o, id, at);
    const opposite = {'n': 's', 's': 'n', 'e': 'w', 'w': 'e'};
    final a = Rect.fromLTWH(o.x, o.y, o.w, o.h).center, b = Rect.fromLTWH(at.dx, at.dy, o.w, o.h).center;
    controller.apply([
      CreateOp([
        copy,
        {
          'id': BoardController.newId(),
          'type': 'connector',
          'x': math.min(a.dx, b.dx),
          'y': math.min(a.dy, b.dy),
          'w': math.max(1, (a.dx - b.dx).abs()),
          'h': math.max(1, (a.dy - b.dy).abs()),
          'from': {'objectId': o.id, 'side': side},
          'to': {'objectId': id, 'side': opposite[side]},
          'color': '#0a0a0a',
          'strokeWidth': 2,
          'arrowEnd': true,
          'lineStyle': 'curved',
        },
      ]),
    ]);
    select({id});
    if (textTypes.contains(o.type)) editAfterCreate = id;
    return id;
  }

  /// Empty copy of [o] (same look, no text/tags/group) with [id] at [topLeft].
  static Map<String, Object?> _emptyCopy(BoardObject o, String id, Offset topLeft) => <String, Object?>{...o.raw}
    ..remove('z')
    ..remove('createdBy')
    ..remove('updatedAt')
    ..remove('content')
    ..remove('locked')
    ..remove('groupId')
    ..remove('tags')
    ..['id'] = id
    ..['text'] = ''
    ..['x'] = topLeft.dx.roundToDouble()
    ..['y'] = topLeft.dy.roundToDouble();

  /// Plus handle dropped on the empty board at [at]: the same shape there (centered), connected from [from].
  String? _siblingAt(BoardObject o, EndDrop from, Offset at) {
    if (!editable) return null;
    final id = BoardController.newId();
    final copy = _emptyCopy(o, id, Offset(at.dx - o.w / 2, at.dy - o.h / 2));
    // web: the copy's side facing the source's center (same as the drag preview)
    final side = nearestSide(BoardObject(copy), Offset(o.x + o.w / 2, o.y + o.h / 2));
    controller.apply([
      CreateOp([
        copy,
        {
          'id': BoardController.newId(),
          'type': 'connector',
          ...boxOf(from.point, at),
          'from': from.toJson(),
          'to': {'objectId': id, 'side': side},
          'color': '#0a0a0a',
          'strokeWidth': 2,
          // web `connectorFields`: the tool's cap at the end
          for (final e in capPatch('end', connectorCap).entries)
            if (e.value != null) e.key: e.value,
          // web `newLineStyle`: the tool's, else curved; straight = no field
          if ((connectorStyle ?? 'curved') != 'straight') 'lineStyle': connectorStyle ?? 'curved',
        },
      ]),
    ]);
    select({id});
    if (textTypes.contains(o.type)) editAfterCreate = id;
    return id;
  }

  /// A plus handle made a new copy to write in (web: `startEditing` right away); the view takes it after the gesture.
  String? editAfterCreate;

  // ---- moving -----------------------------------------------------------------------------------------------------

  Map<String, BoardObject>? _dragOrigin;
  Offset _dragFrom = Offset.zero;
  String _dragKey = '';
  String? _dragGrab;
  Map<String, Map<String, Object?>> _lastPatch = const {};
  Rect? _dragBox;
  List<Rect> _snapOthers = const [];

  /// Size of the board view (screen px): snap targets are the objects in view (set by the view).
  Size viewSize = Size.zero;

  /// Guides while moving or resizing (pink lines, gap marks; web `Draft` 'guides') – the snapping overlay draws them.
  final guides = ValueNotifier<SnapGuides>(const SnapGuides());

  /// The angle while rotating (label, web D35); null = not rotating.
  final rotating = ValueNotifier<({double deg, bool snapped})?>(null);

  /// Objects to move (web `movableSet`): the selection without locked ones plus what lies completely inside selected
  /// frames (not locked, no connectors/frames).
  Map<String, BoardObject> movableObjects(Iterable<String> ids) {
    final out = <String, BoardObject>{};
    for (final id in ids) {
      final o = controller.state[id];
      if (o == null || o.locked) continue;
      out[id] = o;
      if (o.type == 'frame') {
        for (final c in frameContents(o, controller.state.objects.values)) {
          out.putIfAbsent(c.id, () => c);
        }
      }
    }
    return out;
  }

  /// Snap targets (web `snapCandidates`): objects in view (plus 200 screen px) that are not moved, without pen strokes
  /// and connectors – taken once per gesture.
  List<Rect> snapCandidates(Set<String> exclude) {
    final cam = camera.value;
    final size = viewSize == Size.zero ? const Size(4000, 4000) : viewSize;
    final view = cam.viewRect(size).inflate(200 / cam.z);
    return [
      for (final id in scene.grid.query(view))
        if (!exclude.contains(id))
          if (controller.state[id] case final o? when !noSnapTargetTypes.contains(o.type))
            if (objectRect(o) case final r when r.overlaps(view)) r,
    ];
  }

  /// Starts moving the selection (or [grab], selected first) from world point [p].
  void dragStart(Offset p, {String? grab}) {
    if (!editable) return;
    if (grab != null && !selection.value.contains(grab)) select(groupOf(grab));
    final origin = movableObjects(selection.value);
    if (origin.isEmpty) return;
    _dragOrigin = origin;
    _dragGrab = grab;
    _dragFrom = p;
    _dragKey = 'drag${BoardController.nextReq()}';
    _lastPatch = const {};
    Rect? box;
    for (final o in origin.values) {
      if (o.type == 'connector') continue;
      final r = objectRect(o);
      box = box == null ? r : box.expandToInclude(r);
    }
    _dragBox = box;
    _snapOthers = snapCandidates(origin.keys.toSet());
  }

  /// Moves the selection to world point [p] (web `applyMove`): edges/centers and equal gaps snap within 6 screen px
  /// (guides), whole world units, „Am Raster einrasten“ puts each object's corner on the 24 grid.
  void dragUpdate(Offset p, {bool end = false}) {
    final origin = _dragOrigin;
    if (origin == null) return;
    var dx = p.dx - _dragFrom.dx, dy = p.dy - _dragFrom.dy;
    final box = _dragBox;
    if (snapOff) guides.value = const SnapGuides();
    if (box != null && !snapOff) {
      final s = snapMove(box.shift(Offset(dx, dy)), _snapOthers, snapPx / camera.value.z);
      dx += s.dx;
      dy += s.dy;
      guides.value = SnapGuides(lines: s.lines, gaps: s.gaps);
    }
    final patches = movePatches(origin.values, jsRound(dx), jsRound(dy), grid: SnapPrefs.gridOn);
    if (patches.isEmpty) return;
    _lastPatch = patches;
    controller.apply(
      mindDragOps(patches, end: end) ?? [UpdateOp(patches)],
      step: end,
      coalesce: _dragKey,
    );
  }

  void dragEnd() {
    final origin = _dragOrigin;
    if (origin == null) return;
    if (_lastPatch.isNotEmpty) {
      // mind nodes: dropped on another node → hung in there, else sorted in (one step with the move)
      controller.apply(mindDragOps(_lastPatch, end: true) ?? [UpdateOp(_lastPatch)], coalesce: _dragKey);
      // packages after the drop (web `ObjectTypeDef.afterMove`: note on note → stack)
      for (final f in registry?.afterMoves ?? const <AfterMove>[]) {
        f(this, origin.keys.toList(), _dragGrab);
      }
    }
    _dragGrab = null;
    _dragOrigin = null;
    _dragBox = null;
    _snapOthers = const [];
    _lastPatch = const {};
    guides.value = const SnapGuides();
  }

  bool get dragging => _dragOrigin != null;

  /// Alt is held while moving (web „Alt beim Ziehen: Einrasten aus“): no guides, no snapping to other objects.
  bool snapOff = false;

  /// A handle (resize, rotate, connector end …) is being dragged.
  bool get handling => _handle != null;

  // ---- handles ----------------------------------------------------------------------------------------------------

  /// Box of the objects [ids] in world units (connectors from their route; web `selectionBounds`).
  Rect? selectionBounds(Iterable<String> ids) {
    Rect? box;
    for (final id in ids) {
      final o = controller.state[id];
      if (o == null) continue;
      final r = (o.type == 'connector' ? scene.grid.rectOf(id) : null) ?? objectRect(o);
      box = box == null ? r : box.expandToInclude(r);
    }
    return box;
  }

  /// Handles in screen space: of the single selected object (by type, rotated with it), or the corners and – if all
  /// can turn – the rotate handle of a multi-selection (D33, D36). None while editing text or read only.
  List<BoardHandle> handles() {
    if (!editable || _editing != null) return const [];
    final sel = selected;
    if (sel.length > 1) {
      final box = selectionBounds(sel.map((o) => o.id));
      if (box == null || sel.every((o) => o.locked)) return const [];
      final r = camera.value.rectToScreen(box);
      return [
        for (final h in cornerHandles)
          BoardHandle(h, Offset(handleSigns(h).$1 < 0 ? r.left : r.right, handleSigns(h).$2 < 0 ? r.top : r.bottom)),
        if (canRotateAll(sel)) BoardHandle('rotate', Offset(r.center.dx, r.top - handleGap - 4)),
      ];
    }
    final o = single;
    // mind nodes: no size handles (the layout sizes them), their buttons come from [mindButtons]
    if (o == null || o.locked || o.type == 'mindnode') return const [];
    final cam = camera.value;
    final own = registry?.typeOf(o.type)?.handles;
    if (o.type == 'connector') {
      // E3: both ends can be dragged to another object/anchor or into the free board
      final g = scene.connector(o.id);
      if (g == null) return const [];
      return [
        BoardHandle('end-from', cam.toScreen(g.a)),
        BoardHandle('end-to', cam.toScreen(g.b)),
        // web: the label of the selected connector can be dragged along the line (G05)
        if (o.displayText.trim().isNotEmpty) BoardHandle('label', cam.toScreen(g.pointAt(o.labelPos))),
      ];
    }
    final a = o.rotation * math.pi / 180;
    final c = cam.toScreen(Offset(o.x + o.w / 2, o.y + o.h / 2));
    final hw = o.w * cam.z / 2, hh = o.h * cam.z / 2;
    final u = Offset(math.cos(a), math.sin(a)), v = Offset(-math.sin(a), math.cos(a));
    Offset at(double sx, double sy, [double out = 0]) =>
        c + u * (sx * (hw + (sx == 0 ? 0 : out))) + v * (sy * (hh + (sy == 0 ? 0 : out)));
    Offset side(String s, double out) => at(handleSigns(s).$1.toDouble(), handleSigns(s).$2.toDouble(), out);
    if (own != null) {
      // a type with own handles (registry): resize ids around the box, `rotate` above, `add-*`/`anchor-*` outside
      return [
        for (final h in own(o))
          if (h == 'rotate')
            BoardHandle(h, at(0, -1, handleGap + 4))
          else if (h.startsWith('add-'))
            BoardHandle(h, side(h.substring(4), handleGap))
          else if (h.startsWith('anchor-'))
            BoardHandle(h, side(h.substring(7), handleGap - 8))
          else
            BoardHandle(h, side(h, 0)),
      ];
    }
    return [
      for (final h in resizeOf(o.type).handles) BoardHandle(h, side(h, 0)),
      if (rotatableTypes.contains(o.type)) BoardHandle('rotate', at(0, -1, handleGap + 4)),
      // plus on all four sides (web D37); the top one sits beside the rotate handle's line
      if (addHandleTypes.contains(o.type))
        for (final s in const ['n', 'e', 's', 'w']) BoardHandle('add-$s', side(s, handleGap)),
      // E3: anchor points (connector from here) on everything else that docks, except frames
      if (!addHandleTypes.contains(o.type) && connectable(o) && o.type != 'frame')
        for (final s in const ['e', 's', 'w']) BoardHandle('anchor-$s', side(s, handleGap - 8)),
    ];
  }

  /// Handle at screen point [p] (null = none).
  String? handleAt(Offset p) {
    String? best;
    var bestD = handleRadius;
    for (final h in handles()) {
      final d = (h.at - p).distance;
      if (d <= bestD) {
        bestD = d;
        best = h.id;
      }
    }
    return best;
  }

  String? _handle;
  BoardObject? _handleObject;
  Offset _handleDown = Offset.zero;
  Offset _handleWorld = Offset.zero;
  bool _snapped = false;
  String _handleKey = '';
  Map<String, Map<String, Object?>>? _handlePatch;
  bool _handleMoved = false;

  /// Resize/rotate gesture: objects at the start, box, rotation, aspect, width only, snap targets.
  Map<String, BoardObject> _tfOrigin = const {};
  Rect _tfBox = Rect.zero;
  double _tfRot = 0;
  bool _tfKeep = false;
  bool _tfWidthOnly = false;
  Offset _tfCenter = Offset.zero;
  double _tfA0 = 0;
  bool _tfMulti = false;

  static double _deg(Offset p, Offset c) => math.atan2(p.dy - c.dy, p.dx - c.dx) * 180 / math.pi;

  void handleStart(String handle, Offset screen) {
    _handle = handle;
    _handleObject = single;
    _handleDown = screen;
    _handleWorld = camera.value.toWorld(screen);
    _snapped = false;
    _handlePatch = null;
    _handleKey = 'handle${BoardController.nextReq()}';
    _handleMoved = false;
    final sel = selected;
    _tfMulti = sel.length > 1;
    _tfOrigin = const {};
    if (handle == 'rotate') {
      if (_tfMulti) {
        // several objects: around the center of the selection box (web)
        _tfOrigin = {for (final o in sel) o.id: o};
        _tfBox = selectionBounds(_tfOrigin.keys) ?? Rect.zero;
        _tfCenter = _tfBox.center;
        _tfRot = 0;
      } else {
        final o = single;
        if (o == null) return;
        _tfOrigin = {o.id: o};
        _tfCenter = Offset(o.x + o.w / 2, o.y + o.h / 2);
        _tfRot = o.rotation;
      }
      _tfA0 = _deg(_handleWorld, _tfCenter);
      _snapped = _tfRot % 90 == 0;
      rotating.value = (deg: _tfRot, snapped: _snapped);
      return;
    }
    if (!allHandles.contains(handle)) return;
    final origin = {
      for (final o in sel)
        if (!o.locked) o.id: o,
    };
    final only = origin.length == 1 ? origin.values.single : null;
    _tfOrigin = origin;
    _tfRot = only != null && sel.length == 1 ? only.rotation : 0;
    // rotated single object: compute in its unrotated box (the object's axes)
    _tfBox = _tfRot != 0
        ? Rect.fromLTWH(only!.x, only.y, only.w, only.h)
        : (selectionBounds(sel.map((o) => o.id)) ?? Rect.zero);
    final def = only == null ? null : resizeOf(only.type);
    final corner = handle.length == 2;
    _tfKeep = origin.length > 1 || def?.keepAspect == true || (def?.keepAspectCorners == true && corner);
    _tfWidthOnly = def?.widthOnlySides == true && !corner;
    _snapOthers = snapCandidates(origin.keys.toSet());
  }

  void handleUpdate(Offset screen) {
    final h = _handle, o = _handleObject;
    if (h == null || h.startsWith('mind-')) return;
    // E3: plus/anchor handle dragged = connector from that side; connector end = dock it elsewhere
    if (o != null && (h.startsWith('add-') || h.startsWith('anchor-'))) {
      if (!_handleMoved && (screen - _handleDown).distance < 18) return;
      if (!_handleMoved) {
        connectorDragStart(
          camera.value.toWorld(_handleDown),
          from: o,
          side: h.substring(h.indexOf('-') + 1),
          viaPlus: h.startsWith('add-'),
        );
      }
      _handleMoved = true;
      connectorDragUpdate(camera.value.toWorld(screen));
      return;
    }
    if (o != null && h.startsWith('end-')) {
      _handleMoved = true;
      connectorEndDrag(controller.state[o.id] ?? o, h.substring(4), camera.value.toWorld(screen));
      return;
    }
    if (o != null && h == 'label') {
      // web `startLabelDrag`: from 3 px on, labelPos = nearest point of the path (one undo step for the drag)
      if (!_handleMoved && (screen - _handleDown).distance < 3) return;
      _handleMoved = true;
      final g = scene.connector(o.id);
      if (g == null || !editable || o.locked) return;
      controller.apply(
        [
          UpdateOp({
            o.id: {'labelPos': projectOnPath(g, camera.value.toWorld(screen))},
          }),
        ],
        step: false,
        coalesce: _handleKey,
      );
      return;
    }
    if (_tfOrigin.isEmpty) return;
    final p = camera.value.toWorld(screen);
    final patches = <String, Map<String, Object?>>{};
    if (h == 'rotate') {
      // magnetic at 0°/90°/180°/270° (web `snapAngle`), label + haptic when it snaps
      final s = snapAngle(_tfRot + _deg(p, _tfCenter) - _tfA0);
      if (s.snapped && !_snapped) onHaptic?.call();
      _snapped = s.snapped;
      rotating.value = (deg: s.deg, snapped: s.snapped);
      if (_tfMulti) {
        patches.addAll(rotateMany(_tfOrigin, _tfCenter, s.deg));
      } else {
        patches[_tfOrigin.keys.single] = {'rotation': rotationField(s.deg)};
      }
    } else if (allHandles.contains(h)) {
      var dx = p.dx - _handleWorld.dx, dy = p.dy - _handleWorld.dy;
      Rect nb;
      if (_tfRot != 0) {
        // rotated (as in common whiteboards): the drag in the object's axes, the opposite corner stays in the world
        nb = rotatedResize(_tfBox, h, dx, dy, _tfRot, _tfKeep, widthOnly: _tfWidthOnly);
        guides.value = const SnapGuides();
      } else {
        nb = resizeRect(_tfBox, h, dx, dy, keepAspect: _tfKeep, min: 12);
        // only the dragged edges snap (D15)
        final s = snapResize(nb, h, _snapOthers, snapPx / camera.value.z);
        if (s.dx != 0 || s.dy != 0) {
          dx += s.dx;
          dy += s.dy;
          nb = resizeRect(_tfBox, h, dx, dy, keepAspect: _tfKeep, min: 12);
        }
        guides.value = SnapGuides(lines: guideLines(nb, _snapOthers));
      }
      for (final o in _tfOrigin.values) {
        final r = _tfRot != 0
            ? nb
            : _tfWidthOnly
            ? Rect.fromLTWH(nb.left, o.y, nb.width, o.h)
            : mapRect(Rect.fromLTWH(o.x, o.y, o.w, o.h), _tfBox, nb);
        final base = <String, Object?>{
          'x': jsRound(r.left),
          'y': jsRound(r.top),
          'w': math.max(8.0, jsRound(r.width)),
          'h': math.max(8.0, jsRound(r.height)),
        };
        // a type's registered size rule wins (P3: card/table height from the content), else the table here (P1)
        final own = registry?.typeOf(o.type)?.resize;
        final hook = resizeOf(o.type).resize;
        patches[o.id] = own != null
            ? own(o, base, h)
            : hook == null
            ? base
            : hook(o, base, ResizeContext(from: _tfBox, to: nb, rect: r, widthOnly: _tfWidthOnly));
      }
    } else {
      return;
    }
    patches.removeWhere((_, p) => p.isEmpty);
    if (patches.isEmpty) return;
    _handlePatch = patches;
    controller.apply([UpdateOp(patches)], step: false, coalesce: _handleKey);
  }

  void handleEnd(Offset screen) {
    final h = _handle, o = _handleObject;
    _handle = null;
    _handleObject = null;
    final origin = _tfOrigin;
    _tfOrigin = const {};
    _snapOthers = const [];
    guides.value = const SnapGuides();
    rotating.value = null;
    if (h != null && h.startsWith('mind-')) {
      // mind buttons (also on a node that is not selected: count of a collapsed branch)
      if ((screen - _handleDown).distance < 18) mindPress(h);
      return;
    }
    if (h == null) return;
    if (o != null && (h.startsWith('add-') || h.startsWith('anchor-'))) {
      if (_handleMoved) {
        // dropped on the empty board from a plus handle: the same shape there, connected (web: „Plus ins Leere“)
        connectorDragEnd(
          camera.value.toWorld(screen),
          moved: true,
          onEmpty: h.startsWith('add-') ? (from, at) => _siblingAt(o, from, at) : null,
        );
      } else if (h.startsWith('add-') && (screen - _handleDown).distance < 18) {
        createSibling(o, h.substring(4));
      }
      return;
    }
    if (o != null && h.startsWith('end-')) {
      if (_handleMoved) {
        connectorEndDrag(controller.state[o.id] ?? o, h.substring(4), camera.value.toWorld(screen), end: true);
      }
      return;
    }
    if (h == 'label') {
      if (_handleMoved) controller.closeStep();
      return;
    }
    final patch = _handlePatch;
    if (patch != null && origin.isNotEmpty) controller.apply([UpdateOp(patch)], coalesce: _handleKey);
  }

  // ---- marquee and lasso ------------------------------------------------------------------------------------------

  /// Selected before a selection rectangle/lasso started (kept, like Umschalt in the web; „Mehrfachauswahl“).
  Set<String> marqueeBase = const {};

  /// Selection tool option „Lasso“ (web C02): holding and dragging on the board draws a lasso instead of a rectangle.
  bool lasso = false;

  /// Candidates for a selection area [r] (world): what the index finds there plus all connectors (their box follows
  /// the route), without hidden ones.
  Iterable<BoardObject> _areaCandidates(Rect r) sync* {
    final seen = <String>{};
    for (final id in scene.grid.query(r)) {
      final o = controller.state[id];
      if (o != null && seen.add(id) && isVisibleObject(o)) yield o;
    }
    for (final o in controller.state.objects.values) {
      if (o.type == 'connector' && seen.add(o.id) && isVisibleObject(o)) yield o;
    }
  }

  Rect _boundsOf(BoardObject o) => (o.type == 'connector' ? scene.grid.rectOf(o.id) : null) ?? objectRect(o);

  /// Selects what the rectangle [a]–[b] (screen) touches; frames, connectors and timelines only when completely inside
  /// (web `marquee: 'contain'`, D06). Adds to [marqueeBase].
  void marquee(Offset a, Offset b) {
    final cam = camera.value;
    final r = Rect.fromPoints(cam.toWorld(a), cam.toWorld(b));
    final ids = <String>{...marqueeBase};
    for (final o in _areaCandidates(r)) {
      final box = _boundsOf(o);
      final hit = marqueeContainTypes.contains(o.type)
          ? r.left <= box.left && r.top <= box.top && r.right >= box.right && r.bottom >= box.bottom
          : box.overlaps(r);
      if (hit) ids.addAll(groupOf(o.id));
    }
    select(ids);
  }

  /// Lasso through the world points [poly]: selects what lies completely inside (web `rectInLasso`), with groups.
  void lassoSelect(List<Offset> poly) {
    if (poly.length < 3) return;
    final ids = <String>{...marqueeBase};
    for (final o in _areaCandidates(lassoBounds(poly))) {
      if (rectInLasso(_boundsOf(o), poly)) ids.addAll(groupOf(o.id));
    }
    select(ids);
  }

  /// „Alles auswählen“ (without hidden ones, unless „Ausgeblendete zeigen“ is on).
  void selectAll() => select({
    for (final o in controller.state.objects.values)
      if (!o.hidden || showHiddenObjects) o.id,
  });

  /// „Ausgeblendete zeigen“ on/off (D28): hidden objects faded and selectable; off drops them from the selection.
  void setShowHidden(bool on) {
    if (showHiddenObjects == on) return;
    showHiddenObjects = on;
    scene.sync();
    if (!on) {
      final keep = {
        for (final id in selection.value)
          if (controller.state[id]?.hidden != true) id,
      };
      select(keep);
    }
    notifyListeners();
  }

  // ---- pick modes -------------------------------------------------------------------------------------------------

  /// A mode that takes the next tap on the board (format painter, „Link zu …“ target, web: their catch layers): gets
  /// the object under the finger (null = empty board) and the world point; returns true when it handled the tap.
  bool Function(String? objectId, Offset world)? tapInterceptor;

  /// A running vote's tap (P5, web: the vote catch layer lies above the pick modes): asked before [tapInterceptor];
  /// returns true when the tap cast a vote (votable object), else the pick modes and the default get the tap.
  bool Function(String? objectId, Offset world)? voteTapInterceptor;

  /// Objects the board's taps prefer (UX P3: a running vote sets `votable`): one of them under the finger (or a few
  /// pixels off) wins over connectors and pen strokes above it, so a vote is not lost to a line.
  bool Function(BoardObject o)? hitPreference;

  /// The board's tap order: a running vote, then a pick mode (format painter, „Link zu …“ – P1), then (in the view)
  /// the type's own taps (P8 check boxes/links, table cells …) and the default.
  bool interceptTap(String? objectId, Offset world) =>
      (voteTapInterceptor?.call(objectId, world) ?? false) || (tapInterceptor?.call(objectId, world) ?? false);

  // ---- context actions --------------------------------------------------------------------------------------------

  List<BoardObject> get _editableSelection => [
    for (final o in selected)
      if (!o.locked) o,
  ];

  void deleteSelection() {
    final ids = [for (final o in _editableSelection) o.id];
    if (ids.isEmpty || !editable) return;
    if (_editing != null && ids.contains(_editing)) _closeEditing(send: false);
    final minds = [
      for (final id in ids)
        if (controller.state[id]?.type == 'mindnode') id,
    ];
    if (minds.isNotEmpty) {
      // with their subtopics, the rest of the map laid out again (web)
      mindRemove(
        minds,
        others: [
          for (final id in ids)
            if (!minds.contains(id)) id,
        ],
      );
    } else {
      controller.apply([RemoveOp(ids)]);
    }
    select(const {});
  }

  /// [objs] plus the connectors whose both ends dock to one of them (web `withAttachedConnectors`: they belong to a
  /// copy).
  List<BoardObject> withAttachedConnectors(List<BoardObject> objs) {
    final ids = {for (final o in objs) o.id};
    String? docked(ConnectorEnd? e) => e is AttachedEnd ? e.objectId : null;
    return [
      ...objs,
      for (final c in controller.state.objects.values)
        if (c.type == 'connector' && !ids.contains(c.id))
          if (docked(c.from) case final a? when ids.contains(a))
            if (docked(c.to) case final b? when ids.contains(b)) c,
    ];
  }

  /// Copies of [objs] moved by ([dx], [dy]) (web `cloneObjects`): new IDs (`idMap` gets old → new), no lock, new groups
  /// only where at least two members are copied; connector ends to copied objects point at the copies, ends to other
  /// objects become free points (where they are now, moved along).
  List<Map<String, Object?>> cloneObjects(List<BoardObject> objs, double dx, double dy, {Map<String, String>? idMap}) {
    final ids = idMap ?? <String, String>{};
    for (final o in objs) {
      ids[o.id] = BoardController.newId();
    }
    final count = <String, int>{};
    for (final o in objs) {
      if (o.groupId != null) count[o.groupId!] = (count[o.groupId!] ?? 0) + 1;
    }
    final groupMap = <String, String>{};
    String? newGroup(String? g) => g == null || (count[g] ?? 0) < 2 ? null : (groupMap[g] ??= BoardController.newId());
    final out = <Map<String, Object?>>[];
    for (final o in objs) {
      final c = <String, Object?>{...o.raw}
        ..remove('z')
        ..remove('createdBy')
        ..remove('updatedAt')
        ..remove('locked')
        ..remove('groupId');
      c['id'] = ids[o.id];
      c['x'] = o.x + dx;
      c['y'] = o.y + dy;
      final g = newGroup(o.groupId);
      if (g != null) c['groupId'] = g;
      if (o.type == 'connector') {
        final geo = scene.connector(o.id);
        Object? end(Object? e, Offset? at) {
          if (e is Map && e['objectId'] is String) {
            final mapped = ids[e['objectId']];
            if (mapped != null) return {'objectId': mapped, if (e['side'] is String) 'side': e['side']};
            // docked to something not copied: a free end where it is now
            return at == null ? null : {'x': at.dx + dx, 'y': at.dy + dy};
          }
          if (e is Map && e['x'] is num && e['y'] is num) {
            return {'x': (e['x'] as num) + dx, 'y': (e['y'] as num) + dy};
          }
          return null;
        }

        final from = end(o.raw['from'], geo?.a), to = end(o.raw['to'], geo?.b);
        if (from == null || to == null) continue;
        c['from'] = from;
        c['to'] = to;
      }
      out.add(c);
    }
    return out;
  }

  /// Inserts copies of [objs] (web `pasteObjects`): moved by [offset], or centered at [at]; selects the copies (one
  /// undo step). Returns their IDs.
  List<String> pasteObjects(List<BoardObject> objs, {Offset? offset, Offset? at}) {
    if (!editable || objs.isEmpty) return const [];
    var d = offset;
    if (d == null) {
      Rect? b;
      for (final o in objs) {
        final r = objectRect(o);
        b = b == null ? r : b.expandToInclude(r);
      }
      final target = at ?? b!.center;
      d = Offset(jsRound(target.dx - b!.center.dx), jsRound(target.dy - b.center.dy));
    }
    final idMap = <String, String>{};
    final copies = cloneObjects(objs, d.dx, d.dy, idMap: idMap);
    if (copies.isEmpty) return const [];
    controller.apply(mindDuplicateOps(copies, idMap));
    final ids = [for (final c in copies) c['id'] as String];
    select(ids.toSet());
    return ids;
  }

  /// Duplicates the selection 24 px further (web: connectors between the copied objects come along, no lock, new
  /// groups, the copies get selected, one undo step).
  void duplicateSelection() {
    final objs = selected;
    if (objs.isEmpty) return;
    pasteObjects(withAttachedConnectors(objs), offset: const Offset(24, 24));
  }

  void order({required bool toFront}) {
    final ids = [for (final o in _editableSelection) o.id];
    if (ids.isEmpty || !editable) return;
    controller.apply([OrderOp(ids, toFront: toFront)]);
  }

  /// Sets [field] on every editable selected object ([value] null removes it).
  void setField(String field, Object? value, {bool Function(BoardObject o)? where}) {
    if (!editable) return;
    final patches = <String, Map<String, Object?>>{
      for (final o in _editableSelection)
        if (where == null || where(o)) o.id: {field: value},
    };
    if (patches.isEmpty) return;
    if (field == 'color' && value is String) {
      if (selected.every((o) => o.type == 'sticky')) stickyColor = value;
    }
    controller.apply([UpdateOp(patches)]);
  }

  @override
  void dispose() {
    _gone = true;
    _textTimer?.cancel();
    if (_ownSelection) selection.dispose();
    draft.dispose();
    super.dispose();
  }
}
