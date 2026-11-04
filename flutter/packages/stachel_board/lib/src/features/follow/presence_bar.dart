import 'package:flutter/material.dart';

import '../../editor/registry/board_ui.dart';
import '../../protocol/native_messages.dart';
import 'collab_common.dart';
import 'follow.dart';

/// Avatars of the people on the board for the app bar (web `PresenceBar`, audit B03): up to four others with their
/// status dot (tap = jump there and follow, again = stop), „+N“, me with my status, the arrow – the last three open
/// the list „Auf dem Board“. [compact] (UX-Review P1, the board's app bar on a phone): a tight stack of one other,
/// „+N“ and me without the arrow, the whole stack opens the list (follow from there), so the title keeps its room.
class CollabPresenceBar extends StatelessWidget {
  const CollabPresenceBar({super.key, required this.ui, this.size = 30, this.step = 24, this.compact = false});
  final BoardUi ui;
  final double size;

  /// Distance of the overlapping avatars (the app bar is narrow on a phone).
  final double step;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final s = CollabSession.of(ui);
    return ListenableBuilder(
      listenable: Listenable.merge([ui.controller, s.follow, s.away]),
      builder: (context, _) {
        final me = ui.controller.user;
        final peers = uniquePeers(ui.controller.peers, s.me);
        final shown = peers.take(compact ? 1 : 4).toList();
        final more = peers.length - shown.length;
        final following = s.follow.value;
        final size = compact ? 28.0 : this.size, step = compact ? 12.0 : this.step;
        final children = <Widget>[];
        var x = 0.0;
        for (final p in shown) {
          final on = following == p.key;
          children.add(
            Positioned(
              left: x,
              top: 0,
              child: Tooltip(
                message: compact
                    ? '${p.name} – Anwesende'
                    : (on ? '${p.name} – nicht mehr folgen' : '${p.name} – hinspringen und folgen'),
                child: GestureDetector(
                  key: ValueKey('collabAvatar-${p.key}'),
                  behavior: HitTestBehavior.opaque,
                  onTap: compact ? null : () => followPerson(ui, on ? null : p.key),
                  child: CollabAvatar(
                    name: p.name,
                    color: peerColor(p.color),
                    size: size,
                    status: statusOf(p),
                    ring: on ? peerColor(p.color) : null,
                  ),
                ),
              ),
            ),
          );
          x += step;
        }
        void open() => showCollabPeople(context, ui);
        if (more > 0) {
          children.add(
            Positioned(
              left: x,
              top: 0,
              child: GestureDetector(
                key: const Key('collabAvatarMore'),
                onTap: open,
                child: Container(
                  width: size,
                  height: size,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: Colors.white,
                    shape: BoxShape.circle,
                    border: Border.all(color: CollabColors.ink, width: 2),
                  ),
                  child: Text(
                    '+$more',
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12, color: CollabColors.ink),
                  ),
                ),
              ),
            ),
          );
          x += step;
        }
        if (shown.isNotEmpty) x += compact ? 4 : 6; // a little gap before me
        children.add(
          Positioned(
            left: x,
            top: 0,
            child: Tooltip(
              message: '${me?.name ?? 'Ich'} (du) – Status und Anwesende',
              child: GestureDetector(
                key: const Key('collabAvatarMe'),
                onTap: open,
                child: CollabAvatar(
                  name: me?.name ?? '?',
                  color: peerColor(ui.controller.color ?? ''),
                  size: size,
                  status: s.away.value ? PresenceStatus.away : PresenceStatus.active,
                ),
              ),
            ),
          ),
        );
        x += size;
        return Semantics(
          label: '${peers.length + 1} anwesend',
          child: InkWell(
            key: const Key('stachelPeers'),
            onTap: open,
            child: Padding(
              padding: EdgeInsets.symmetric(horizontal: compact ? 2 : 4, vertical: 12),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  SizedBox(
                    width: x + 4,
                    height: size + 4,
                    child: Stack(clipBehavior: Clip.none, children: children),
                  ),
                  if (!compact) const Icon(Icons.keyboard_arrow_down, size: 18, semanticLabel: 'Anwesende'),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

/// The list „Auf dem Board“ (web `PeopleMenu`): me with my status „Da“ / „Gleich zurück“ and who follows me,
/// „Alle zu mir holen“, everybody else with status (or whom they follow), „Hinspringen“ and „Folgen“.
Future<void> showCollabPeople(BuildContext context, BoardUi ui) => ui.openSheet<void>(
  context,
  (context) => _PeopleSheet(ui: ui),
  closeOnSelectionChange: false,
  scrollControlled: true,
);

class _PeopleSheet extends StatelessWidget {
  const _PeopleSheet({required this.ui});
  final BoardUi ui;

  @override
  Widget build(BuildContext context) {
    final s = CollabSession.of(ui);
    final t = ui.theme;
    return ListenableBuilder(
      listenable: Listenable.merge([ui.controller, s.follow, s.away]),
      builder: (context, _) {
        final me = ui.controller.user;
        final myName = me?.name ?? 'Ich';
        final peers = uniquePeers(ui.controller.peers, s.me);
        final followers = followersOf(ui);
        final away = s.away.value;
        final mine = followers.isNotEmpty
            ? '${followers.map((f) => f.name.split(' ').first).join(', ')} ${followers.length == 1 ? 'folgt' : 'folgen'} dir'
            : (away ? 'gleich zurück' : 'aktiv');
        String? leaderOfPeer(Peer p) {
          final theirs = p.extra[awFollow];
          if (theirs is! String) return null;
          if (theirs == s.me) return 'dir';
          for (final x in peers) {
            if (x.key == theirs) return x.name.split(' ').first;
          }
          return null;
        }

        return SafeArea(
          child: ConstrainedBox(
            constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.8),
            child: ListView(
              key: const Key('collabPeople'),
              shrinkWrap: true,
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              children: [
                Row(
                  children: [
                    Text('Auf dem Board', style: t.label(size: 18)),
                    const SizedBox(width: 8),
                    Text(
                      '${peers.length + 1}',
                      style: TextStyle(color: t.grey, fontWeight: FontWeight.w700),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    CollabAvatar(
                      name: myName,
                      color: peerColor(ui.controller.color ?? ''),
                      size: 36,
                      status: away ? PresenceStatus.away : PresenceStatus.active,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            RegExp(r'^du\b', caseSensitive: false).hasMatch(myName) ? myName : '$myName (du)',
                            style: const TextStyle(fontWeight: FontWeight.w700),
                          ),
                          Text(
                            mine,
                            key: const Key('collabMyStatus'),
                            style: TextStyle(color: t.grey, fontSize: 13),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                // „Mein Status“ (web: segment next to me; on the phone below, the sheet is narrow)
                Align(
                  alignment: Alignment.centerLeft,
                  child: SegmentedButton<bool>(
                    key: const Key('collabAway'),
                    showSelectedIcon: false,
                    segments: const [
                      ButtonSegment(value: false, label: Text('Da')),
                      ButtonSegment(value: true, label: Text('Gleich zurück')),
                    ],
                    selected: {away},
                    onSelectionChanged: (v) => s.away.value = v.first,
                  ),
                ),
                const SizedBox(height: 12),
                FilledButton.icon(
                  key: const Key('collabSummon'),
                  style: FilledButton.styleFrom(backgroundColor: CollabColors.green, foregroundColor: CollabColors.ink),
                  onPressed: ui.controller.peers.isEmpty
                      ? null
                      : () {
                          summonAll(ui);
                          Navigator.of(context).maybePop();
                        },
                  icon: const Icon(Icons.group_add_outlined),
                  label: const Text('Alle zu mir holen'),
                ),
                const SizedBox(height: 8),
                if (peers.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: Text('Gerade ist niemand sonst hier.', style: TextStyle(color: t.grey)),
                  )
                else
                  for (final p in peers)
                    _PersonRow(
                      ui: ui,
                      peer: p,
                      following: s.follow.value == p.key,
                      line: switch (leaderOfPeer(p)) {
                        final l? => 'folgt $l',
                        null => statusOf(p).text,
                      },
                    ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _PersonRow extends StatelessWidget {
  const _PersonRow({required this.ui, required this.peer, required this.following, required this.line});
  final BoardUi ui;
  final Peer peer;
  final bool following;
  final String line;

  /// „···“ with the host's rows for this person (moderation of the app); runs the chosen row after the sheet closed.
  List<Widget> _moreButton(BuildContext context, BoardUiTheme t) {
    final entries = ui.host.personActions(peer.key, peer.name.isEmpty ? 'Unbekannt' : peer.name);
    if (entries.isEmpty) return const [];
    return [
      PopupMenuButton<int>(
        key: ValueKey('collabPersonMore-${peer.key}'),
        tooltip: 'Mehr zu ${peer.name}',
        icon: const Icon(Icons.more_vert),
        onSelected: (i) {
          // the navigator's context outlives the sheet
          final outer = Navigator.of(context).context;
          Navigator.of(context).maybePop();
          entries[i].onSelect?.call(outer, ui);
        },
        itemBuilder: (_) => [
          for (final (i, e) in entries.indexed)
            PopupMenuItem(
              key: e.key == null ? null : Key(e.key!),
              value: i,
              child: ListTile(
                contentPadding: EdgeInsets.zero,
                leading: e.icon == null ? null : Icon(e.icon, color: e.danger ? t.danger : t.ink),
                title: Text(e.label, style: TextStyle(color: e.danger ? t.danger : t.ink)),
              ),
            ),
        ],
      ),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final t = ui.theme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          CollabAvatar(name: peer.name, color: peerColor(peer.color), size: 36, status: statusOf(peer)),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(peer.name.isEmpty ? 'Unbekannt' : peer.name, style: const TextStyle(fontWeight: FontWeight.w700)),
                Text(line, style: TextStyle(color: t.grey, fontSize: 13)),
              ],
            ),
          ),
          IconButton(
            key: ValueKey('collabJump-${peer.key}'),
            tooltip: 'Zu ${peer.name} springen',
            icon: const Icon(Icons.visibility_outlined),
            onPressed: () {
              Navigator.of(context).maybePop();
              jumpToPeer(ui, peer);
            },
          ),
          ..._moreButton(context, t),
          following
              ? FilledButton(
                  key: ValueKey('collabFollow-${peer.key}'),
                  style: FilledButton.styleFrom(backgroundColor: t.ink),
                  onPressed: () => followPerson(ui, null),
                  child: const Text('Folge ich'),
                )
              : OutlinedButton(
                  key: ValueKey('collabFollow-${peer.key}'),
                  onPressed: () {
                    Navigator.of(context).maybePop();
                    followPerson(ui, peer.key);
                  },
                  child: const Text('Folgen'),
                ),
        ],
      ),
    );
  }
}
