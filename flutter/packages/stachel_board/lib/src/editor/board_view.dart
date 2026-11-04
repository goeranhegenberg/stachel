import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter/services.dart';

import '../geometry/connector_route.dart';
import '../model/board_object.dart';
import '../mindmap/mind_editing.dart';
import '../model/board_source.dart';
import '../model/collab.dart';
import '../protocol/native_messages.dart';
import '../render/collab_painter.dart';
import 'editor_tools.dart';
import '../render/board_images.dart';
import '../render/board_painter.dart';
import '../render/board_scene.dart';
import '../render/object_renderers.dart';
import '../render/presence_painter.dart';
import '../render/text_layout.dart';
import 'board_editor.dart';
import 'camera.dart';
import 'gestures.dart';
import 'registry/tool_def.dart';
import 'registry/type_behavior.dart';
import 'rich_text_field.dart';
import 'transform.dart';
import '../features/snapping/snapping.dart';
import 'two_finger_tap.dart';

/// The board: one painter for all objects, gestures of concept §3.3 ([BoardGestures]): pan with one finger (with
/// inertia), pinch to zoom, double tap with two fingers = 100 %, tap with two fingers = Rückgängig and with three =
/// Wiederholen (UX P13, [MultiFingerTaps]), mouse wheel/trackpad on desktop, tap selects.
/// With [editable] (E2) also: tools create objects, a selected object moves with one finger (or after holding
/// 300 ms), handles resize/rotate/add, long press + drag on the empty board selects a rectangle, tapping a selected
/// note edits its text in place ([BoardTextEditor]). The others' cursors, selections and „schreibt hier“ on top
/// ([PresencePainter]); own viewport/selection/editing go out as presence.
class BoardView extends StatefulWidget {
  const BoardView({
    super.key,
    required this.controller,
    this.camera,
    this.selection,
    this.editor,
    this.images,
    this.fonts = const BoardFonts(),
    this.onSelect,
    this.onLongPress,
    this.onObjectMenu,
    this.stats,
    this.fitOnLoad = true,
    this.initialFocus,
    this.onFocusMissing,
    this.reportPresence = true,
    this.collab,
    this.onComment,
    this.onCommentAt,
  });

  /// Comment pins, reaction chips, upload placeholders (E3); created internally if null.
  final CollabLayer? collab;

  /// Tap on a comment pin (thread ID): the app opens the thread.
  final ValueChanged<String>? onComment;

  /// Comment tool: tap on the board (anchor at the object there or free): the app asks for the first message.
  final ValueChanged<CommentAnchor>? onCommentAt;

  final BoardController controller;

  /// External camera (zoom display, „Alles zeigen“); created internally if null.
  final CameraController? camera;

  /// Selected object IDs; created internally if null (or taken from [editor]).
  final ValueNotifier<Set<String>>? selection;

  /// Editing logic (E2); null = created internally. Editing happens only while the controller allows it.
  final BoardEditor? editor;
  final BoardImages? images;
  final BoardFonts fonts;

  /// Tap on an object (null = tap on empty board).
  final ValueChanged<BoardObject?>? onSelect;

  /// Long press on the empty board without moving (world point): the app shows its menu.
  final ValueChanged<Offset>? onLongPress;

  /// An object held 500 ms without moving (web D41): the app shows the object menu (the object is selected first;
  /// [BoardViewState.selectionBeforeMenu] is the selection before).
  final void Function(Offset world, String objectId)? onObjectMenu;
  final PaintStats? stats;

  /// Fit the whole board into view when the snapshot arrives.
  final bool fitOnLoad;

  /// Object to center and highlight when the board is there (link `?o=<id>`), instead of fitting everything.
  final String? initialFocus;

  /// [initialFocus] is not on the board (checked against the server's state, not only the cache).
  final VoidCallback? onFocusMissing;

  /// Send own viewport and selection as presence (contract §8.4).
  final bool reportPresence;

  @override
  State<BoardView> createState() => BoardViewState();
}

