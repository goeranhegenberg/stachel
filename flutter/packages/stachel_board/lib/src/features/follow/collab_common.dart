import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../editor/camera.dart';
import '../../editor/registry/board_ui.dart';
import '../../model/board_source.dart';
import '../../protocol/native_messages.dart';
import '../view/view_state.dart';

// Shared pieces of the collaboration features (P5: voting, timer, follow, laser, cursor chat) – the web's
// `features/collab/model.ts`, `ui.ts`, `common.tsx`.

/// Awareness fields of the web's collab module (model.ts `AW_*`); the app sets them through `presence.extra`.
const awFollow = 'collab.follow';
const awViewport = 'collab.viewport';
const awSummon = 'collab.summon';
const awLaser = 'collab.laser';
const awStatus = 'collab.status';
const awChat = 'collab.chat';

/// Feature structures (`ext`) of the web's collab module.
const extVote = 'collab.vote';
const extVotes = 'collab.votes';
const extVoteHistory = 'collab.voteHistory';
const extTimer = 'collab.timer';

/// Colors of the web (`global.css`).
abstract final class CollabColors {
  static const ink = Color(0xFF0A0A0A);
  static const ink2 = Color(0xFF1F1F1F);
  static const green = Color(0xFFC9E14A);
  static const blue = Color(0xFF1763B5);
  static const pink = Color(0xFFEC4E92);
  static const idle = Color(0xFF8A8A85);
  static const away = Color(0xFFFFB347);
  static const laser = Color(0xFFFF2D55);
}

/// Server time now (ms since 1970): the device clock plus the offset the collab actions told ([CollabSession]).
/// Tests replace [collabDeviceNow].
int Function() collabDeviceNow = () => DateTime.now().millisecondsSinceEpoch;

/// Status of a person (web `PresenceStatus`).
enum PresenceStatus {
  active('aktiv'),
  idle('inaktiv'),
  away('gleich zurück');

  const PresenceStatus(this.text);

  /// Web `STATUS_TEXT`.
  final String text;
}

/// Status of [p] from `collab.status` (missing = active, web `statusOf`).
PresenceStatus statusOf(Peer p) => switch (p.extra[awStatus]) {
  'idle' => PresenceStatus.idle,
  'away' => PresenceStatus.away,
  _ => PresenceStatus.active,
};

Color statusColor(PresenceStatus s) => switch (s) {
  PresenceStatus.active => CollabColors.green,
  PresenceStatus.idle => CollabColors.idle,
  PresenceStatus.away => CollabColors.away,
};

/// Initials like the web (`board/colors.ts` `initials`): letters/digits of the first and last word, one word = its
/// first two characters.
String webInitials(String name) {
  final parts = name
      .replaceAll(RegExp(r'[^\p{L}\p{N}\s-]', unicode: true), ' ')
      .trim()
      .split(RegExp(r'[\s-]+'))
      .where((p) => p.isNotEmpty)
      .toList();
  if (parts.isEmpty) return '?';
  if (parts.length == 1) return parts.first.substring(0, math.min(2, parts.first.length)).toUpperCase();
  return (parts.first[0] + parts.last[0]).toUpperCase();
}

/// One peer per person (several tabs/devices count once), without me (web `uniquePeers`).
List<Peer> uniquePeers(List<Peer> peers, String me) {
  final seen = <String>{};
  return [
    for (final p in peers)
      if (p.key != me && seen.add(p.key)) p,
  ];
}

/// A world rectangle from an awareness value `{x, y, w, h}` (finite, w/h > 0), else null (web `isRect`).
Rect? awRect(Object? v) {
  if (v is! Map) return null;
  final x = v['x'], y = v['y'], w = v['w'], h = v['h'];
  if (x is! num || y is! num || w is! num || h is! num) return null;
  if (![x, y, w, h].every((n) => n.isFinite) || w <= 0 || h <= 0) return null;
  return Rect.fromLTWH(x.toDouble(), y.toDouble(), w.toDouble(), h.toDouble());
}

/// Camera that shows the area [r] completely (web `cameraFor` = `fitRect(r, w, h, 0, MAX_ZOOM)`).
Camera cameraFor(Rect r, Size size) => Camera.fit(r, size, padding: const FitPadding.all(0), maxZoomFit: maxZoom);

/// Camera softly onto the world point [p] (at least [minZoomTo]) – web `flyTo`.
void flyTo(BoardUi ui, Offset p, {double minZoomTo = 0.5, int ms = 280}) {
  final v = ui.view;
  if (v == null || v.viewSize == Size.zero) return;
  final c = v.camera.value;
  final z = math.max(c.z, minZoomTo);
  final s = v.viewSize;
  BoardViewPrefs.of(ui).animateCamera(Camera(s.width / 2 - p.dx * z, s.height / 2 - p.dy * z, z), ms: ms);
}

/// Shared collaboration state of one board screen (web `CollabUi`, one per board session): whom I follow, „gleich
/// zurück“, the vote result I closed – and the server clock: every collab action answers with `data.now`, so
/// countdowns run on the server's time like they would on one computer.
class CollabSession {
  CollabSession._(this.ui) {
    _acts = ui.controller.actResults.listen(_onAct);
  }

  static final _of = Expando<CollabSession>('CollabSession');

  /// The session of [ui] (created on first use).
  static CollabSession of(BoardUi ui) => _of[ui] ??= CollabSession._(ui);

