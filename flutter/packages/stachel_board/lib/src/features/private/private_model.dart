import 'dart:async';
import 'dart:ui' show Rect;

import '../../editor/registry/board_ui.dart';
import '../../model/collab.dart' show Person;
import '../follow/collab_common.dart';

// Private mode (docs/features/private.md): new notes, texts and shapes only their author sees until the facilitator
// reveals them. The server keeps them in a per-person store and writes only placeholders into the board (`ext`
// `private.hidden`) plus the state (`private.mode`); the own objects come with the native message `private`
// ([BoardController.privateObjects]). Steering goes over REST (§4) through the app's [BoardPrivateHost].

/// `ext` structure of the mode (`{on, by, byName, since, anonymous, ownReveal, revealAt?}`).
const privateModeExt = 'private.mode';

/// `ext` structure of the placeholders (`{<id>: {x, y, w, h, type, rotation?, by?, o}}`).
const privateHiddenExt = 'private.hidden';

/// The running private mode (null fields = not sent).
class PrivateMode {
  const PrivateMode({
    this.on = false,
    this.by,
    this.byName,
    this.since,
    this.anonymous = false,
    this.ownReveal = false,
    this.revealAt,
  });

  /// Off when [j] is no map.
  static PrivateMode fromJson(Object? j) {
    if (j is! Map) return const PrivateMode();
    String? s(String k) => j[k] is String && (j[k] as String).isNotEmpty ? j[k] as String : null;
    return PrivateMode(
      on: j['on'] == true,
      by: s('by'),
      byName: s('byName'),
      since: s('since'),
      anonymous: j['anonymous'] == true,
      ownReveal: j['ownReveal'] == true,
      revealAt: j['revealAt'] is num ? (j['revealAt'] as num).toInt() : null,
    );
  }

  final bool on;

  /// The facilitator (user key) and their name.
  final String? by;
  final String? byName;

  /// ISO time of the start.
  final String? since;

  /// Placeholders and revealed objects without author.
  final bool anonymous;

  /// Everybody may reveal their own objects before.
  final bool ownReveal;

  /// Countdown of the reveal: ms of the server's clock (null = none running).
  final int? revealAt;
}

/// One placeholder of somebody else's private object (no text, no color – only where and how big).
class HiddenItem {
  const HiddenItem({required this.id, required this.rect, required this.type, this.rotation = 0, this.by, this.o});

  /// Null for anything without a finite position and size.
  static HiddenItem? fromJson(String id, Object? j) {
    if (j is! Map) return null;
    double? n(String k) => j[k] is num && (j[k] as num).isFinite ? (j[k] as num).toDouble() : null;
    final x = n('x'), y = n('y'), w = n('w'), h = n('h');
    if (x == null || y == null || w == null || h == null || w <= 0 || h <= 0) return null;
    return HiddenItem(
      id: id,
      rect: Rect.fromLTWH(x, y, w, h),
      type: j['type'] is String ? j['type'] as String : '',
      rotation: n('rotation') ?? 0,
      by: j['by'] is String && (j['by'] as String).isNotEmpty ? j['by'] as String : null,
      o: j['o'] is String ? j['o'] as String : null,
    );
  }

  final String id;
  final Rect rect;
  final String type;

  /// Degrees clockwise around the center.
  final double rotation;

  /// Author's user key (missing when anonymous).
  final String? by;

  /// Opaque key per person (counts „hidden per person“, names nobody).
  final String? o;
}

/// The private mode of [ui]'s board (off when the server does not support it).
PrivateMode privateModeOf(BoardUi ui) =>
    ui.controller.privateFeature ? PrivateMode.fromJson(ui.controller.state.ext[privateModeExt]) : const PrivateMode();

/// All placeholders in the board's `ext` (also those of own objects – see [hiddenOfOthers]).
List<HiddenItem> readHidden(Object? j) => j is Map
    ? [
        for (final e in j.entries)
          if (e.key is String) ?HiddenItem.fromJson(e.key as String, e.value),
      ]
    : const [];

/// Placeholders of other people's objects: not for IDs I see as an object (own private ones, already revealed ones).
List<HiddenItem> hiddenOfOthers(BoardUi ui) {
  if (!ui.controller.privateFeature) return const [];
  final state = ui.controller.state;
  return [
    for (final h in readHidden(state.ext[privateHiddenExt]))
      if (state[h.id] == null && !ui.controller.privateObjects.containsKey(h.id)) h,
  ];
}