class BoardViewState extends State<BoardView> with TickerProviderStateMixin implements BoardGestureHandler {
  late final CameraController camera = widget.camera ?? widget.editor?.camera ?? CameraController();
  late final BoardScene scene = widget.editor?.scene ?? BoardScene(widget.controller.state);
  late final BoardEditor editor =
      widget.editor ??
      BoardEditor(controller: widget.controller, scene: scene, camera: camera, selection: widget.selection);
  ValueNotifier<Set<String>> get selection => editor.selection;
  late final BoardImages _images = widget.images ?? NoBoardImages();
  late final RenderContext _ctx = RenderContext(
    scene: scene,
    text: TextLayoutCache(),
    fonts: widget.fonts,
    images: _images,
  );
  late final BoardPainter _painter = BoardPainter(
    ctx: _ctx,
    camera: camera,
    selection: selection,
    repaint: Listenable.merge([widget.controller, _images, editor]),
    stats: widget.stats,
  );
  late final PresencePainter _presence = PresencePainter(
    controller: widget.controller,
    scene: scene,
    camera: camera,
    text: TextLayoutCache(maxEntries: 64),
    fonts: widget.fonts,
  );
  late final _HandlesPainter _handles = _HandlesPainter(
    editor: editor,
    camera: camera,
    fonts: widget.fonts,
    repaint: Listenable.merge([editor, camera, widget.controller, selection, editor.rotating]),
  );
  late final CollabLayer collab = widget.collab ?? CollabLayer(controller: widget.controller, scene: scene);
  late final _overlayText = OverlayText(family: widget.fonts.regular);
  late final CollabPainter _collabPainter = CollabPainter(
    layer: collab,
    camera: camera,
    text: _overlayText,
    repaint: Listenable.merge([camera, widget.controller, widget.controller.uploads]),
  );
  late final DraftPainter _draftPainter = DraftPainter(
    draft: editor.draft,
    camera: camera,
    lookup: (id) => widget.controller.state[id],
  );
  PointerDeviceKind _downKind = PointerDeviceKind.touch;
  late final AnimationController _flash = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1800),
  );
  late final _FlashPainter _flashPainter = _FlashPainter(scene: scene, camera: camera, selection: selection, t: _flash);
  late final BoardGestures _gestures = BoardGestures(this);
  final _textKey = GlobalKey<BoardTextEditorState>();
  final _marquee = ValueNotifier<Rect?>(null);

  /// Lasso points (screen) while drawing one.
  final _lasso = ValueNotifier<List<Offset>?>(null);

  late final Ticker _ticker = createTicker(_tick);
  final _multiTaps = MultiFingerTaps();
  Timer? _multiTapTimer;
  PanInertia? _inertia;
  Camera? _inertiaStart;
  PinchTracker? _pinch;
  Timer? _holdTimer;
  Size _size = Size.zero;
  bool _fitted = false;
  late String? _pendingFocus = widget.initialFocus;
  StreamSubscription<ActDone>? _acts;

  /// The selection before the last long press on an object selected it (menu „Zur Auswahl hinzufügen“, D02).
  Set<String> selectionBeforeMenu = const {};

  @override
  void initState() {
    super.initState();
    _acts = widget.controller.actResults.listen(_actDone);
    widget.controller.addListener(_changed);
    camera.addListener(_reportPresence);
    selection.addListener(_reportPresence);
    editor.onHaptic ??= HapticFeedback.selectionClick;
    editor.addListener(_editorChanged);
    if (widget.controller.loaded) scene.sync();
  }

  void _editorChanged() {
    if (mounted && _ctx.editingId != editor.editingId) {
      setState(() => _ctx.editingId = editor.editingId);
      if (editor.editingId == null) _zoomedFor = null;
      // writing started from the editor (new mind node): bring it into view above the keyboard
      if (editor.editingId != null) SchedulerBinding.instance.addPostFrameCallback((_) => _keepEditedVisible());
    }
  }

  @override
  void dispose() {
    widget.controller.removeListener(_changed);
    editor.removeListener(_editorChanged);
    camera.removeListener(_reportPresence);
    selection.removeListener(_reportPresence);
    widget.controller.presence.cancelPending();
    _acts?.cancel();
    _holdTimer?.cancel();
    _multiTapTimer?.cancel();
    _ticker.dispose();
    _edgeTicker.dispose();
    _flash.dispose();
    _painter.dispose();
    _ctx.text.clear();
    _overlayText.clear();
    _marquee.dispose();
    _lasso.dispose();
    if (widget.editor == null) editor.dispose();
    if (widget.camera == null && widget.editor == null) camera.dispose();
    super.dispose();
  }

  /// Own changes not confirmed yet, as last seen (UX P6: a new one = an action was done).
  int _pendingSeen = 0;

  void _changed() {
    scene.sync(widget.controller.lastChanged);
    editor.prune();
    // UX P6: „Mehrere wählen“ ends after an action on the selection (moving ends it in dragEnd)
    final pending = widget.controller.pendingCount;
    if (pending > _pendingSeen && editor.multiSelect && !editor.dragging && !editor.handling) {
      editor.multiSelect = false;
    }
    _pendingSeen = pending;
    final id = editor.editingId;
    if (id != null && widget.controller.lastChanged?.contains(id) != false) editor.adoptRemoteText();
    if (_ctx.editingId != editor.editingId) setState(() => _ctx.editingId = editor.editingId);
    _placeCamera();
  }

  /// First placement: the linked object if there is one, else everything.
  void _placeCamera() {
    final c = widget.controller;
    if (!c.loaded || _size == Size.zero) return;
    final focus = _pendingFocus;
    if (focus != null) {
      if (focusObject(focus)) {
        _pendingFocus = null;
        return;
      }
      // Only the server's state says „not there“; a cached state may simply be older.
      if (!c.fromCache) {
        _pendingFocus = null;
        widget.onFocusMissing?.call();
      }
    }
    if (!_fitted && widget.fitOnLoad) _startCamera();
  }

  /// First placement: the registry's start camera (P4, phone ≥ 35 %), else everything.
  void _startCamera() {
    final hook = editor.registry?.startCamera;
    final b = scene.bounds;
    final cam = hook == null || b == null ? null : hook(widget.controller.state, b, _size);
    if (cam == null) return fitAll(initial: true);
    _fitted = true;
    camera.value = cam;
  }

  /// Size of the view (zero before the first layout) – for camera math of the packages (P4); the same value as
  /// [BoardEditor.viewSize] (P1), which the editor's own math reads.
  Size get viewSize => _size;

  /// What the painter draws with; P4 sets the board background hook ([RenderContext.background]).
  RenderContext get renderContext => _ctx;

  void _reportPresence() {
    if (!widget.reportPresence || _size == Size.zero) return;
    widget.controller.presence.update(viewport: camera.value.viewRect(_size), selection: selection.value.toList());
  }

  /// Room around fitted content (P4 hooks the measured bars in, web `chromeInsets`): content rectangle, max zoom → insets;
  /// null or no hook = 32 px all round.
  FitPadding? Function(Rect content, double maxZoomFit)? fitPadding;

  /// „Alles einpassen“: the whole board in view (at most 100 %), leaving room for the bars on the board; an empty board
  /// shows 100 % around the origin like the web (on the first placement only while the camera is untouched).
  void fitAll({bool initial = false}) {
    if (_size == Size.zero) return;
    final b = scene.bounds;
    if (b == null) {
      if (!initial || camera.value == Camera.identity) camera.value = Camera(_size.width / 2, _size.height / 2, 1);
      return;
    }
    _fitted = true;
    camera.value = Camera.fit(b, _size, padding: fitPadding?.call(b, 1) ?? const FitPadding.all(32));
  }

  /// Centers [id] (at most 100 %), selects and highlights it. False if it is not on the board (or no size yet).
  bool focusObject(String id, {bool highlight = true}) {
    final o = widget.controller.state[id];
    if (o == null || _size == Size.zero || !isVisibleObject(o)) return false;
    scene.bounds; // syncs the index
    final r = o.type == 'connector' ? scene.grid.rectOf(id) : objectRect(o);
    if (r == null) return false;
    _stopInertia();
    _fitted = true;
    camera.value = Camera.fit(r, _size, padding: const FitPadding.all(48));
    editor.select({id});
    widget.onSelect?.call(o);
    // P8 (audit P05): no pulse when the system asks for less motion (web `prefers-reduced-motion`)
    if (highlight && !(MediaQuery.maybeDisableAnimationsOf(context) ?? false)) _flash.forward(from: 0);
    return true;
  }

  /// A web action was answered (audit §3.2): select what it names and move the camera like the web.
  void _actDone(ActDone d) {
    final r = d.result;
    if (r == null || !mounted) return;
    final sel = r.select;
    if (sel != null) {
      editor.select({
        for (final id in sel)
          if (widget.controller.state[id] != null) id,
      });
    }
    final edit = r.edit;
    if (edit != null && widget.controller.state[edit] != null) editText(edit);
    final rect = r.focusRect;
    if (rect != null && _size != Size.zero) {
      _stopInertia();
      _fitted = true;
      camera.value = Camera.fit(
        Rect.fromLTWH(rect.x, rect.y, rect.w, rect.h),
        _size,
        padding: const FitPadding.all(48),
      );
    } else if (r.focus != null) {
      focusIds(r.focus!);
    }
  }

  /// Camera on the objects [ids] (their common box, at most 100 %).
  bool focusIds(Iterable<String> ids) {
    if (_size == Size.zero) return false;
    scene.bounds; // syncs the index
    Rect? box;
    for (final id in ids) {
      final o = widget.controller.state[id];
      if (o == null || !isVisibleObject(o)) continue;
      final r = (o.type == 'connector' ? scene.grid.rectOf(id) : null) ?? objectRect(o);
      box = box == null ? r : box.expandToInclude(r);
    }
    if (box == null) return false;
    _stopInertia();
    _fitted = true;
    camera.value = Camera.fit(box, _size, padding: const FitPadding.all(48));
    return true;
  }

  /// „Auf Auswahl zoomen“ (D43): camera on the selection.
  bool zoomToSelection() => focusIds(selection.value);

  /// Back to 100 % around the screen center.
  void zoomTo100([Offset? at]) => camera.zoomAt(at ?? _size.center(Offset.zero), 1);

  /// Smallest text size on screen while writing (UX P11): a smaller text, note or mind node is zoomed in to it once
  /// when writing starts (after that the fingers decide).
  static const readableFontPx = 16.0;

  /// Object whose writing already got the zoom of [readableFontPx].
  String? _zoomedFor;

  /// Brings the edited object into view (above the keyboard: the view shrinks when it opens); a small text is zoomed in
  /// first so it can be read while typing (UX P11, e.g. a mind node at 20 %).
  void _keepEditedVisible() {
    final id = editor.editingId;
    final o = id == null ? null : widget.controller.state[id];
    if (o == null || _size == Size.zero) return;
    if (_zoomedFor != id) {
      _zoomedFor = id;
      final fs = editTextBox(o, _ctx)?.fontSize;
      final need = fs == null || fs <= 0 ? 0.0 : readableFontPx / fs;
      if (camera.value.z < need) {
        final c = objectRect(o).center;
        final z = math.min(need, maxZoom);
        _stopInertia();
        camera.value = Camera(_size.width / 2 - c.dx * z, _size.height / 2 - c.dy * z, z);
      }
    }
    final cam = camera.value;
    final r = cam.rectToScreen(objectRect(o));
    final view = (Offset.zero & _size).deflate(12);
    if (view.contains(r.topLeft) && view.contains(r.bottomRight)) return;
    if (r.width > view.width || r.height > view.height) {
      camera.value = Camera.fit(objectRect(o), _size, padding: const FitPadding.all(24), maxZoomFit: cam.z);
      return;
    }
    var dx = 0.0, dy = 0.0;
    if (r.left < view.left) dx = view.left - r.left;
    if (r.right > view.right) dx = view.right - r.right;
    if (r.top < view.top) dy = view.top - r.top;
    if (r.bottom > view.bottom) dy = view.bottom - r.bottom;
    camera.panBy(Offset(dx, dy));
  }

  /// Starts editing the text of [id] (app: context bar „Bearbeiten“).
  bool editText(String id) {
    final ok = editor.startEditing(id);
    if (ok) {
      setState(() => _ctx.editingId = id);
      SchedulerBinding.instance.addPostFrameCallback((_) => _keepEditedVisible());
    }
    return ok;
  }

  /// Ends text editing (measures text objects so their box follows the content).
  void finishEditing() {
    if (editor.editingId == null) return;
    final s = _textKey.currentState;
    if (s != null) {
      s.finish();
    } else {
      editor.stopEditing();
    }
    setState(() => _ctx.editingId = null);
  }

  void _tick(Duration elapsed) {
    final inertia = _inertia, start = _inertiaStart;
    if (inertia == null || start == null) return _ticker.stop();
    final t = elapsed.inMicroseconds / 1e6;
    camera.value = start.panBy(inertia.offsetAt(t));
    if (t >= inertia.duration) {
      _ticker.stop();
      _inertia = null;
    }
  }

  void _stopInertia() {
    if (_ticker.isActive) _ticker.stop();
    _inertia = null;
  }

  // ---- BoardGestureHandler ------------------------------------------------------------------------------------------

  @override
  bool get editable => editor.editable;

  @override
  bool get commentable => editor.commentable;

  /// Objects whose text is written in place (notes, texts, shapes, mind nodes).
  static bool _writable(BoardObject o) => textTypes.contains(o.type) || o.type == 'mindnode';

  /// Behavior of the active feature tool (registry, F2).
  BoardToolBehavior? get _featureBehavior {
    final id = editor.featureTool;
    return id == null ? null : editor.registry?.tools[id]?.behavior;
  }

  /// After a one-shot feature tool was used: back to Auswahl (web C19).
  void _featureToolUsed() {
    final id = editor.featureTool;
    if (id != null && editor.registry?.tools[id]?.once != false) editor.tool = BoardTool.select;
  }

  BoardToolEvent _toolEvent(Offset p, {bool moved = false}) {
    final w = camera.value.toWorld(p);
    return BoardToolEvent(
      editor: editor,
      world: w,
      screen: p,
      objectId: scene.hitTest(w, camera.value.z, prefer: editor.hitPreference)?.id,
      moved: moved,
    );
  }

  @override
  GestureHit hitAt(Offset p) {
    final mind = editor.mindButtonAt(p);
    if (mind != null) return GestureHit(handle: mind.handle);
    final handle = editor.handleAt(p);
    if (handle != null) return GestureHit(handle: handle);
    if (editor.editable && _featureBehavior?.draws == true) return const GestureHit(draw: true);
    // E3: drawing tools draw with one finger (after a stylus was seen only the stylus draws, fingers pan)
    if (editor.editable && drawingTools.contains(editor.tool)) {
      final stylus = _downKind == PointerDeviceKind.stylus || _downKind == PointerDeviceKind.invertedStylus;
      if (stylus) editor.stylusSeen = true;
      if (stylus || !editor.stylusSeen || editor.tool == BoardTool.connector) return const GestureHit(draw: true);
    }
    final overlay = collab.hitAt(p, camera.value, _size, _overlayText);
    if (overlay != null) {
      // P5 (L02): pins with a registered drop can be held and dragged
      final movable = editor.editable && editor.registry?.overlayDrops[overlay.$1] != null;
      return GestureHit(overlay: '${overlay.$1}:${overlay.$2}', overlayMovable: movable);
    }
    // UX P3: surfaces before lines; a running vote prefers votable objects (BoardEditor.hitPreference)
    final o = scene.hitTest(camera.value.toWorld(p), camera.value.z, prefer: editor.hitPreference);
    if (o == null) return GestureHit.empty;
    return GestureHit(
      objectId: o.id,
      selected: selection.value.contains(o.id),
      movable: editor.editable && !o.locked && editor.editingId != o.id,
    );
  }

  @override
  void panStart(Offset p) => _stopInertia();

  @override
  void panUpdate(Offset delta) => camera.panBy(delta);

  @override
  void panEnd(Offset velocity) {
    if (velocity.distance > 150) {
      _inertia = PanInertia(velocity);
      _inertiaStart = camera.value;
      _ticker.start();
    }
  }

  @override
  void pinchStart(Offset focal) {
    _stopInertia();
    _pinch = PinchTracker(camera.value, focal);
  }

  @override
  void pinchUpdate(Offset focal, double scale) {
    final p = _pinch;
    if (p != null) camera.value = p.update(focal, scale);
  }

  @override
  void pinchEnd() => _pinch = null;

  @override
  void tap(Offset p, GestureHit hit) {
    final world = camera.value.toWorld(p);
    final wasEditing = editor.editingId;
    if (wasEditing != null) {
      if (hit.objectId == wasEditing) return; // the text field handles taps inside
      finishEditing();
    }
    // a running vote (P5), then a pick mode (format painter, link target – P1) takes the tap
    if (editor.interceptTap(hit.objectId, world)) return;
    final overlay = hit.overlay;
    if (overlay != null && editor.tool == BoardTool.select) {
      final i = overlay.indexOf(':');
      final kind = overlay.substring(0, i), ref = overlay.substring(i + 1);
      if (kind == 'comment') {
        widget.onComment?.call(ref);
      } else if (kind == 'reaction' && editor.editable) {
        final j = ref.lastIndexOf('|');
        editor.toggleReaction([ref.substring(0, j)], ref.substring(j + 1));
      }
      return;
    }
    if (editor.tool == BoardTool.mindmap && editor.editable) {
      editor.createMindMap(world, template: editor.mindTemplate);
      editor.tool = BoardTool.select;
      return;
    }
    if (editor.tool == BoardTool.feature) {
      final b = _featureBehavior;
      if (b?.onTap != null && editor.editable) {
        b!.onTap!(_toolEvent(p));
        _featureToolUsed();
      }
      return;
    }
    // the comment tool also with the role `comment` (web ReadOnlyGuard keeps `collab.comment` there)
    if (editor.tool == BoardTool.comment && editor.commentable) {
      final o = scene.hitTest(world, camera.value.z);
      final a = commentAnchor(world, o);
      widget.onCommentAt?.call(CommentAnchor(a.x, a.y, objectId: a.objectId, dx: a.dx, dy: a.dy));
      return;
    }
    if (editor.tool != BoardTool.select && editor.editable) {
      switch (editor.tool) {
        case BoardTool.frame:
          editor.createFrame(world);
          editor.tool = BoardTool.select;
        case BoardTool.sticky || BoardTool.text || BoardTool.shape:
          final type = switch (editor.tool) {
            BoardTool.sticky => 'sticky',
            BoardTool.text => 'text',
            _ => 'shape',
          };
          final id = editor.create(type, world);
          if (id != null && type != 'shape') editText(id);
        default:
          break;
      }
      return;
    }
    final id = hit.objectId;
    final o = id == null ? null : widget.controller.state[id];
    if (o == null) {
      editor.select(const {});
      editor.multiSelect = false;
      widget.onSelect?.call(null);
      return;
    }
    // „Mehrfachauswahl“ on (D02): the tapped object's group in or out
    if (editor.multiSelect) {
      editor.toggleInSelection(o.id);
      final s = editor.selected;
      widget.onSelect?.call(s.length == 1 ? s.single : (s.isEmpty ? null : o));
      return;
    }
    // own behavior of the type (table cell, timeline bar, document pages …)
    final tb = editor.registry?.typeOf(o.type)?.onTap;
    if (tb != null &&
        tb(
          TypeTapEvent(editor: editor, object: o, world: world, screen: p, selected: selection.value.contains(o.id)),
        )) {
      return;
    }
    // a tap into a multi-selection keeps only the object's group (D03): selected below
    final group = editor.groupOf(o.id);
    // tap on the selected note/text/shape: edit its text (like the web)
    if (wasEditing == null && setEquals(selection.value, {o.id}) && _writable(o) && editor.editable && !o.locked) {
      editText(o.id);
      widget.onSelect?.call(o);
      return;
    }
    editor.select(group);
    widget.onSelect?.call(o);
  }

  @override
  void doubleTap(Offset p, GestureHit hit) {
    if (!editor.editable) return tap(p, hit);
    // a pick mode takes the second tap too (P5 voting: both taps vote like the web's two clicks)
    if (editor.interceptTap(hit.objectId, camera.value.toWorld(p))) return;
    final id = hit.objectId;
    final o = id == null ? null : widget.controller.state[id];
    if (o == null) {
      // like the web: double tap on the empty board = a new sticky note there
      if (editor.editingId != null) finishEditing();
      final nid = editor.create('sticky', camera.value.toWorld(p));
      if (nid != null) editText(nid);
      return;
    }
    // double tap into a selected group picks only this member (web, D04)
    if (o.groupId != null && selection.value.length > 1 && selection.value.contains(o.id)) {
      editor.select({o.id});
      widget.onSelect?.call(o);
      return;
    }
    // connector label / frame title (web: double click edits them; on an unlabeled line the label goes where tapped)
    final edit = editor.registry?.typeOf(o.type)?.edit;
    if ((edit == 'label' || edit == 'title') && !o.locked && editor.onEditField != null) {
      if (o.type == 'connector' && o.displayText.trim().isEmpty) {
        final g = editor.scene.connector(o.id);
        if (g != null) {
          final t = projectOnPath(g, camera.value.toWorld(p));
          widget.controller.apply([
            UpdateOp({
              o.id: {'labelPos': (t - 0.5).abs() < 0.03 ? null : t},
            }),
          ]);
        }
      }
      editor.select({o.id});
      widget.onSelect?.call(o);
      editor.onEditField!(widget.controller.state[o.id] ?? o);
      return;
    }
    final tb = editor.registry?.typeOf(o.type)?.onDoubleTap;
    if (tb != null &&
        tb(
          TypeTapEvent(
            editor: editor,
            object: o,
            world: camera.value.toWorld(p),
            screen: p,
            selected: selection.value.contains(o.id),
          ),
        )) {
      return;
    }
    if (_writable(o) && !o.locked && editor.editingId != o.id) {
      editor.select({o.id});
      editText(o.id);
      widget.onSelect?.call(o);
    }
  }

  /// A held comment pin being dragged (P5, web L02): kind, reference, finger and marked point at the start, moved.
  ({String kind, String ref, Offset finger, Offset point, bool moved})? _overlayDrag;

  bool _overlayDragStart(Offset p, GestureHit hit) {
    final o = hit.overlay;
    if (o == null || !hit.overlayMovable) return false;
    final i = o.indexOf(':');
    final kind = o.substring(0, i), ref = o.substring(i + 1);
    final t = kind == 'comment' ? collab.threads.where((t) => t.id == ref).firstOrNull : null;
    if (t == null) return true;
    editor.onHaptic?.call();
    final point = collab.pinPoint(t);
    _overlayDrag = (kind: kind, ref: ref, finger: p, point: point, moved: false);
    collab.drag.value = (ref, point);
    return true;
  }

  @override
  void dragStart(Offset p, GestureHit hit, {required bool grabbed}) {
    if (_overlayDragStart(p, hit)) return;
    if (editor.editingId != null) finishEditing();
    _gestureChanged = false;
    _pendingAtGesture = widget.controller.pendingCount;
    _beforeGrab = grabbed ? selection.value : null;
    if (grabbed) editor.onHaptic?.call();
    editor.dragStart(camera.value.toWorld(p), grab: hit.objectId);
    final o = hit.objectId == null ? null : widget.controller.state[hit.objectId!];
    if (o != null) widget.onSelect?.call(o);
  }

  @override
  void dragUpdate(Offset p) {
    final od = _overlayDrag;
    if (od != null) {
      final w = od.point + (p - od.finger) / camera.value.z;
      _overlayDrag = (kind: od.kind, ref: od.ref, finger: od.finger, point: od.point, moved: true);
      collab.drag.value = (od.ref, w);
      return;
    }
    _dragScreen = p;
    _gestureChanged = true;
    editor.dragUpdate(camera.value.toWorld(p));
    // dragged to the view's edge: the view pans along (web, D18)
    if (edgeVelocity(p, _size) != Offset.zero && !_edgeTicker.isActive) _edgeTicker.start();
  }

  @override
  void dragEnd() {
    final od = _overlayDrag;
    if (od != null) {
      _overlayDrag = null;
      final d = collab.drag.value;
      // the pin stays where it was dropped until the server answered (one step, web moveThread)
      Future<void>? done;
      if (od.moved && d != null) {
        final hit = scene.hitTest(d.$2, camera.value.z);
        done = editor.registry?.overlayDrops[od.kind]?.call(editor, od.ref, d.$2, hit?.id);
      }
      if (done == null) {
        collab.drag.value = null;
      } else {
        done.whenComplete(() {
          if (collab.drag.value?.$1 == od.ref) collab.drag.value = null;
        }).ignore();
      }
      return;
    }
    _stopEdgePan();
    editor.dragEnd();
    _endMultiSelectAfterGesture();
  }

  /// The current drag/handle gesture changed something (UX P6), own unconfirmed changes when it started.
  bool _gestureChanged = false;
  int _pendingAtGesture = 0;

  /// UX P6: „Mehrere wählen“ ends once the selection was moved, resized or rotated.
  void _endMultiSelectAfterGesture() {
    final changed = _gestureChanged || widget.controller.pendingCount > _pendingAtGesture;
    if (changed && editor.multiSelect) editor.multiSelect = false;
    _gestureChanged = false;
    _pendingSeen = widget.controller.pendingCount;
  }

  Offset? _dragScreen;
  late final Ticker _edgeTicker = createTicker(_edgeTick);

  void _edgeTick(Duration _) {
    final sp = _dragScreen;
    final v = sp == null || !editor.dragging ? Offset.zero : edgeVelocity(sp, _size);
    if (v == Offset.zero) return _stopEdgePan();
    camera.panBy(v);
    editor.dragUpdate(camera.value.toWorld(sp!));
  }

  void _stopEdgePan() {
    if (_edgeTicker.isActive) _edgeTicker.stop();
    _dragScreen = null;
  }

  @override
  void handleStart(String handle, Offset p) {
    _gestureChanged = false;
    _pendingAtGesture = widget.controller.pendingCount;
    editor.handleStart(handle, p);
  }

  @override
  void handleUpdate(Offset p) {
    _gestureChanged = true;
    editor.handleUpdate(p);
  }

  @override
  void handleEnd() {
    editor.handleEnd(_lastPointer);
    _endMultiSelectAfterGesture();
    // plus handle: the new copy opens for writing (web `startEditing`)
    final id = editor.editAfterCreate;
    editor.editAfterCreate = null;
    if (id != null) editText(id);
  }

  @override
  void longPressEmpty(Offset p) {
    editor.onHaptic?.call();
    // holding a reaction chip names who reacted (web: tooltip on hover, L06)
    final chip = collab.hitAt(p, camera.value, _size, _overlayText);
    if (chip != null && chip.$1 == 'reaction') {
      final j = chip.$2.lastIndexOf('|');
      final g = collab.reactions[chip.$2.substring(0, j)]
          ?.where((g) => g.emoji == chip.$2.substring(j + 1))
          .firstOrNull;
      if (g != null) editor.onNotice?.call(reactionNames(g, widget.controller.user?.key ?? ''));
      return;
    }
    widget.onLongPress?.call(camera.value.toWorld(p));
  }

  /// Selection before a hold grabbed (and selected) an object – the menu's „Zur Auswahl hinzufügen“ needs it.
  Set<String>? _beforeGrab;

  @override
  void longPressObject(Offset p, GestureHit hit) {
    final id = hit.objectId;
    if (id == null || widget.onObjectMenu == null) return;
    if (editor.editingId != null && editor.editingId != id) finishEditing();
    // like the web's openMenu: an object outside the selection gets selected first (its group)
    final before = _beforeGrab ?? selection.value;
    _beforeGrab = null;
    if (!selection.value.contains(id)) editor.select(editor.groupOf(id));
    selectionBeforeMenu = before;
    editor.onHaptic?.call();
    final o = widget.controller.state[id];
    if (o != null) widget.onSelect?.call(o);
    widget.onObjectMenu!(camera.value.toWorld(p), id);
  }

  @override
  void marqueeStart(Offset p) {
    editor.onHaptic?.call();
    if (editor.editingId != null) finishEditing();
    // „Mehrfachauswahl“ on: the area adds to the selection (web: Umschalt)
    editor.marqueeBase = editor.multiSelect ? selection.value : const {};
    if (editor.lasso) _lasso.value = [p];
  }

  @override
  void marqueeUpdate(Offset start, Offset p) {
    final pts = _lasso.value;
    if (pts != null) {
      // lasso (C02): a point every 3 screen px, everything completely inside
      if ((p - pts.last).distance < 3) return;
      _lasso.value = [...pts, p];
      final cam = camera.value;
      editor.lassoSelect([for (final q in _lasso.value!) cam.toWorld(q)]);
      return;
    }
    _marquee.value = Rect.fromPoints(start, p);
    editor.marquee(start, p);
  }

  @override
  void marqueeEnd() {
    _marquee.value = null;
    _lasso.value = null;
    final ids = selection.value;
    if (ids.length == 1) widget.onSelect?.call(widget.controller.state[ids.single]);
  }

  // ---- drawing tools (E3) -------------------------------------------------------------------------------------------

  @override
  void drawStart(Offset p) {
    if (editor.editingId != null) finishEditing();
    final fb = _featureBehavior;
    if (fb != null) return fb.onDrawStart?.call(_toolEvent(p));
    final w = camera.value.toWorld(p);
    switch (editor.tool) {
      case BoardTool.pen:
        editor.penStart(w);
      case BoardTool.eraser:
        editor.eraseAt(w);
      case BoardTool.connector:
        editor.connectorDragStart(w);
      default:
        break;
    }
  }

  @override
  void drawUpdate(Offset p) {
    final fb = _featureBehavior;
    if (fb != null) return fb.onDrawUpdate?.call(_toolEvent(p));
    final w = camera.value.toWorld(p);
    switch (editor.tool) {
      case BoardTool.pen:
        editor.penUpdate(w);
      case BoardTool.eraser:
        editor.eraseAt(w);
      case BoardTool.connector:
        editor.connectorDragUpdate(w);
      default:
        break;
    }
  }

  @override
  void drawEnd(Offset p, {required bool moved}) {
    final fb = _featureBehavior;
    if (fb != null) {
      fb.onDrawEnd?.call(_toolEvent(p, moved: moved));
      _featureToolUsed();
      return;
    }
    switch (editor.tool) {
      case BoardTool.pen:
        editor.penEnd();
      case BoardTool.eraser:
        editor.eraseEnd();
      case BoardTool.connector:
        final id = editor.connectorDragEnd(camera.value.toWorld(p), moved: moved);
        if (id != null) {
          editor.tool = BoardTool.select;
          widget.onSelect?.call(widget.controller.state[id]);
        }
      default:
        break;
    }
  }

  @override
  void drawCancel() {
    _featureBehavior?.onDrawCancel?.call(editor);
    editor
      ..penCancel()
      ..eraseCancel()
      ..connectorDragCancel();
  }

  // ---- pointer events -----------------------------------------------------------------------------------------------

  Offset _lastPointer = Offset.zero;

  /// Timer for the next hold deadline (grab at 300 ms, then the object menu at 500 ms – chained).
  void _scheduleHold([Duration? from]) {
    _holdTimer?.cancel();
    final d = _gestures.deadline;
    if (d == null) return;
    final start = from ?? _gestures.downAt;
    _holdTimer = Timer(d - start, () {
      _gestures.timeout(d);
      final next = _gestures.deadline;
      if (next != null && next > d) _scheduleHold(d);
    });
  }

  // ---- taps with several fingers (E1, UX P13) -----------------------------------------------------------------------

  /// Hint texts of the finger taps (UX P13).
  static const undoneText = 'Rückgängig gemacht';
  static const redoneText = 'Wiederhergestellt';
  static const nothingToUndoText = 'Nichts zum Rückgängigmachen';
  static const nothingToRedoText = 'Nichts zum Wiederholen';

  /// After the last finger of a multi-finger gesture lifted: a recognized tap puts the camera back (the fingers'
  /// small pinch), and the waiting two-finger tap gets its timer.
  void _scheduleMultiTap(Duration now) {
    if (!_multiTaps.active && _multiTaps.deadline != null) {
      final before = _camAtFirstDown;
      if (before != null) camera.value = before;
    }
    _multiTapTimer?.cancel();
    final d = _multiTaps.deadline;
    if (d == null) return;
    _multiTapTimer = Timer(d - now, () {
      if (mounted) _multiTapsDue(d);
    });
  }

  /// The waiting two-finger tap is final at [now] (no second tap came): undo.
  void _multiTapsDue(Duration now) {
    final t = _multiTaps.timeout(now);
    if (t == null) return;
    _multiTapTimer?.cancel();
    _multiTap(t);
  }

  void _multiTap(MultiTap t) {
    switch (t.kind) {
      case MultiTapKind.twoFingerDoubleTap:
        zoomTo100(t.center);
      case MultiTapKind.twoFingerTap:
        _history(undo: true);
      case MultiTapKind.threeFingerTap:
        final before = _camAtFirstDown;
        if (before != null) camera.value = before;
        _history(undo: false);
    }
  }

  /// Two fingers = Rückgängig, three fingers = Wiederholen (UX P13, like common canvas apps) with a short hint; not
  /// while writing (the text has its own steps) and not read only.
  void _history({required bool undo}) {
    final c = widget.controller;
    if (!editor.editable || editor.editingId != null) return;
    final can = undo ? c.canUndo : c.canRedo;
    if (!can) {
      editor.onNotice?.call(undo ? nothingToUndoText : nothingToRedoText);
      return;
    }
    editor.onHaptic?.call();
    if (undo) {
      c.undo();
    } else {
      c.redo();
    }
    editor.onNotice?.call(undo ? undoneText : redoneText);
  }

  // ---- palm rejection (M01, web Editor.tsx `penDown`/`ignored`) ------------------------------------------------------

  /// Touch pointers passed over as the palm (they landed while a stylus was down, or the stylus came after them).
  final _ignored = <int>{};

  /// Kind of each active pointer that the board follows.
  final _kinds = <int, PointerDeviceKind>{};
  int _pens = 0;

  /// The camera when the first of the active pointers went down (a palm's pan/pinch is taken back from here).
  Camera? _camAtFirstDown;

  static bool _isPen(PointerDeviceKind k) => k == PointerDeviceKind.stylus || k == PointerDeviceKind.invertedStylus;

  /// True when [e] is to be ignored: a touch while a stylus lies on the screen. A stylus landing while touches are
  /// already down (the palm came first): their gesture (pan, pinch) is taken back and they are ignored until they lift.
  bool _palmDown(PointerDownEvent e) {
    if (e.kind == PointerDeviceKind.touch && _pens > 0) {
      _ignored.add(e.pointer);
      return true;
    }
    if (_kinds.isEmpty) _camAtFirstDown = camera.value;
    if (_isPen(e.kind)) {
      _pens++;
      final touches = [
        for (final MapEntry(:key, :value) in _kinds.entries)
          if (value == PointerDeviceKind.touch) key,
      ];
      if (touches.isNotEmpty) {
        _holdTimer?.cancel();
        for (final id in touches) {
          _gestures.cancel(id);
          _multiTaps.cancel(id);
          _kinds.remove(id);
          _ignored.add(id);
        }
        _stopInertia();
        final before = _camAtFirstDown;
        if (before != null) camera.value = before;
      }
    }
    _kinds[e.pointer] = e.kind;
    return false;
  }

  /// Pointer [e] lifted or cancelled; true if it was a passed-over palm.
  bool _released(PointerEvent e) {
    if (_kinds.remove(e.pointer) != null && _isPen(e.kind)) _pens = math.max(0, _pens - 1);
    return _ignored.remove(e.pointer);
  }

  void _onSignal(PointerSignalEvent e) {
    if (e is PointerScrollEvent) {
      _stopInertia();
      final ctrl = HardwareKeyboard.instance.isControlPressed;
      if (ctrl || e.kind == PointerDeviceKind.mouse) {
        final factor = 1 - e.scrollDelta.dy * 0.0015;
        camera.zoomAt(e.localPosition, camera.value.z * factor.clamp(0.5, 2.0));
      } else {
        camera.panBy(-e.scrollDelta);
      }
    } else if (e is PointerScaleEvent) {
      camera.zoomAt(e.localPosition, camera.value.z * e.scale);
    }
  }

  @override
  Widget build(BuildContext context) {
    _ctx.devicePixelRatio = MediaQuery.maybeDevicePixelRatioOf(context) ?? 1;
    return LayoutBuilder(
      builder: (context, constraints) {
        final size = constraints.biggest;
        if (size != _size) {
          final before = _size;
          _size = size;
          editor.viewSize = size;
          SchedulerBinding.instance.addPostFrameCallback((_) {
            if (!mounted) return;
            // resized or turned: the view's center stays (as in the web app), not the top left corner (P4, M06)
            if (_fitted && before != Size.zero) {
              camera.panBy(Offset((size.width - before.width) / 2, (size.height - before.height) / 2));
            }
            _placeCamera();
            _reportPresence();
            _keepEditedVisible();
          });
        }
        return Listener(
          behavior: HitTestBehavior.opaque,
          onPointerSignal: _onSignal,
          onPointerDown: (e) {
            if (_palmDown(e)) return;
            _stopInertia();
            _multiTaps.down(e.pointer, e.localPosition, e.timeStamp);
            _multiTapsDue(e.timeStamp);
            if (_onTextField(e.localPosition)) return;
            _lastPointer = e.localPosition;
            _downKind = e.kind;
            _gestures.down(e.pointer, e.localPosition, e.timeStamp);
            _scheduleHold();
          },
          onPointerMove: (e) {
            if (_ignored.contains(e.pointer)) return;
            _multiTaps.move(e.pointer, e.localPosition);
            _multiTapsDue(e.timeStamp);
            _lastPointer = e.localPosition;
            _gestures.move(e.pointer, e.localPosition, e.timeStamp);
            if (_gestures.deadline == null) _holdTimer?.cancel();
          },
          onPointerUp: (e) {
            if (_released(e)) return;
            _holdTimer?.cancel();
            final taps = _multiTaps.up(e.pointer, e.timeStamp);
            _lastPointer = e.localPosition;
            _gestures.up(e.pointer, e.timeStamp);
            taps.forEach(_multiTap);
            _scheduleMultiTap(e.timeStamp);
          },
          onPointerCancel: (e) {
            if (_released(e)) return;
            _holdTimer?.cancel();
            _multiTaps.cancel(e.pointer);
            _gestures.cancel(e.pointer);
          },
          child: Stack(
            children: [
              RepaintBoundary(
                child: CustomPaint(painter: _painter, size: size, isComplex: true, willChange: true),
              ),
              IgnorePointer(
                child: RepaintBoundary(
                  child: CustomPaint(painter: _flashPainter, size: size),
                ),
              ),
              IgnorePointer(
                child: RepaintBoundary(
                  child: CustomPaint(painter: _collabPainter, size: size),
                ),
              ),
              IgnorePointer(
                child: RepaintBoundary(
                  child: CustomPaint(painter: _presence, size: size),
                ),
              ),
              IgnorePointer(
                child: CustomPaint(painter: _handles, size: size),
              ),
              IgnorePointer(
                child: CustomPaint(painter: _draftPainter, size: size),
              ),
              ValueListenableBuilder<Rect?>(
                valueListenable: _marquee,
                builder: (context, r, _) => r == null
                    ? const SizedBox.shrink()
                    : Positioned.fromRect(
                        rect: r,
                        child: const IgnorePointer(
                          child: DecoratedBox(
                            decoration: BoxDecoration(
                              color: Color(0x221763B5),
                              border: Border.fromBorderSide(BorderSide(color: Color(0xFF1763B5), width: 1.5)),
                            ),
                          ),
                        ),
                      ),
              ),
              ValueListenableBuilder<List<Offset>?>(
                valueListenable: _lasso,
                builder: (context, pts, _) => pts == null
                    ? const SizedBox.shrink()
                    : IgnorePointer(
                        child: CustomPaint(size: size, painter: _LassoPainter(pts)),
                      ),
              ),
              if (editor.editingId != null) BoardTextEditor(key: _textKey, editor: editor, camera: camera, ctx: _ctx),
            ],
          ),
        );
      },
    );
  }

  /// Pointer inside the open text field: it gets the touch (caret, selection), the board does not.
  bool _onTextField(Offset p) {
    final id = editor.editingId;
    final o = id == null ? null : widget.controller.state[id];
    if (o == null) return false;
    final cam = camera.value;
    final local = _toLocal(o, cam.toWorld(p));
    return Rect.fromLTWH(
      0,
      0,
      o.type == 'text' && o.autoWidth ? math.max(o.w, 4000) : o.w,
      o.h,
    ).inflate(4).contains(local);
  }

  static Offset _toLocal(BoardObject o, Offset p) {
    final c = Offset(o.x + o.w / 2, o.y + o.h / 2);
    final a = -o.rotation * math.pi / 180;
    final d = p - c;
    return Offset(d.dx * math.cos(a) - d.dy * math.sin(a), d.dx * math.sin(a) + d.dy * math.cos(a)) +
        Offset(o.w / 2, o.h / 2);
  }
}

