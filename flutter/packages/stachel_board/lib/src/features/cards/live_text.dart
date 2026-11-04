import 'dart:async';

import 'package:flutter/widgets.dart';

// Live plain-text fields like the web's `structure/ytext.ts` (card title and description, table cells; P9 timeline titles
// later): the text field and the board stay equal in both directions, concurrent typing loses nothing. The app sends its
// text with the state it started from (`base`) as a web action (`card.title`, `card.desc`, `table.setCell`); the server
// merges it with what others typed meanwhile (server/src/native/ytext-merge.ts). Changes of others land in the field at
// once, the caret stays at its place in the text.

/// Smallest change from one text to another (web `Splice`): delete [del] characters at [index], insert [ins].
class Splice {
  const Splice(this.index, this.del, this.ins);
  final int index;
  final int del;
  final String ins;

  @override
  bool operator ==(Object other) => other is Splice && other.index == index && other.del == del && other.ins == ins;
  @override
  int get hashCode => Object.hash(index, del, ins);
  @override
  String toString() => 'Splice($index, $del, "$ins")';
}

/// Smallest change from [a] to [b]: common start and common end stay (web `spliceOf`, UTF-16 units like JS).
Splice spliceOf(String a, String b) {
  var s = 0;
  final max = a.length < b.length ? a.length : b.length;
  while (s < max && a.codeUnitAt(s) == b.codeUnitAt(s)) {
    s++;
  }
  var e = 0;
  while (e < max - s && a.codeUnitAt(a.length - 1 - e) == b.codeUnitAt(b.length - 1 - e)) {
    e++;
  }
  return Splice(s, a.length - s - e, b.substring(s, b.length - e));
}

/// Position [pos] in [a] carried over to the text [b] (caret on changes of others; web `mapPos`).
int mapPos(int pos, String a, String b) {
  final c = spliceOf(a, b);
  if (pos <= c.index) return pos;
  if (pos >= c.index + c.del) return pos + c.ins.length - c.del;
  return c.index + c.ins.length;
}

/// The own change [base] → [mine] carried over to the current state [theirs] (web `rebase`).
Splice rebase(String base, String mine, String theirs) {
  final m = spliceOf(base, mine);
  if (base == theirs) return m;
  final t = spliceOf(base, theirs);
  final mEnd = m.index + m.del;
  final tEnd = t.index + t.del;
  if (mEnd <= t.index) return m;
  if (m.index >= tEnd) return Splice(m.index + t.ins.length - t.del, m.del, m.ins);
  if (m.index < t.index) return Splice(m.index, t.index - m.index, m.ins);
  return Splice(t.index + t.ins.length, mEnd - tEnd > 0 ? mEnd - tEnd : 0, m.ins);
}

String applySplice(String s, Splice c) => s.substring(0, c.index) + c.ins + s.substring(c.index + c.del);

/// Binds a [TextEditingController] to a plain-text value on the board ([read] = current state there) and sends the
/// user's edits with [send] (`base` = the state the edit started from, `text` = the field) – at most every [debounce].
/// Call [pull] when the board changed (patches): the field takes changes of others over, own unsent characters stay.
class LiveText {
  LiveText({
    required this.read,
    required this.send,
    TextEditingController? controller,
    this.debounce = const Duration(milliseconds: 300),
  }) : controller = controller ?? TextEditingController() {
    _base = read();
    this.controller.value = TextEditingValue(
      text: _base,
      selection: TextSelection.collapsed(offset: _base.length),
    );
    this.controller.addListener(_changed);
  }

  final String Function() read;
  final void Function(String base, String text) send;
  final TextEditingController controller;
  final Duration debounce;

  /// State on the board the field is based on (what was read or sent last).
  String _base = '';
  Timer? _timer;
  bool _applying = false;

  /// Unsent own characters?
  bool get dirty => _timer != null;

  String get base => _base;

  void _changed() {
    if (_applying || controller.text == _base) return;
    _timer?.cancel();
    _timer = Timer(debounce, flush);
  }

  /// Sends the field now (end of editing, next cell …).
  void flush() {
    _timer?.cancel();
    _timer = null;
    final text = controller.text;
    if (text == _base) return;
    send(_base, text);
    _base = text; // optimistic: the server merges and its patch comes back through [pull]
  }

  /// The board changed: take the current state over (with own unsent characters rebased onto it, web `bindField.pull`).
  void pull() {
    final cur = read();
    if (cur == _base) return;
    final shown = controller.text;
    if (cur == shown) {
      _base = cur;
      return;
    }
    final mine = shown != _base ? applySplice(cur, rebase(_base, shown, cur)) : cur;
    final sel = controller.selection;
    _applying = true;
    controller.value = TextEditingValue(
      text: mine,
      selection: sel.isValid
          ? TextSelection(
              baseOffset: mapPos(sel.baseOffset, shown, mine),
              extentOffset: mapPos(sel.extentOffset, shown, mine),
            )
          : TextSelection.collapsed(offset: mine.length),
    );
    _applying = false;
    _base = cur;
    // own characters still to send (on top of the new state)
    if (mine != cur) {
      _timer?.cancel();
      _timer = Timer(debounce, flush);
    }
  }

  void dispose({bool send = true}) {
    if (send) flush();
    _timer?.cancel();
    controller.removeListener(_changed);
  }
}
