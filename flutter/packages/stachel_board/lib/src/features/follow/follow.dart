import 'dart:async';

import 'package:flutter/material.dart';

import '../../editor/registry/board_ui.dart';
import '../../model/board_source.dart';
import '../../protocol/native_messages.dart';
import '../view/view_state.dart';
import 'collab_common.dart';

// Folgen, „Alle zu mir holen“ und Status (web `features/collab/Presence.tsx`): audit rows B03, L13–L16.

/// Without input this long → „inaktiv“ (web `IDLE_MS`).
const idleTime = Duration(minutes: 2);

/// The followed person may be gone this long (Wi-Fi hiccup, server restart) before following ends (web
/// `FOLLOW_GRACE_MS`).
const followGrace = Duration(seconds: 12);

/// „Alle zu mir holen“ of others is taken on first sight only when it is this fresh (web: 8 s).
const summonFresh = 8000;

/// Follow the person [key] (null = stop): jumps to their view right away (web `follow`).
void followPerson(BoardUi ui, String? key) {
  final s = CollabSession.of(ui);
  s.follow.value = key;
  if (key == null) return;
  Peer? p;
  for (final x in ui.controller.peers) {
    if (x.key == key) {
      p = x;
      break;
    }
  }
  if (p == null) return;
  s.followName = p.name;
  final v = awRect(p.extra[awViewport]);
  final view = ui.view;
  if (v != null && view != null && view.viewSize != Size.zero) {
    BoardViewPrefs.of(ui).animateCamera(cameraFor(v, view.viewSize), ms: 350);
  } else if (p.cursorX != null && p.cursorY != null) {
    flyTo(ui, Offset(p.cursorX!, p.cursorY!), minZoomTo: 0);
  }
}

/// „Hinspringen“ in the people list (web `jumpTo`): the cursor first, else the view.
void jumpToPeer(BoardUi ui, Peer p) {
  if (p.cursorX != null && p.cursorY != null) return flyTo(ui, Offset(p.cursorX!, p.cursorY!), minZoomTo: 0);
  final v = awRect(p.extra[awViewport]);
  final view = ui.view;
  if (v != null && view != null && view.viewSize != Size.zero) {
    BoardViewPrefs.of(ui).animateCamera(cameraFor(v, view.viewSize), ms: 350);
  }
}

/// „Alle zu mir holen“ (web `summonAll`): own view as `collab.summon` (the server adds its time), hint.
void summonAll(BoardUi ui) {
  final view = ui.view;
  if (view == null || view.viewSize == Size.zero) return;
  final r = view.camera.value.viewRect(view.viewSize);
  ui.controller.presence.setExtra(awSummon, {
    'id': collabNanoid(),
    'rect': {'x': r.left.round(), 'y': r.top.round(), 'w': r.width.round(), 'h': r.height.round()},
  }, immediate: true);
  ui.hints.show('Alle werden zu dir geholt.');
}

/// People following me (their `collab.follow` is my key).
List<Peer> followersOf(BoardUi ui) {
  final me = CollabSession.of(ui).me;
  return [
    for (final p in uniquePeers(ui.controller.peers, me))
      if (p.extra[awFollow] == me) p,
  ];
}

/// The followed person if present (any of their connections, web `allPeers.find`).
Peer? leaderOf(BoardUi ui) {
  final key = CollabSession.of(ui).follow.value;
  if (key == null) return null;
  for (final p in ui.controller.peers) {
    if (p.key == key) return p;
  }
  return null;
}

/// Invisible logic of following (overlay `collab.follow`, also while presenting – web `FollowLayer`): sends whom I
/// follow and my status, moves the camera with the followed person's view, ends following on own touches and after
/// the grace time, takes „Alle zu mir holen“ of others, and draws the frame in the leader's color.
class FollowLayer extends StatefulWidget {
  const FollowLayer({super.key, required this.ui});
  final BoardUi ui;

  @override
  State<FollowLayer> createState() => _FollowLayerState();
}

class _FollowLayerState extends State<FollowLayer> with WidgetsBindingObserver {
  BoardUi get ui => widget.ui;
  late final CollabSession s = CollabSession.of(ui);