/// Handles of the selected object (resize squares, rotate circle, plus buttons) in screen space.
class _HandlesPainter extends CustomPainter {
  _HandlesPainter({required this.editor, required this.camera, required this.fonts, required Listenable repaint})
    : super(repaint: repaint);

  final BoardEditor editor;
  final BoardFonts fonts;
  final ValueListenable<Camera> camera;

  static const _blue = Color(0xFF1763B5);

  @override
  void paint(Canvas canvas, Size size) {
    final fill = Paint()..color = const Color(0xFFFFFFFF);
    final stroke = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2
      ..color = _blue;
    paintMindButtons(canvas, editor.mindButtons(), label: _label);
    for (final h in editor.handles()) {
      if (h.id == 'rotate') {
        canvas.drawCircle(h.at, 9, fill);
        canvas.drawCircle(h.at, 9, stroke);
        canvas.drawArc(Rect.fromCircle(center: h.at, radius: 4.5), -2.6, 4.4, false, stroke..strokeWidth = 1.6);
        stroke.strokeWidth = 2;
      } else if (h.id.startsWith('anchor-') || h.id.startsWith('end-')) {
        // anchor points / connector ends (E3): round, drag them
        canvas.drawCircle(h.at, 8, fill);
        canvas.drawCircle(h.at, 8, stroke);
        if (h.id.startsWith('end-')) canvas.drawCircle(h.at, 3.5, Paint()..color = _blue);
      } else if (h.id == 'label') {
        // the selected connector's label can be dragged (web: blue ring around the label)
        final o = editor.single;
        if (o == null) continue;
        final z = camera.value.z;
        final tp = TextPainter(
          text: TextSpan(
            text: o.displayText,
            style: TextStyle(fontSize: connectorLabelSize(o) * z),
          ),
          textDirection: TextDirection.ltr,
          textAlign: TextAlign.center,
        )..layout(maxWidth: 260 * z);
        final box = Rect.fromCenter(center: h.at, width: tp.width + 12 * z, height: tp.height + 6 * z);
        canvas.drawRRect(
          RRect.fromRectAndRadius(box.inflate(1.5), const Radius.circular(5)),
          stroke..strokeWidth = 1.5,
        );
        stroke.strokeWidth = 2;
        tp.dispose();
      } else if (h.id.startsWith('add-')) {
        canvas.drawCircle(h.at, 11, Paint()..color = _blue);
        final p = Paint()
          ..color = const Color(0xFFFFFFFF)
          ..strokeWidth = 2.2
          ..strokeCap = StrokeCap.round;
        canvas.drawLine(h.at - const Offset(5, 0), h.at + const Offset(5, 0), p);
        canvas.drawLine(h.at - const Offset(0, 5), h.at + const Offset(0, 5), p);
      } else {
        final r = Rect.fromCenter(center: h.at, width: 12, height: 12);
        canvas.drawRect(r, fill);
        canvas.drawRect(r, stroke);
      }
    }
    _angle(canvas);
    _locked(canvas);
  }

