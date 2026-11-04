import 'package:flutter/widgets.dart';

import '../../editor/board_editor.dart';
import '../../editor/registry/board_ui.dart';

/// Active item or lane of a timeline (web `Focus`).
class TlFocus {
  const TlFocus.item(this.id) : kind = 'item';
  const TlFocus.lane(this.id) : kind = 'lane';
  final String kind;
  final String id;

  @override
  bool operator ==(Object other) => other is TlFocus && other.kind == kind && other.id == id;
  @override
  int get hashCode => Object.hash(kind, id);
}

/// What is written in place: an item's title or a lane's name (web `EditTarget`).
class TlEdit {
  const TlEdit(this.timeline, this.focus);
  final String timeline;
  final TlFocus focus;
}

/// An item being dragged (local preview; the server gets `timeline.patchItem` at the end, audit §5 risks).
class TlItemDrag {
  TlItemDrag({
    required this.timeline,
    required this.key,
    required this.mode,
    required this.a,
    required this.b,
    required this.lane,
  });
  final String timeline;
  final String key;

  /// `move`, `start`, `end`.
  final String mode;
  int a;
  int b;
  String lane;
}

/// A lane being dragged at its grip ⋮⋮: target index and the drop line (inner y).
class TlLaneDrag {
  TlLaneDrag({required this.timeline, required this.lane});
  final String timeline;
  final String lane;
  int to = -1;
  double y = 0;
}

/// Local state of package P9 per board (web `timeline/state.ts`, not in the document): active item/lane per timeline,
/// what is written in place, drag previews, the lane under a dragged note. One per [BoardEditor] ([TimelineState.of]).
class TimelineState extends ChangeNotifier {
  TimelineState._(this.editor);

  static final _all = Expando<TimelineState>('timeline');

  static TimelineState of(BoardEditor editor) => _all[editor] ??= TimelineState._(editor);

  final BoardEditor editor;

  /// The board UI (set by the overlay).
  BoardUi? ui;

  final _focus = <String, TlFocus>{};

  TlFocus? focusOf(String id) => _focus[id];

  /// Active item (id) of timeline [id].
  String? activeItem(String id) {
    final f = _focus[id];
    return f?.kind == 'item' ? f!.id : null;
  }

  void setFocus(String id, TlFocus? f) {
    if (_focus[id] == f) return;
    if (f == null) {
      _focus.remove(id);
    } else {
      _focus[id] = f;
    }
    notifyListeners();
    // the context bar shows the item's entries (web: selection set again with the same content)
    if (editor.selection.value.contains(id)) editor.refresh();
  }

  TlEdit? _edit;
  TlEdit? get edit => _edit;

  /// Writes the title of item / name of lane [f] of timeline [id] in place (selects the timeline).
  void startEdit(String id, TlFocus f) {
    if (editor.editingId != null) editor.stopEditing();
    if (editor.selection.value.length != 1 || !editor.selection.value.contains(id)) editor.select({id});
    _focus[id] = f;
    _edit = TlEdit(id, f);
    notifyListeners();
  }

  void stopEdit() {
    if (_edit == null) return;
    _edit = null;
    notifyListeners();
  }

  TlItemDrag? _itemDrag;
  TlItemDrag? get itemDrag => _itemDrag;
  set itemDrag(TlItemDrag? d) {
    _itemDrag = d;
    notifyListeners();
  }

  TlLaneDrag? _laneDrag;
  TlLaneDrag? get laneDrag => _laneDrag;
  set laneDrag(TlLaneDrag? d) {
    _laneDrag = d;
    notifyListeners();
  }

  /// Something changed in a running drag (preview).
  void touch() => notifyListeners();
}
