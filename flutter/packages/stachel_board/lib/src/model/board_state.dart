import '../protocol/native_messages.dart';
import 'board_object.dart';

/// Types drawn below everything else when the server does not say (`welcome.below`; web `TypeInfo.below`).
const defaultBelowTypes = {'frame'};

/// Paint order like the web: [below] types (frames) first, then `z` byte-wise (not `localeCompare`), equal `z` by
/// `id` (contract §4, §8.4).
int compareObjects(BoardObject a, BoardObject b, [Set<String> below = defaultBelowTypes]) {
  final ba = below.contains(a.type), bb = below.contains(b.type);
  if (ba != bb) return ba ? -1 : 1;
  final z = _byteCompare(a.z, b.z);
  return z != 0 ? z : _byteCompare(a.id, b.id);
}

/// Code-unit order; equals the UTF-8 byte order for the ASCII keys of fractional indexing and nanoid IDs.
int _byteCompare(String a, String b) => a.compareTo(b);

/// The board as the server last confirmed it: snapshot + patches, with revision and epoch for resume.
///
/// Plain Dart (no Flutter) so it is unit-testable; [version] counts every change for cheap cache invalidation.
class BoardState {
  final Map<String, BoardObject> _objects = {};
  List<BoardObject>? _ordered;
  Map<String, int>? _orderIndex;

  /// Server revision of the last applied snapshot/patch.
  int rev = 0;

  /// Random per server load of the document; a new epoch means: resume impossible, take the snapshot.
  String epoch = '';

  /// Raw feature structures (`collab.comments`, …) as last sent.
  Map<String, Object?> ext = const {};

  /// Bumped on every change.
  int version = 0;

  /// Types drawn below everything (from `welcome.below`).
  Set<String> below = defaultBelowTypes;

  Map<String, BoardObject> get objects => Map.unmodifiable(_objects);
  int get length => _objects.length;
  BoardObject? operator [](String id) => _objects[id];

  /// Objects in paint order (bottom → top). Cached until the next change.
  List<BoardObject> get ordered {
    final o = _ordered;
    if (o != null) return o;
    final list = _objects.values.toList()..sort((a, b) => compareObjects(a, b, below));
    _orderIndex = {for (var i = 0; i < list.length; i++) list[i].id: i};
    return _ordered = List.unmodifiable(list);
  }

  /// Position of [id] in [ordered] (−1 if unknown).
  int orderOf(String id) {
    if (_orderIndex == null) ordered;
    return _orderIndex![id] ?? -1;
  }

  /// Replaces everything with [snapshot] (welcome). Returns all IDs.
  Set<String> applySnapshot(BoardSnapshot snapshot, {required int rev, required String epoch, Set<String>? below}) {
    if (below != null) this.below = below;
    _objects
      ..clear()
      ..addEntries(snapshot.objects.map((o) => MapEntry(o.id, o)));
    ext = snapshot.ext;
    this.rev = rev;
    this.epoch = epoch;
    _changed();
    return _objects.keys.toSet();
  }

  /// Applies one patch. Patches at or below [rev] are ignored (already seen, e.g. replayed after resume).
  /// Returns the IDs that changed (created, updated or removed).
  Set<String> applyPatch(PatchMessage patch) {
    if (patch.rev != 0 && patch.rev <= rev) return const {};
    final changed = <String>{};
    for (final c in patch.changes) {
      switch (c) {
        case ObjectCreated(:final object):
          _objects[object.id] = object;
          changed.add(c.id);
        case ObjectUpdated(:final set, :final unset):
          final o = _objects[c.id];
          if (o == null) continue; // update of an object we never saw: wait for the snapshot
          _objects[c.id] = o.patched(set: set, unset: unset);
          changed.add(c.id);
        case ObjectRemoved():
          if (_objects.remove(c.id) != null) changed.add(c.id);
      }
    }
    if (patch.ext.isNotEmpty) ext = {...ext, ...patch.ext};
    if (patch.rev != 0) rev = patch.rev;
    if (changed.isNotEmpty || patch.ext.isNotEmpty) _changed();
    return changed;
  }

  /// Sets or removes ([BoardObject] null) single objects (the app's optimistic layer, [BoardController]).
  /// Returns the IDs whose object actually changed.
  Set<String> setObjects(Map<String, BoardObject?> objects) {
    final changed = <String>{};
    objects.forEach((id, o) {
      final cur = _objects[id];
      if (identical(cur, o)) return;
      if (o == null) {
        if (_objects.remove(id) != null) changed.add(id);
      } else {
        _objects[id] = o;
        changed.add(id);
      }
    });
    if (changed.isNotEmpty) _changed();
    return changed;
  }

  /// Takes everything from [other] (objects, ext, rev, epoch, below).
  void copyFrom(BoardState other) {
    _objects
      ..clear()
      ..addAll(other._objects);
    ext = other.ext;
    rev = other.rev;
    epoch = other.epoch;
    below = other.below;
    _changed();
  }

  /// Highest / lowest `z` of all objects ('' if none).
  String get topZ => _objects.values.fold('', (m, o) => o.z.compareTo(m) > 0 ? o.z : m);
  String get bottomZ {
    String? best;
    for (final o in _objects.values) {
      if (best == null || o.z.compareTo(best) < 0) best = o.z;
    }
    return best ?? '';
  }

  void _changed() {
    _ordered = null;
    _orderIndex = null;
    version++;
  }
}