  /// „GESPERRT“ above a selected locked object (web `ov-lock`: ink pill, condensed caps, top left of the box).
  void _locked(Canvas canvas) {
    final o = editor.single;
    if (o == null || !o.locked) return;
    final r = camera.value.rectToScreen(objectRect(o));
    final tp = _lockLabel ??= TextPainter(
      text: TextSpan(
        text: 'GESPERRT',
        style: TextStyle(
          color: const Color(0xFFFFFFFF),
          fontSize: 12,
          fontWeight: FontWeight.w600,
          fontFamily: fonts.condensed,
          letterSpacing: 1.2,
          height: 1,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    final box = Rect.fromLTWH(r.left, r.top - 6 - tp.height - 4, tp.width + 14, tp.height + 4);
    canvas.drawRRect(RRect.fromRectAndRadius(box, const Radius.circular(4)), Paint()..color = const Color(0xFF0A0A0A));
    tp.paint(canvas, Offset(box.left + 7, box.top + 2));
  }

  TextPainter? _lockLabel;

  /// Angle label while rotating (web `ov-angle`: whole degrees, never „-0°“; pink when it snapped), above the handle.
  void _angle(Canvas canvas) {
    final r = editor.rotating.value;
    if (r == null) return;
    final at = editor.handles().where((h) => h.id == 'rotate').firstOrNull?.at;
    if (at == null) return;
    final tp = _label(angleLabel(r.deg), const Color(0xFFFFFFFF), 12);
    final box = Rect.fromCenter(center: at - const Offset(0, 30), width: tp.width + 14, height: tp.height + 8);
    canvas.drawRRect(
      RRect.fromRectAndRadius(box, const Radius.circular(5)),
      Paint()..color = r.snapped ? const Color(0xFFEC4E92) : const Color(0xFF0A0A0A),
    );
    tp.paint(canvas, box.center - Offset(tp.width / 2, tp.height / 2));
  }

  final _labels = <(String, int, double), TextPainter>{};

  TextPainter _label(String text, Color color, double size) => _labels.putIfAbsent(
    (text, color.toARGB32(), size),
    () => TextPainter(
      text: TextSpan(
        text: text,
        style: TextStyle(
          color: color,
          fontSize: size,
          fontWeight: FontWeight.w700,
          fontFamily: fonts.regular,
          height: 1,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout(),
  );

  @override
  bool shouldRepaint(covariant _HandlesPainter old) => !identical(old, this);
}

/// The lasso while drawing it (web `ov-lasso`: light blue, dashed blue outline), screen space.
class _LassoPainter extends CustomPainter {
  _LassoPainter(this.points);
  final List<Offset> points;

  @override
  void paint(Canvas canvas, Size size) {
    if (points.length < 2) return;
    final path = Path()..addPolygon(points, true);
    canvas.drawPath(path, Paint()..color = const Color(0x141763B5));
    final stroke = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5
      ..strokeJoin = StrokeJoin.round
      ..color = const Color(0xFF1763B5);
    for (final m in path.computeMetrics()) {
      for (var d = 0.0; d < m.length; d += 10) {
        canvas.drawPath(m.extractPath(d, math.min(d + 6, m.length)), stroke);
      }
    }
  }

  @override
  bool shouldRepaint(covariant _LassoPainter old) => !identical(old.points, points);
}

/// Highlight of a linked object (`?o=`): a pink ring around the selection that pulses and fades out.
class _FlashPainter extends CustomPainter {
  _FlashPainter({required this.scene, required this.camera, required this.selection, required this.t})
    : super(repaint: Listenable.merge([camera, t]));

  final BoardScene scene;
  final ValueListenable<Camera> camera;
  final ValueListenable<Set<String>> selection;
  final Animation<double> t;

  static const _pink = Color(0xFFEC4E92);

  @override
  void paint(Canvas canvas, Size size) {
    final v = t.value;
    if (v <= 0 || v >= 1) return;
    final ids = selection.value;
    final r = ids.length == 1 ? scene.grid.rectOf(ids.single) : null;
    if (r == null) return;
    final cam = camera.value;
    final pulse = (1 - v) * (0.5 + 0.5 * (1 - (2 * ((v * 3) % 1) - 1).abs()));
    final screen = cam.rectToScreen(r).inflate(6 + 10 * v);
    canvas.drawRRect(
      RRect.fromRectAndRadius(screen, const Radius.circular(6)),
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 4
        ..color = _pink.withValues(alpha: pulse.clamp(0.0, 1.0)),
    );
  }

  @override
  bool shouldRepaint(covariant _FlashPainter old) => !identical(old, this);
}
