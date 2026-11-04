import '../../model/board_object.dart';
import '../../model/board_state.dart';

// Note stacks without widgets (Q2, web `features/shapes/stack/model.ts`): a stack is a group (`groupId`) of sticky notes
// with `stacked: true` at the same place, the top one has the highest paint order. Changing a stack always runs on the
// server with the web's code (acts `shapes.stackDrop`, `shapes.stackCycle`, `shapes.stackSpread`, `shapes.stackTake`);
// the app only needs to know what a stack is and whether a drop could change one (so it does not ask after every move).

/// At most this many notes are put on a stack at once (web `STACK_MAX`).
const stackMax = 200;

/// Part of a stack (sticky note with `stacked` and a group; without the group it means nothing; web `inStack`).
bool inStack(BoardObject? o) => o != null && o.type == 'sticky' && o.raw['stacked'] == true && o.groupId != null;

/// Members of [o]'s stack bottom → top; empty = no stack of at least two notes (web `stackOf`).
List<BoardObject> stackOf(BoardObject? o, BoardState state) {
  if (!inStack(o)) return const [];
  final g = o!.groupId;
  final list = [
    for (final x in state.objects.values)
      if (inStack(x) && x.groupId == g) x,
  ]..sort((a, b) => state.orderOf(a.id).compareTo(state.orderOf(b.id)));
  return list.length >= 2 ? list : const [];
}

/// All stacks of at least two notes: group id → members bottom → top (web `allStacks`).
Map<String, List<BoardObject>> allStacks(BoardState state) {
  final out = <String, List<BoardObject>>{};
  for (final o in state.objects.values) {
    if (inStack(o)) (out[o.groupId!] ??= []).add(o);
  }
  out.removeWhere((_, l) => l.length < 2);
  for (final l in out.values) {
    l.sort((a, b) => state.orderOf(a.id).compareTo(state.orderOf(b.id)));
  }
  return out;
}

/// The selection [ids] is exactly one whole stack: its members bottom → top, else null (web `selectedStack`).
List<BoardObject>? selectedStack(Set<String> ids, BoardState state) {
  if (ids.length < 2) return null;
  final members = stackOf(state[ids.first], state);
  if (members.length != ids.length || !members.every((m) => ids.contains(m.id))) return null;
  return members;
}

bool _hidden(BoardObject o) => o.raw['hidden'] == true;

/// Target of dropping [moved] (all sticky notes, not locked; web `stackTarget`): the topmost other visible, unlocked
/// note whose inner half holds the center of the grabbed note. Null = no stacking.
BoardObject? stackTarget(List<BoardObject> moved, BoardState state, String? grabbed) {
  if (moved.isEmpty || moved.length > stackMax || !moved.every((o) => o.type == 'sticky' && !o.locked)) return null;
  final ids = {for (final o in moved) o.id};
  final lead = moved.where((o) => o.id == grabbed).firstOrNull ?? moved.last;
  final cx = lead.x + lead.w / 2, cy = lead.y + lead.h / 2;
  BoardObject? best;
  for (final t in state.objects.values) {
    if (ids.contains(t.id) || t.type != 'sticky' || t.locked || _hidden(t)) continue;
    if ((cx - (t.x + t.w / 2)).abs() <= t.w / 4 && (cy - (t.y + t.h / 2)).abs() <= t.h / 4) {
      if (best == null || state.orderOf(t.id) > state.orderOf(best.id)) best = t;
    }
  }
  return best;
}

/// Could dropping [moved] change a stack (web `dropNotes`: a target under the grabbed note, or notes pulled out of a
/// stack that did not move as a whole)? Only then the app asks the server (`shapes.stackDrop`).
bool dropMatters(List<BoardObject> moved, BoardState state, String? grabbed) {
  if (stackTarget(moved, state, grabbed) != null) return true;
  final ids = {for (final o in moved) o.id};
  for (final o in moved) {
    if (!inStack(o) || o.locked) continue;
    if (!stackOf(o, state).every((m) => ids.contains(m.id))) return true;
  }
  return false;
}