  final BoardUi ui;
  StreamSubscription<ActDone>? _acts;

  /// userKey of the person I follow (web `ui.follow`).
  final follow = ValueNotifier<String?>(null);

  /// Name of the followed person (for the hint while they are briefly gone).
  String followName = '';

  /// „Gleich zurück“ set by myself.
  final away = ValueNotifier<bool>(false);

  /// The result view of this vote session was closed (it opens by itself once per session).
  String? resultsDismissed;

  /// Server time − device time (ms).
  int clockOffset = 0;

  /// Server time now (ms since 1970).
  int get now => collabDeviceNow() + clockOffset;

  String get me => ui.controller.user?.key ?? '';
  String get myName => ui.controller.user?.name ?? '';

  void _onAct(ActDone d) {
    if (!d.name.startsWith('collab.')) return;
    final data = d.result?.data;
    final n = data is Map ? data['now'] : null;
    if (n is num) clockOffset = n.toInt() - collabDeviceNow();
  }

  void dispose() {
    unawaited(_acts?.cancel());
    follow.dispose();
    away.dispose();
  }
}

/// A short random id like the web's `nanoid(8)` (summon calls).
String collabNanoid([int n = 8]) {
  const alphabet = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';
  final r = math.Random();
  return String.fromCharCodes(List.generate(n, (_) => alphabet.codeUnitAt(r.nextInt(64))));
}

/// Dark round panel of the web's collab notices (`.panel` on the board: ink, white text, float shadow, colored ring).
class CollabPill extends StatelessWidget {
  const CollabPill({
    super.key,
    required this.child,
    this.ring = CollabColors.green,
    this.radius = 999,
    this.padding = const EdgeInsets.fromLTRB(12, 4, 6, 4),
    this.minHeight = 44,
  });

  final Widget child;
  final Color ring;
  final double radius;
  final EdgeInsetsGeometry padding;
  final double minHeight;

  @override
  Widget build(BuildContext context) => Container(
    constraints: BoxConstraints(minHeight: minHeight),
    padding: padding,
    decoration: BoxDecoration(
      color: CollabColors.ink,
      borderRadius: BorderRadius.circular(radius),
      border: Border.all(color: ring, width: 2),
      boxShadow: const [BoxShadow(color: Color(0x40000000), blurRadius: 18, offset: Offset(0, 6))],
    ),
    child: DefaultTextStyle.merge(
      style: const TextStyle(color: Colors.white, fontSize: 14),
      child: IconTheme.merge(
        data: const IconThemeData(color: Colors.white),
        child: child,
      ),
    ),
  );
}

/// Small light button inside a dark pill („Beenden“, „Schließen“) and the green one („Ergebnis“, „OK“).
class CollabPillButton extends StatelessWidget {
  const CollabPillButton({super.key, required this.label, required this.onPressed, this.green = false});
  final String label;
  final VoidCallback? onPressed;
  final bool green;

  @override
  Widget build(BuildContext context) => TextButton(
    onPressed: onPressed,
    style: TextButton.styleFrom(
      backgroundColor: green ? CollabColors.green : const Color(0x26FFFFFF),
      foregroundColor: green ? CollabColors.ink : Colors.white,
      minimumSize: const Size(48, 36),
      padding: const EdgeInsets.symmetric(horizontal: 12),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
      // the app's font (a bare TextStyle would drop the theme's family)
      textStyle: (Theme.of(context).textTheme.labelLarge ?? const TextStyle()).copyWith(
        fontWeight: FontWeight.w700,
        fontSize: 14,
      ),
    ),
    child: Text(label),
  );
}

/// Round avatar with initials in the person's color and the status dot (web `collab-av` + `collab-dot`).
class CollabAvatar extends StatelessWidget {
  const CollabAvatar({super.key, required this.name, required this.color, this.size = 32, this.status, this.ring});

  final String name;
  final Color color;
  final double size;
  final PresenceStatus? status;

  /// Ring of „folge ich“ (person's color around an ink line).
  final Color? ring;

  @override
  Widget build(BuildContext context) {
    final s = status;
    final light = color.computeLuminance() > 0.55;
    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Container(
            width: size,
            height: size,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: color,
              shape: BoxShape.circle,
              border: Border.all(color: Colors.white, width: 2),
              boxShadow: ring == null
                  ? null
                  : [
                      BoxShadow(color: ring!, spreadRadius: 5),
                      const BoxShadow(color: CollabColors.ink, spreadRadius: 2.5),
                    ],
            ),
            child: Text(
              webInitials(name),
              style: TextStyle(
                fontWeight: FontWeight.w700,
                fontSize: size * 0.38,
                color: light ? CollabColors.ink : Colors.white,
                height: 1,
              ),
            ),
          ),
          if (s != null)
            Positioned(
              right: -2,
              bottom: -2,
              child: Container(
                key: ValueKey('collabDot-${s.name}'),
                width: 10,
                height: 10,
                decoration: BoxDecoration(
                  color: statusColor(s),
                  shape: BoxShape.circle,
                  border: Border.all(color: CollabColors.ink, width: 2),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Color of a peer (`#rrggbb`), else the web's first presence color.
Color peerColor(String hex) {
  final m = RegExp(r'^#([0-9a-fA-F]{6})$').firstMatch(hex);
  return m == null ? CollabColors.blue : Color(int.parse('FF${m.group(1)}', radix: 16));
}
