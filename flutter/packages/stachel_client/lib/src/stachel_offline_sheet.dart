import 'dart:async';

import 'package:flutter/material.dart';

import 'stachel_offline.dart';
import 'stachel_board_widgets.dart';
import 'stachel_style.dart';

/// „Offline verfügbar“ (N10) for one board: switch, storage used, refresh state; from the board menu and the list.
Future<void> showStachelOfflineSheet(BuildContext context, {required String boardId, required String title}) =>
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (_) => StachelOfflineSheet(boardId: boardId, title: title),
    );

class StachelOfflineSheet extends StatelessWidget {
  const StachelOfflineSheet({super.key, required this.boardId, required this.title});
  final String boardId;
  final String title;

  @override
  Widget build(BuildContext context) {
    final off = StachelOffline.instance;
    unawaited(off.load());
    return ListenableBuilder(
      listenable: off,
      builder: (context, _) {
        final e = off.entry(boardId);
        final progress = off.progressOf(boardId);
        final busy = off.syncing(boardId);
        final small = Theme.of(context).textTheme.bodySmall;
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: Column(
              key: const Key('stachelOfflineSheet'),
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'OFFLINE VERFÜGBAR',
                  style: TextStyle(fontFamily: Sk.cond, fontWeight: FontWeight.w700, fontSize: 16),
                ),
                SwitchListTile(
                  key: const Key('stachelOfflineSwitch'),
                  contentPadding: EdgeInsets.zero,
                  value: e != null,
                  activeThumbColor: Sk.pink,
                  title: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
                  subtitle: const Text(
                    'Das Board mit allen Bildern und PDF-Seiten auf dem Handy behalten und aktuell halten.',
                  ),
                  onChanged: (on) => unawaited(on ? off.pin(boardId, title) : off.unpin(boardId)),
                ),
                if (e != null) ...[
                  if (busy) ...[
                    Text(
                      progress == null || progress.total == 0
                          ? 'Wird gespeichert …'
                          : 'Wird gespeichert … ${progress.done} von ${progress.total} Bildern',
                      key: const Key('stachelOfflineStatus'),
                    ),
                    const SizedBox(height: 6),
                    LinearProgressIndicator(
                      value: progress == null || progress.total == 0 ? null : progress.done / progress.total,
                      color: Sk.pink,
                    ),
                  ] else
                    Text(
                      [
                        '${stachelBytes(e.bytes)} auf dem Handy',
                        if (e.syncedAt != null) 'Stand von ${stachelWhen(e.syncedAt!)}',
                      ].join(' · '),
                      key: const Key('stachelOfflineStatus'),
                    ),
                  if (stachelOfflineProblem(e, off.maxBytes) case final problem? when !busy)
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Text(
                        problem,
                        key: const Key('stachelOfflineProblem'),
                        style: TextStyle(color: Sk.danger),
                      ),
                    ),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton.icon(
                      key: const Key('stachelOfflineRefresh'),
                      onPressed: busy ? null : () => unawaited(off.sync(boardId, force: true)),
                      icon: const Icon(Icons.sync),
                      label: const Text('JETZT AKTUALISIEREN'),
                    ),
                  ),
                ],
                const SizedBox(height: 4),
                Text(
                  'Alle Offline-Boards: ${stachelBytes(off.totalBytes)} von ${stachelBytes(off.maxBytes)}',
                  key: const Key('stachelOfflineTotal'),
                  style: small,
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

/// What is not complete about an offline board (null = all there).
String? stachelOfflineProblem(StachelOfflineEntry e, int maxBytes) {
  final missing = e.missing == 1 ? 'ein Bild fehlt' : '${e.missing} Bilder fehlen';
  return switch (e) {
    StachelOfflineEntry(error: 'too_large') => 'Das Board ist zu groß, um es offline zu halten.',
    StachelOfflineEntry(error: 'gone') =>
      'Das Board ist nicht mehr erreichbar – auf dem Handy bleibt der letzte Stand.',
    StachelOfflineEntry(full: true) => 'Speicher für Offline-Boards voll (${stachelBytes(maxBytes)}) – $missing.',
    StachelOfflineEntry(missing: > 0) => 'Noch nicht alles da: $missing, kommt mit der nächsten Verbindung.',
    StachelOfflineEntry(error: 'offline') => 'Keine Verbindung – aktualisiert, sobald das Netz wieder da ist.',
    _ => null,
  };
}
