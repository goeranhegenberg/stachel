import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';

import '../../editor/camera.dart';
import '../../editor/registry/board_ui.dart';
import '../../model/board_object.dart';
import '../../render/board_scene.dart';
import '../shapes/catalog.dart' show shapeKindLabel;

// P8, audit P01/P02/P05: screen readers on the board like the web (`ui/a11y.ts`, `Editor.tsx`): the selection is
// announced („Haftnotiz „Bühne“ ausgewählt“, „3 Objekte ausgewählt“, „Auswahl aufgehoben“), every visible object is
// a node in z-order (TalkBack/VoiceOver swipe through them like Tab in the web; double tap selects, the camera moves
// along when one is only partly in view), and „weniger Bewegung“ of the system (`MediaQuery.disableAnimations`)
// switches the board's motion off (`reduceMotion`).

/// Fallback names of the types (web `TYPE_NAMES`); the type register's label wins.
const _typeNames = {
  'sticky': 'Haftnotiz',
  'text': 'Text',
  'shape': 'Form',
  'connector': 'Verbinder',
  'pen': 'Zeichnung',
  'frame': 'Rahmen',
  'image': 'Bild',
};

/// „Haftnotiz „Bühnenplan bis 15.11.““ – short enough for an announcement (web `describeObject`).
String a11yDescribeObject(BoardObject o, {String Function(String type)? typeLabel}) {
  final kind = o.type == 'shape' && o.shape != null
      ? shapeKindLabel(o.shape)
      : (typeLabel?.call(o.type) ?? _typeNames[o.type] ?? 'Objekt');
  final raw = (o.type == 'frame' ? (o.title ?? '') : o.text).replaceAll(RegExp(r'\s+'), ' ').trim();
  final text = raw.length > 60 ? '${raw.substring(0, 57)}…' : raw;
  return '$kind${text.isEmpty ? '' : ' „$text“'}${o.locked ? ', gesperrt' : ''}';
}

/// Announcement of a selection (web `describeSelection`).
String a11yDescribeSelection(List<BoardObject> objects, {String Function(String type)? typeLabel}) {
  if (objects.isEmpty) return 'Auswahl aufgehoben';
  if (objects.length == 1) return '${a11yDescribeObject(objects.single, typeLabel: typeLabel)} ausgewählt';
  return '${objects.length} Objekte ausgewählt';
}

/// Says [text] through the screen reader (tests replace it).
@visibleForTesting
void Function(String text) announceText = (text) =>
    // ignore: deprecated_member_use
    SemanticsService.announce(text, TextDirection.ltr);

/// The system asks for less motion (set by [A11yLayer] from `MediaQuery.disableAnimations`): the board jumps
/// instead of gliding and leaves out its pulses (web `prefers-reduced-motion`).
bool reduceMotion = false;

/// Most object nodes at once (the visible ones; a huge board does not build thousands of nodes).
const maxA11yNodes = 300;

/// Overlay `a11y.semantics`: announcements, one semantics node per visible object, „weniger Bewegung“.
class A11yLayer extends StatefulWidget {
  const A11yLayer({super.key, required this.ui});
  final BoardUi ui;

  @override
  State<A11yLayer> createState() => _A11yLayerState();
}

class _A11yLayerState extends State<A11yLayer> {
  late Set<String> _announced = const {};
  ValueNotifier<Set<String>>? _sel;

  BoardUi get ui => widget.ui;

  @override
  void initState() {
    super.initState();
    _listen();
  }

  @override
  void didUpdateWidget(A11yLayer old) {
    super.didUpdateWidget(old);
    if (!identical(old.ui.editor.selection, ui.editor.selection)) _listen();
  }

  void _listen() {
    _sel?.removeListener(_selectionChanged);
    _sel = ui.editor.selection..addListener(_selectionChanged);
    _announced = ui.editor.selection.value;
  }

  @override
  void dispose() {
    _sel?.removeListener(_selectionChanged);
    super.dispose();
  }

  String _label(String type) => ui.registry.typeOf(type)?.label ?? _typeNames[type] ?? 'Objekt';

  /// Web: announce the selection (not at the start with nothing selected, not twice the same).
  void _selectionChanged() {
    final sel = ui.editor.selection.value;
    if (sel.isEmpty && _announced.isEmpty) return;
    if (setEquals(sel, _announced)) return;
    _announced = sel;
    final objects = [for (final id in sel) ?ui.controller.state[id]];
    announceText(a11yDescribeSelection(objects, typeLabel: _label));
  }

  @override
  Widget build(BuildContext context) {
    reduceMotion = MediaQuery.maybeDisableAnimationsOf(context) ?? false;
    // nodes only while a screen reader runs (they cost a layout per camera change)
    if (!(MediaQuery.maybeAccessibleNavigationOf(context) ?? false)) return const SizedBox.shrink();
    final view = ui.view;
    final cam = view?.camera;
    if (view == null || cam == null) return const SizedBox.shrink();
    return ListenableBuilder(
      listenable: Listenable.merge([cam, ui.controller, ui.editor.selection]),
      builder: (context, _) => LayoutBuilder(builder: (context, box) => _nodes(cam, box.biggest)),
    );
  }

  Widget _nodes(CameraController cam, Size size) {
    final c = cam.value;
    final world = Rect.fromPoints(c.toWorld(Offset.zero), c.toWorld(size.bottomRight(Offset.zero)));
    final screen = Offset.zero & size;
    final state = ui.controller.state;
    final sel = ui.editor.selection.value;
    final visible = [
      for (final o in state.ordered)
        if (isVisibleObject(o) && objectRect(o).overlaps(world)) o,
    ];
    final shown = visible.length > maxA11yNodes ? visible.sublist(visible.length - maxA11yNodes) : visible;
    return Semantics(
      container: true,
      explicitChildNodes: true,
      label: 'Board',
      child: Stack(
        children: [
          for (final (i, o) in shown.indexed)
            if (_rectOf(o, c).intersect(screen) case final r when r.width > 0 && r.height > 0)
              Positioned.fromRect(
                key: ValueKey('a11y-${o.id}'),
                rect: r,
                child: Semantics(
                  sortKey: OrdinalSortKey(i.toDouble()),
                  button: true,
                  selected: sel.contains(o.id),
                  label: a11yDescribeObject(o, typeLabel: _label),
                  onTap: () => ui.editor.select(ui.editor.groupOf(o.id)),
                  onDidGainAccessibilityFocus: () => _follow(o),
                  child: const SizedBox.expand(),
                ),
              ),
        ],
      ),
    );
  }

  Rect _rectOf(BoardObject o, Camera c) {
    final r = objectRect(o);
    return Rect.fromPoints(c.toScreen(r.topLeft), c.toScreen(r.bottomRight));
  }

  /// The camera moves along when a focused object is only partly in view (web: Tab moves the camera to it).
  void _follow(BoardObject o) {
    final view = ui.view;
    final cam = view?.camera;
    if (view == null || cam == null) return;
    final size = view.viewSize;
    final c = cam.value;
    final r = _rectOf(o, c);
    if ((Offset.zero & size).contains(r.topLeft) && (Offset.zero & size).contains(r.bottomRight)) return;
    final center = objectRect(o).center;
    cam.value = Camera(size.width / 2 - center.dx * c.z, size.height / 2 - center.dy * c.z, c.z);
  }
}