/// IDs of my private objects that are shown (not yet on the board).
List<String> ownPrivateIds(BoardUi ui) => [
  for (final id in ui.controller.privateObjects.keys)
    if (ui.controller.isPrivate(id) && ui.controller.state[id] != null) id,
];

/// May reveal everything / cancel the countdown (contract §4): the facilitator, the board's owner (org mode: orga),
/// or anybody with edit rights when the facilitator is not on the board any more. (The server also lets the board's
/// creator in org mode – the app does not know the creator and shows the button only by these rules.)
bool canRevealAll(BoardUi ui, [PrivateMode? mode]) {
  final m = mode ?? privateModeOf(ui);
  final c = ui.controller;
  if (!m.on || !c.mayEdit) return false;
  final me = c.user?.key;
  if (m.by != null && m.by == me) return true;
  // owner (own accounts) / orga (org mode) like the server's check
  if (c.role == 'owner' || c.user?.isOrga == true) return true;
  return !c.peers.any((p) => p.key == m.by);
}

/// May reveal the own objects now (`ownReveal` and something to reveal).
bool canRevealOwn(BoardUi ui, [PrivateMode? mode]) {
  final m = mode ?? privateModeOf(ui);
  return m.on && m.ownReveal && ui.controller.mayEdit && ownPrivateIds(ui).isNotEmpty;
}

/// Server time now (ms) of [ui]'s board.
int privateNow(BoardUi ui) => CollabSession.of(ui).now;

/// Whole seconds left of the reveal countdown (null = none running).
int? countdownLeft(BoardUi ui, [PrivateMode? mode]) {
  final m = mode ?? privateModeOf(ui);
  final at = m.revealAt;
  if (!m.on || at == null) return null;
  final left = at - privateNow(ui);
  return left > 0 ? (left / 1000).ceil() : null;
}

/// Steering of the private mode by REST (`POST /api/boards/:id/private`, docs/features/private.md §4). The app's
/// [BoardHost] implements it; without it the entries and buttons are hidden.
abstract interface class BoardPrivateHost {
  /// Sends [body] (`{action: start|reveal|revealOwn|cancel, anonymous?, ownReveal?, countdown?}`); returns the new
  /// `state`. Throws on failure.
  Future<Map<String, Object?>> privateMode(Map<String, Object?> body);

  /// German text of an error from [privateMode] (server message where there is one).
  String privateErrorText(Object error);
}

/// The [BoardPrivateHost] of [ui] (null: no private mode in this app).
BoardPrivateHost? privateHost(BoardUi ui) => ui.host is BoardPrivateHost ? ui.host as BoardPrivateHost : null;

/// Per board screen: a request running (buttons wait), the known people for names.
class PrivateSession {
  PrivateSession._(this.ui);
  final BoardUi ui;

  static final _of = Expando<PrivateSession>('PrivateSession');
  static PrivateSession of(BoardUi ui) => _of[ui] ??= PrivateSession._(ui);

  bool busy = false;
  List<Person> _known = const [];
  bool _asked = false;

  /// Runs [action] (with [args]) on the server; failures become a hint with the server's text. True when it worked.
  Future<bool> run(String action, [Map<String, Object?> args = const {}]) async {
    final h = privateHost(ui);
    if (h == null || busy) return false;
    busy = true;
    try {
      await h.privateMode({'action': action, ...args});
      return true;
    } catch (e) {
      ui.hints.show(h.privateErrorText(e));
      return false;
    } finally {
      busy = false;
    }
  }

  /// Name of [key] for a placeholder: people present, the app's list (asked once), the facilitator's name; null =
  /// unknown.
  String? nameOf(String key, {void Function()? loaded}) {
    for (final p in ui.controller.peers) {
      if (p.key == key && p.name.isNotEmpty) return p.name;
    }
    for (final p in _known) {
      if (p.key == key && p.name.isNotEmpty) return p.name;
    }
    final m = privateModeOf(ui);
    if (m.by == key && m.byName != null) return m.byName;
    if (!_asked) {
      _asked = true;
      unawaited(
        ui.host.people().then((list) {
          _known = list;
          if (list.isNotEmpty) loaded?.call();
        }, onError: (_) => _asked = false),
      );
    }
    return null;
  }
}