  Timer? _grace;
  String _lastView = '';
  final _seenSummon = <int, String>{};
  List<Peer>? _lastPeers;
  Timer? _idleTimer;
  int _lastInput = collabDeviceNow();
  bool _idle = false;
  bool _background = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    ui.controller.addListener(_peersChanged);
    ui.controller.source.connection.addListener(_peersChanged);
    s.follow.addListener(_followChanged);
    s.away.addListener(_sendStatus);
    _idleTimer = Timer.periodic(const Duration(seconds: 10), (_) => _checkIdle());
    _sendStatus();
    WidgetsBinding.instance.addPostFrameCallback((_) => _peersChanged());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    ui.controller.removeListener(_peersChanged);
    ui.controller.source.connection.removeListener(_peersChanged);
    s.follow.removeListener(_followChanged);
    s.away.removeListener(_sendStatus);
    _grace?.cancel();
    _idleTimer?.cancel();
    super.dispose();
  }

  // ---- status (L13) -----------------------------------------------------------------------------------------------

  PresenceStatus get _status =>
      s.away.value ? PresenceStatus.away : (_idle ? PresenceStatus.idle : PresenceStatus.active);

  void _sendStatus() => ui.controller.presence.setExtra(awStatus, _status.name, immediate: true);

  void _checkIdle() {
    final idle = _background || collabDeviceNow() - _lastInput > idleTime.inMilliseconds;
    if (idle == _idle) return;
    _idle = idle;
    _sendStatus();
  }

  void _input() {
    _lastInput = collabDeviceNow();
    if (_idle && !_background) _checkIdle();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // app in the background = tab hidden in the web
    _background = state != AppLifecycleState.resumed;
    if (!_background) _lastInput = collabDeviceNow();
    _checkIdle();
  }

  // ---- following (L14) ----------------------------------------------------------------------------------------------

  void _followChanged() {
    ui.controller.presence.setExtra(awFollow, s.follow.value);
    _lastView = '';
    _lastPeers = null;
    _peersChanged();
  }

  void _peersChanged() {
    if (!mounted) return;
    final peers = ui.controller.peers;
    final online = ui.controller.source.connection.value == BoardConnection.live;
    final following = s.follow.value;
    final leader = leaderOf(ui);
    if (leader != null) {
      s.followName = leader.name;
      _grace?.cancel();
      _grace = null;
      final v = awRect(leader.extra[awViewport]);
      final key = v == null ? '' : '${v.left},${v.top},${v.width},${v.height}';
      final view = ui.view;
      if (v != null && key != _lastView && view != null && view.viewSize != Size.zero) {
        _lastView = key;
        BoardViewPrefs.of(ui).animateCamera(cameraFor(v, view.viewSize), ms: 160);
      }
    } else if (following != null && online) {
      _grace ??= Timer(followGrace, () {
        _grace = null;
        if (!mounted || s.follow.value != following || leaderOf(ui) != null) return;
        s.follow.value = null;
        ui.hints.show(
          '${s.followName.isEmpty ? 'Die Person' : s.followName} ist nicht mehr auf dem Board – Folgen beendet.',
        );
      });
    } else {
      _grace?.cancel();
      _grace = null;
    }
    if (!identical(peers, _lastPeers)) {
      _lastPeers = peers;
      _summons(peers);
      setState(() {});
    }
  }

  // ---- „Alle zu mir holen“ (L16) ----------------------------------------------------------------------------------

  void _summons(List<Peer> peers) {
    for (final p in peers) {
      final v = p.extra[awSummon];
      if (v is! Map || v['id'] is! String) continue;
      final r = awRect(v['rect']);
      if (r == null) continue;
      final id = v['id'] as String;
      final before = _seenSummon[p.id];
      _seenSummon[p.id] = id;
      if (before == id) continue;
      final ts = v['ts'];
      // first sight: only fresh calls (clocks may differ a little)
      if (before == null && !(ts is num && (s.now - ts).abs() < summonFresh)) continue;
      s.follow.value = null;
      final view = ui.view;
      if (view != null && view.viewSize != Size.zero) {
        BoardViewPrefs.of(ui).animateCamera(cameraFor(r, view.viewSize), ms: 450);
      }
      ui.hints.show('${p.name} hat dich zu sich geholt.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final leader = leaderOf(ui);
    return Stack(
      fit: StackFit.expand,
      children: [
        // sees every touch on the board without taking it: own input ends following and counts as activity
        Listener(
          behavior: HitTestBehavior.translucent,
          onPointerDown: (_) {
            _input();
            if (s.follow.value != null) s.follow.value = null;
          },
          onPointerMove: (_) => _input(),
          onPointerSignal: (_) {
            _input();
            if (s.follow.value != null) s.follow.value = null;
          },
          child: const SizedBox.expand(),
        ),
        if (leader != null)
          IgnorePointer(
            child: Container(
              key: const Key('collabFollowFrame'),
              decoration: BoxDecoration(border: Border.all(color: peerColor(leader.color), width: 4)),
              child: Container(
                decoration: BoxDecoration(border: Border.all(color: const Color(0x99FFFFFF))),
              ),
            ),
          ),
      ],
    );
  }
}

/// „Du folgst X · Beenden“, „Verbindung zu X kurz weg …“, „X folgt dir“ / „N Personen folgen dir“ (web
/// `FollowNotice`, in the notices on top).
class FollowNotice extends StatelessWidget {
  const FollowNotice({super.key, required this.ui});
  final BoardUi ui;

  @override
  Widget build(BuildContext context) {
    final s = CollabSession.of(ui);
    return ListenableBuilder(
      listenable: Listenable.merge([ui.controller, s.follow]),
      builder: (context, _) {
        final following = s.follow.value;
        final leader = following == null
            ? null
            : uniquePeers(ui.controller.peers, s.me).where((p) => p.key == following).firstOrNull;
        if (following != null && leader == null) {
          return CollabPill(
            key: const Key('collabFollowWaiting'),
            ring: CollabColors.idle,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Flexible(
                  child: Text.rich(
                    TextSpan(
                      children: [
                        const TextSpan(text: 'Verbindung zu '),
                        TextSpan(
                          text: s.followName.isEmpty ? 'der Person' : s.followName,
                          style: const TextStyle(fontWeight: FontWeight.w700),
                        ),
                        const TextSpan(text: ' kurz weg – Folgen geht gleich weiter'),
                      ],
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                CollabPillButton(label: 'Beenden', onPressed: () => s.follow.value = null),
              ],
            ),
          );
        }
        if (leader != null) {
          final color = peerColor(leader.color);
          return CollabPill(
            key: const Key('collabFollowing'),
            ring: color,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                CollabAvatar(name: leader.name, color: color, size: 24),
                const SizedBox(width: 10),
                Flexible(
                  child: Text.rich(
                    TextSpan(
                      children: [
                        const TextSpan(text: 'Du folgst '),
                        TextSpan(
                          text: leader.name,
                          style: const TextStyle(fontWeight: FontWeight.w700),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                CollabPillButton(
                  key: const Key('collabFollowStop'),
                  label: 'Beenden',
                  onPressed: () => s.follow.value = null,
                ),
              ],
            ),
          );
        }
        final followers = followersOf(ui);
        if (followers.isEmpty) return const SizedBox.shrink();
        return CollabPill(
          key: const Key('collabFollowers'),
          ring: Colors.transparent,
          minHeight: 36,
          padding: const EdgeInsets.fromLTRB(12, 4, 16, 4),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.visibility_outlined, size: 16),
              const SizedBox(width: 8),
              Flexible(
                child: Text.rich(
                  followers.length == 1
                      ? TextSpan(
                          children: [
                            TextSpan(
                              text: followers.single.name,
                              style: const TextStyle(fontWeight: FontWeight.w700),
                            ),
                            const TextSpan(text: ' folgt dir'),
                          ],
                        )
                      : TextSpan(
                          children: [
                            TextSpan(
                              text: '${followers.length} Personen',
                              style: const TextStyle(fontWeight: FontWeight.w700),
                            ),
                            const TextSpan(text: ' folgen dir'),
                          ],
                        ),
                  style: const TextStyle(color: Color(0xFFE9E9E4)),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
