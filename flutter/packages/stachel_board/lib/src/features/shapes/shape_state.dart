import 'package:flutter/foundation.dart';
import 'package:flutter/painting.dart';

import '../../editor/board_editor.dart';
import '../../editor/registry/board_ui.dart';
import '../../model/board_object.dart';
import '../../protocol/native_messages.dart';
import '../stickers/sticker_data.dart';
import 'catalog.dart';

/// The P2 tool options of one board (web `toolOptions.ts`: „pro Sitzung im Speicher“): shape of the shape tool (kind
/// + library entry), note shape, the sticker tool's item, the library's tab – plus what the shape tool is drawing and
/// the „Form anhängen“ picker. One per editor.
class P2Tools extends ChangeNotifier {
  P2Tools._(this.editor);

  static final _of = Expando<P2Tools>('p2Tools');
  static P2Tools of(BoardEditor editor) => _of[editor] ??= P2Tools._(editor);

  final BoardEditor editor;

  /// The board UI (set by the P2 widgets; tool behaviors only get the editor – host settings for recent emoji).
  BoardUi? ui;

  // ---- shape tool (C06) ---------------------------------------------------------------------------------------------

  /// Kind of new shapes (kept in the editor's `shapeKind` too).
  String get shapeKind => editor.shapeKind;

  /// Library entry picked with it (`circle` vs `ellipse` …; null = the kind's first entry).
  String? shapeEntry;

  void setShape(String kind, [String? entry]) {
    editor.shapeKind = kind;
    shapeEntry = entry;
    notifyListeners();
  }

  /// The entry whose size new shapes get (web `entrySize`).
  ShapeEntry? get currentEntry {
    final e = entryById(shapeEntry);
    return e?.kind == shapeKind ? e : entryOfKind(shapeKind);
  }

  Size get shapeSize {
    final e = currentEntry;
    return e == null ? const Size(180, 120) : Size(e.w, e.h);
  }

  /// World rectangle being drawn with the shape tool (C07); null = none.
  final drawRect = ValueNotifier<Rect?>(null);
  Offset? drawFrom;
  Offset? drawFromScreen;

  // ---- notes (C04, E11) ---------------------------------------------------------------------------------------------

  /// `square` or `rect` for new notes (web tool option `sticky.shape`).
  String _stickyShape = 'square';
  String get stickyShape => _stickyShape;
  set stickyShape(String v) {
    _stickyShape = v == 'rect' ? 'rect' : 'square';
    notifyListeners();
  }

  set stickyColor(String c) {
    editor.stickyColor = c;
    notifyListeners();
  }

  // ---- sticker tool (C16) -------------------------------------------------------------------------------------------

  PlaceItem _sticker = const StampItem('like');
  PlaceItem get sticker => _sticker;
  set sticker(PlaceItem i) {
    _sticker = i;
    notifyListeners();
  }

  /// Tab of the library sheet: `shapes`, `stickers`, `icons`.
  String libraryTab = 'shapes';

  // ---- „Form anhängen“ (D39) ----------------------------------------------------------------------------------------

  /// A connector just drawn from an object into the empty board: the picker at its free end.
  final attach = ValueNotifier<AttachPending?>(null);
}

/// A connector [id] from [fromId] whose free end lies at [at] (world).
class AttachPending {
  const AttachPending(this.id, this.fromId, this.at);
  final String id;
  final String fromId;
  final Offset at;
}

// ---- notes: square / rectangle (web `stickyGeom.ts`) ------------------------------------------------------------------

/// Width : height of a rectangular note (350 : 199, the common sticky-note format).
const stickyRectRatio = 1.75;

/// Default height (and width of the square note).
const stickyDefaultSize = 200.0;

double jsRoundP2(double v) => (v + 0.5).floorToDouble();

/// `square`, `rect` or `free` (after dragging a side handle) from the aspect ratio.
String stickyShapeOf(BoardObject o) {
  final r = o.w / (o.h < 1 ? 1 : o.h);
  if ((r - 1).abs() < 0.03) return 'square';
  if ((r - stickyRectRatio).abs() < 0.04) return 'rect';
  return 'free';
}

/// Size of a new note of [shape].
Size stickySize(String shape, [double h = stickyDefaultSize]) =>
    Size(shape == 'rect' ? jsRoundP2(h * stickyRectRatio) : h, h);

/// Brings a note to [shape]: height and center stay, only the width changes (null = nothing to do).
Map<String, Object?>? stickyShapePatch(BoardObject o, String shape) {
  if (o.type != 'sticky' || stickyShapeOf(o) == shape) return null;
  final w = stickySize(shape, o.h).width;
  return {'x': jsRoundP2(o.x + (o.w - w) / 2), 'w': w};
}

// ---- patching the selection (web `patch`/`choose`) ------------------------------------------------------------------

/// One update of every unlocked selected object with its own patch ([fn] null = leave it); one undo step unless
/// [step] is false (a slider being dragged: same [coalesce] key, the last call with `step: true` closes it).
void patchSelection(
  BoardUi ui,
  Map<String, Object?>? Function(BoardObject o) fn, {
  bool step = true,
  String? coalesce,
}) {
  final editor = ui.editor;
  if (!editor.editable) return;
  final patches = <String, Map<String, Object?>>{
    for (final o in editor.selected)
      if (!o.locked) o.id: ?fn(o),
  };
  if (patches.isEmpty) return;
  ui.controller.apply([UpdateOp(patches)], step: step, coalesce: coalesce);
}
