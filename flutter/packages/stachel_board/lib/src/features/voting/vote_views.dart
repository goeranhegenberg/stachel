import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../editor/board_editor.dart' show BoardTool;
import '../../editor/registry/board_ui.dart';
import '../../model/board_object.dart';
import '../../render/board_scene.dart' show objectRect;
import '../follow/collab_common.dart';
import '../search/search_model.dart' show plainTextOf;
import '../shapes/catalog.dart' show shapeKindLabel;
import '../timer/timer_model.dart' show formatMs;
import 'vote_model.dart';

// Abstimmung (web `VoteViews.tsx`): start sheet, bar on top while voting, vote targets on the objects, result with
// ranking. Audit rows L07–L11. Writing goes through the server's web actions `collab.vote.*`.

/// Vote state of one board screen that is not in the document: my votes on their way to the server (shown at once),
/// the session whose end this device already sent, the result opened by itself.
class VoteRuntime {
  VoteRuntime._(this.ui);
  static final _of = Expando<VoteRuntime>('VoteRuntime');
  static VoteRuntime of(BoardUi ui) => _of[ui] ??= VoteRuntime._(ui);
  final BoardUi ui;

  /// Own votes not answered yet: object → delta (optimistic like the web's local Yjs write).
  final pending = ValueNotifier<Map<String, int>>(const {});
  String? endSentFor;
  String? resultsOpenedFor;

  ({VoteSession? session, Map<String, int> votes, Map<String, String> names, List<VoteResult> history}) read() =>
      readVoting(ui.controller.state.ext);

  /// My votes per object including the ones on their way.
  Map<String, int> mine(VoteSession s) {
    final v = read();
    final out = Map<String, int>.of(myVotes(v.votes, s.id, voterOf(s, CollabSession.of(ui).me)));
    for (final MapEntry(:key, :value) in pending.value.entries) {
      out[key] = math.max(0, (out[key] ?? 0) + value);
    }
    return out;
  }

  /// Tap on an object while voting (web: click on the vote target; `delta` −1 = „−“ / right click).
  Future<void> cast(String objectId, int delta) async {
    final s = read().session;
    if (s == null) return;
    final mineNow = mine(s);
    final cur = mineNow[objectId] ?? 0;
    // same rules as castVote, only to show the result at once (the server decides)
    var next = cur + delta;
    if (delta == 1 && !s.multi && cur > 0) next = 0;
    final predicted = !(next > cur && usedVotes(mineNow) >= s.perPerson);
    if (predicted) _add(objectId, math.max(0, next) - cur);
    try {
      await ui.controller.act('collab.vote.cast', {'objectId': objectId, 'delta': delta}, label: 'Abstimmen');
    } finally {
      if (predicted) _add(objectId, -(math.max(0, next) - cur));
    }
  }

  void _add(String id, int d) {
    if (d == 0) return;
    final m = Map<String, int>.of(pending.value);
    m[id] = (m[id] ?? 0) + d;
    if (m[id] == 0) m.remove(id);
    pending.value = m;
  }
}

/// May I end/close the vote? Like the web: who started it; if that person is not on the board any more, everybody
/// present (`takeover`) – web `useCanModerate`.
({bool can, bool takeover}) canModerate(BoardUi ui, VoteSession? s) {
  if (s == null) return (can: false, takeover: false);
  if (s.startedBy == CollabSession.of(ui).me) return (can: true, takeover: false);
  final hostHere = ui.controller.peers.any((p) => p.key == s.startedBy);
  return (can: !hostHere, takeover: !hostHere);
}

/// Name of an object for lists („Haftnotiz „Bühne““, web `objectLabel` with `typeLabel`).
String voteObjectLabel(BoardUi ui, BoardObject? o) {
  if (o == null) return 'Gelöschtes Objekt';
  final base = o.type == 'shape'
      ? shapeKindLabel(o.raw['shape'] as String? ?? 'rect')
      : (ui.registry.typeOf(o.type)?.label ?? 'Objekt');
  final text = (plainTextOf(o) ?? '').replaceAll(RegExp(r'\s+'), ' ').trim();
  if (text.isEmpty) return base;
  return '$base „${text.length > 32 ? '${text.substring(0, 31)}…' : text}“';
}

// ---- start (L07) -------------------------------------------------------------------------------------------------------

/// Sheet „Abstimmung starten“ (web `VoteStartDialog`).
Future<void> showVoteStart(BuildContext context, BoardUi ui) =>
    ui.openSheet<void>(context, (context) => _VoteStart(ui: ui), closeOnSelectionChange: false, scrollControlled: true);

class _VoteStart extends StatefulWidget {
  const _VoteStart({required this.ui});
  final BoardUi ui;

  @override
  State<_VoteStart> createState() => _VoteStartState();
}

class _VoteStartState extends State<_VoteStart> {
  final _title = TextEditingController();
  int _per = 3;
  int? _minutes = 5;
  bool _multi = false;
  bool _anonymous = false;

  @override
  void dispose() {
    _title.dispose();
    super.dispose();
  }

  void _submit() {
    final ui = widget.ui;
    unawaited(
      ui.controller.act('collab.vote.start', {
        'title': _title.text,
        'perPerson': _per,
        'minutes': _minutes,
        'multi': _multi,
        'anonymous': _anonymous,
      }, label: 'Abstimmung starten'),
    );
    ui.editor.select(const {});
    ui.editor.tool = BoardTool.select;
    Navigator.of(context).maybePop();
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.ui.theme;
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, 16 + MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(
        child: Column(
          key: const Key('collabVoteStart'),
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Abstimmung starten', style: t.label(size: 20)),
            const SizedBox(height: 6),
            Text(
              'Alle auf dem Board stimmen gleichzeitig ab, indem sie Objekte antippen.',
              style: TextStyle(color: t.grey),
            ),
            const SizedBox(height: 14),
            TextField(
              key: const Key('collabVoteTitle'),
              controller: _title,
              autofocus: true,
              maxLength: 80,
              decoration: const InputDecoration(labelText: 'Worum geht es?', hintText: 'z. B. Welche Bühne zuerst?'),
              onSubmitted: (_) => _submit(),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                const Expanded(
                  child: Text('Stimmen pro Person', style: TextStyle(fontWeight: FontWeight.w600)),
                ),
                IconButton.outlined(
                  key: const Key('collabVoteLess'),
                  tooltip: 'Weniger Stimmen',
                  onPressed: _per <= 1 ? null : () => setState(() => _per--),
                  icon: const Icon(Icons.remove),
                ),
                SizedBox(
                  width: 44,
                  child: Text(
                    '$_per',
                    key: const Key('collabVotePer'),
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
                  ),
                ),
                IconButton.outlined(
                  key: const Key('collabVoteMore'),
                  tooltip: 'Mehr Stimmen',
                  onPressed: _per >= votePerPersonMax ? null : () => setState(() => _per++),
                  icon: const Icon(Icons.add),
                ),
              ],
            ),
            const SizedBox(height: 12),
            const Text('Dauer', style: TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 6),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final (min, label) in voteDurations)
                  ChoiceChip(
                    key: Key('collabVoteDur-${min ?? 0}'),
                    label: Text(label),
                    selected: _minutes == min,
                    onSelected: (_) => setState(() => _minutes = min),
                  ),
              ],
            ),
            const SizedBox(height: 6),
            CheckboxListTile(
              key: const Key('collabVoteMulti'),
              contentPadding: EdgeInsets.zero,
              controlAffinity: ListTileControlAffinity.leading,
              value: _multi,
              onChanged: (v) => setState(() => _multi = v ?? false),
              title: const Text('Mehrere Stimmen auf ein Objekt erlauben'),
            ),
            CheckboxListTile(
              key: const Key('collabVoteAnonymous'),
              contentPadding: EdgeInsets.zero,
              controlAffinity: ListTileControlAffinity.leading,
              value: _anonymous,
              onChanged: (v) => setState(() => _anonymous = v ?? false),
              title: const Text('Anonym (im Ergebnis stehen keine Namen)'),
            ),
            const SizedBox(height: 8),
            Wrap(
              alignment: WrapAlignment.end,
              spacing: 8,
              runSpacing: 8,
              children: [
                TextButton(onPressed: () => Navigator.of(context).maybePop(), child: const Text('Abbrechen')),
                FilledButton(
                  key: const Key('collabVoteStartGo'),
                  onPressed: _submit,
                  child: const Text('Abstimmung starten'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

// ---- while voting (L08, L09, L11) ------------------------------------------------------------------------------------

/// Rebuilds every [period] while [active] (countdowns).
mixin _Ticking<T extends StatefulWidget> on State<T> {
  Timer? _tick;

  void tickWhile(bool active, [Duration period = const Duration(milliseconds: 250)]) {
    if (active && _tick == null) {
      _tick = Timer.periodic(period, (_) {
        if (mounted) setState(() {});
      });
    } else if (!active && _tick != null) {
      _tick!.cancel();
      _tick = null;
    }
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }
}

/// Overlay `collab.votes` (web `VoteLayer`): while a vote runs, tapping an object votes (the board's tap goes to the
/// vote like the web's targets over the objects), my votes as blue badges (with „−“ when several are allowed); after
/// the end the totals at the objects. Ends the vote when its time is up (every client, like the web) and opens the
/// result once.
class VoteLayer extends StatefulWidget {
  const VoteLayer({super.key, required this.ui});
  final BoardUi ui;

  @override
  State<VoteLayer> createState() => _VoteLayerState();
}

class _VoteLayerState extends State<VoteLayer> with _Ticking {
  BoardUi get ui => widget.ui;
  VoteRuntime get rt => VoteRuntime.of(ui);

  bool _interceptor(String? id, Offset world) {
    final s = rt.read().session;
    if (id == null || s == null || !s.runningAt(CollabSession.of(ui).now) || !ui.controller.mayEdit) return false;
    final o = ui.controller.state[id];
    if (o == null || !votable(o)) return false;
    unawaited(rt.cast(id, 1));
    return true;
  }

  void _sync(VoteSession? s, int now) {
    final live = s != null && s.runningAt(now);
    tickWhile(s != null && !s.ended);
    // the board's taps on votable objects vote while a vote runs (before P1's pick modes and P8's text taps)
    final e = ui.editor;
    if (live && e.voteTapInterceptor == null) e.voteTapInterceptor = _interceptor;
    if (!live && e.voteTapInterceptor == _interceptor) e.voteTapInterceptor = null;
    // UX P3: taps prefer votable objects over the lines above them (only when this vote may be cast)
    final prefer = live && ui.controller.mayEdit;
    if (prefer && e.hitPreference == null) e.hitPreference = votable;
    if (!prefer && e.hitPreference == votable) e.hitPreference = null;
    if (s == null) return;
    // time up → end (every client may, the result is the same)
    if (!s.ended &&
        s.endsAt != null &&
        now >= s.endsAt! &&
        rt.endSentFor != s.id &&
        ui.controller.canAct('collab.vote.end')) {
      rt.endSentFor = s.id;
      WidgetsBinding.instance.addPostFrameCallback(
        (_) => unawaited(ui.controller.act('collab.vote.end', const {}, label: 'Abstimmung beenden')),
      );
    }
    // result opens by itself once per vote
    final cs = CollabSession.of(ui);
    if (s.ended && cs.resultsDismissed != s.id && rt.resultsOpenedFor != s.id) {
      rt.resultsOpenedFor = s.id;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && !ui.presenting.value) unawaited(showVoteResults(context, ui, id: s.id));
      });
    }
  }

  @override
  void dispose() {
    if (ui.editor.voteTapInterceptor == _interceptor) ui.editor.voteTapInterceptor = null;
    if (ui.editor.hitPreference == votable) ui.editor.hitPreference = null;
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final view = ui.view;
    if (view == null) return const SizedBox.shrink();
    return ListenableBuilder(
      listenable: Listenable.merge([ui.controller, view.camera, rt.pending, ui.editor]),
      builder: (context, _) {
        final now = CollabSession.of(ui).now;
        final v = rt.read();
        final s = v.session;
        _sync(s, now);
        if (s == null) return const SizedBox.shrink();
        final live = s.runningAt(now);
        final cam = view.camera.value;
        final size = view.viewSize;
        final screen = Offset.zero & size;
        final mine = rt.mine(s);
        final totals = s.ended
            ? {
                for (final r in tally(v.votes, s.id, exists: (id) => ui.controller.state[id] != null).ranking)
                  r.objectId: r,
              }
            : const <String, Ranked>{};
        final targets = <Rect>[];
        final badges = <Widget>[];
        for (final o in ui.controller.state.ordered) {
          if (!votable(o)) continue;
          final r = cam.rectToScreen(objectRect(o));
          if (!r.overlaps(screen)) continue;
          if (live) {
            if (r.width < 6 || r.height < 6) continue;
            targets.add(r);
            final n = mine[o.id] ?? 0;
            if (n > 0) badges.add(_badge(o, r, n, s.multi));
          } else if (totals[o.id] case final t?) {
            badges.add(_total(o, r, t));
          }
        }
        return Stack(
          children: [
            if (live)
              IgnorePointer(
                child: CustomPaint(size: Size.infinite, painter: _TargetsPainter(targets)),
              ),
            ...badges,
          ],
        );
      },
    );
  }

  Widget _badge(BoardObject o, Rect r, int n, bool multi) {
    const h = 30.0;
    final w = multi ? 30.0 + 26 : 30.0;
    return Positioned(
      key: ValueKey('collabVoteBadge-${o.id}'),
      left: r.right - w * 0.6,
      top: r.top - h * 0.4,
      child: Container(
        height: h,
        padding: const EdgeInsets.symmetric(horizontal: 4),
        decoration: BoxDecoration(
          color: CollabColors.blue,
          borderRadius: BorderRadius.circular(15),
          border: Border.all(color: Colors.white, width: 2.5),
          boxShadow: const [BoxShadow(color: Color(0x59000000), blurRadius: 10, offset: Offset(0, 4))],
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (multi)
              Semantics(
                button: true,
                label: 'Stimme zurücknehmen',
                child: GestureDetector(
                  key: ValueKey('collabVoteMinus-${o.id}'),
                  behavior: HitTestBehavior.opaque,
                  onTap: () => unawaited(rt.cast(o.id, -1)),
                  child: Container(
                    width: 22,
                    height: 22,
                    alignment: Alignment.center,
                    decoration: const BoxDecoration(color: Color(0x33FFFFFF), shape: BoxShape.circle),
                    child: const Text('−', style: TextStyle(color: Colors.white, fontSize: 16, height: 1)),
                  ),
                ),
              ),
            IgnorePointer(
              child: SizedBox(
                width: 22,
                child: Text(
                  '$n',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 16),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _total(BoardObject o, Rect r, Ranked t) {
    final top = t.rank == 1;
    final d = top ? 38.0 : 32.0;
    return Positioned(
      key: ValueKey('collabVoteTotal-${o.id}'),
      left: r.right - d / 2,
      top: r.top - d / 2,
      child: IgnorePointer(
        child: Tooltip(
          message: 'Platz ${t.rank}',
          child: Container(
            constraints: BoxConstraints(minWidth: d),
            height: d,
            padding: const EdgeInsets.symmetric(horizontal: 8),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: top ? CollabColors.green : CollabColors.ink,
              borderRadius: BorderRadius.circular(d / 2),
              border: Border.all(color: Colors.white, width: 2.5),
              boxShadow: const [BoxShadow(color: Color(0x59000000), blurRadius: 10, offset: Offset(0, 4))],
            ),
            child: Text(
              '${t.votes}',
              style: TextStyle(
                color: top ? CollabColors.ink : Colors.white,
                fontWeight: FontWeight.w700,
                fontSize: top ? 20 : 17,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Outline of every vote target (web `.collab-vote-target`: inset 2 px blue at 25 %).
class _TargetsPainter extends CustomPainter {
  _TargetsPainter(this.rects);
  final List<Rect> rects;

  @override
  void paint(Canvas canvas, Size size) {
    final p = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2
      ..color = const Color(0x401763B5);
    for (final r in rects) {
      canvas.drawRRect(RRect.fromRectAndRadius(r.deflate(1), const Radius.circular(6)), p);
    }
  }

  @override
  bool shouldRepaint(_TargetsPainter old) => true;
}

/// Bar on top while / after voting (web `VoteBar`, in the notices; not while presenting): title, what to do and who
/// voted, my votes left as dots, countdown (urgent below 10 s), „Beenden“ / „Ergebnis“ / „Schließen“.
class VoteBar extends StatefulWidget {
  const VoteBar({super.key, required this.ui});
  final BoardUi ui;

  @override
  State<VoteBar> createState() => _VoteBarState();
}

class _VoteBarState extends State<VoteBar> with _Ticking {
  BoardUi get ui => widget.ui;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: Listenable.merge([ui.controller, VoteRuntime.of(ui).pending, ui.presenting]),
    builder: (context, _) {
      final rt = VoteRuntime.of(ui);
      final v = rt.read();
      final s = v.session;
      tickWhile(s != null && !s.ended);
      if (s == null || ui.presenting.value) return const SizedBox.shrink();
      final now = CollabSession.of(ui).now;
      final live = s.runningAt(now);
      final mod = canModerate(ui, s);
      final left = s.perPerson - usedVotes(rt.mine(s));
      final tip = mod.takeover
          ? '${s.startedByName} ist nicht mehr auf dem Board – du kannst die Abstimmung übernehmen.'
          : null;
      final line = live
          ? (left > 0
                ? 'Objekte antippen zum Abstimmen · ${tally(v.votes, s.id).voters} dabei'
                : 'Alle Stimmen vergeben')
          : 'Abstimmung beendet';
      return CollabPill(
        key: const Key('collabVoteBar'),
        radius: 16,
        minHeight: 52,
        padding: const EdgeInsets.fromLTRB(8, 6, 8, 6),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 34,
              height: 34,
              decoration: const BoxDecoration(color: CollabColors.green, shape: BoxShape.circle),
              child: const Icon(Icons.how_to_vote_outlined, size: 20, color: CollabColors.ink),
            ),
            const SizedBox(width: 10),
            Flexible(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    s.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                  Text(
                    '$line${s.anonymous ? ' · anonym' : ''}',
                    key: const Key('collabVoteLine'),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 12, color: Color(0xFFCFCFC9)),
                  ),
                ],
              ),
            ),
            if (live) ...[
              const SizedBox(width: 8),
              Semantics(
                label: '$left von ${s.perPerson} Stimmen übrig',
                child: s.perPerson <= 10
                    ? Row(
                        key: const Key('collabVotesLeft'),
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          for (var i = 0; i < s.perPerson; i++)
                            Container(
                              width: 11,
                              height: 11,
                              margin: const EdgeInsets.symmetric(horizontal: 2),
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: i < left ? CollabColors.green : null,
                                border: i < left ? null : Border.all(color: const Color(0x59FFFFFF), width: 1.5),
                              ),
                            ),
                        ],
                      )
                    : Text(
                        '$left/${s.perPerson}',
                        key: const Key('collabVotesLeft'),
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
              ),
              if (s.endsAt != null) ...[
                const SizedBox(width: 8),
                Container(
                  key: const Key('collabVoteTime'),
                  constraints: const BoxConstraints(minWidth: 52),
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: s.endsAt! - now < 10000 ? CollabColors.pink : CollabColors.ink2,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    formatMs(s.endsAt! - now),
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 19,
                      fontWeight: FontWeight.w700,
                      fontFeatures: [FontFeature.tabularFigures()],
                    ),
                  ),
                ),
              ],
            ],
            const SizedBox(width: 8),
            if (live)
              if (mod.can)
                Tooltip(
                  message: tip ?? '',
                  child: CollabPillButton(
                    key: const Key('collabVoteEnd'),
                    label: 'Beenden',
                    green: true,
                    onPressed: () =>
                        unawaited(ui.controller.act('collab.vote.end', const {}, label: 'Abstimmung beenden')),
                  ),
                )
              else
                const SizedBox.shrink()
            else ...[
              CollabPillButton(
                key: const Key('collabVoteResult'),
                label: 'Ergebnis',
                green: true,
                onPressed: () => unawaited(showVoteResults(context, ui, id: s.id)),
              ),
              if (mod.can) ...[
                const SizedBox(width: 6),
                CollabPillButton(
                  key: const Key('collabVoteClose'),
                  label: 'Schließen',
                  onPressed: () =>
                      unawaited(ui.controller.act('collab.vote.close', const {}, label: 'Abstimmung schließen')),
                ),
              ],
            ],
          ],
        ),
      );
    },
  );
}

// ---- result (L10) ------------------------------------------------------------------------------------------------------

/// Sheet „Ergebnis“ (web `VoteResultsDialog`): the vote [id] (running/last or from the archive; none = the newest).
Future<void> showVoteResults(BuildContext context, BoardUi ui, {String? id}) => ui.openSheet<void>(
  context,
  (context) => _VoteResults(ui: ui, wanted: id),
  closeOnSelectionChange: false,
  scrollControlled: true,
);

class _VoteResults extends StatefulWidget {
  const _VoteResults({required this.ui, this.wanted});
  final BoardUi ui;
  final String? wanted;

  @override
  State<_VoteResults> createState() => _VoteResultsState();
}

class _VoteResultsState extends State<_VoteResults> {
  late String? _wanted = widget.wanted;
  bool _historyOpen = false;
  BoardUi get ui => widget.ui;

  void _close() {
    final s = VoteRuntime.of(ui).read().session;
    if (s != null) CollabSession.of(ui).resultsDismissed = s.id;
    Navigator.of(context).maybePop();
  }

  @override
  void dispose() {
    final s = VoteRuntime.of(ui).read().session;
    if (s != null) CollabSession.of(ui).resultsDismissed = s.id;
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: ui.controller,
    builder: (context, _) {
      final t = ui.theme;
      final v = VoteRuntime.of(ui).read();
      final s = v.session;
      final state = ui.controller.state;
      VoteResult? current;
      VoteSession? currentSession;
      if (s != null && (_wanted == null || _wanted == s.id)) {
        final r = tally(v.votes, s.id, exists: (id) => state[id] != null);
        current = VoteResult(id: s.id, title: s.title, at: '', voters: r.voters, total: r.total, ranking: r.ranking);
        currentSession = s;
      } else {
        current = v.history.where((h) => h.id == _wanted).firstOrNull ?? v.history.firstOrNull;
      }
      if (current == null) {
        return Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          child: Column(
            key: const Key('collabVoteResults'),
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Abstimmungen', style: t.label(size: 20)),
              const SizedBox(height: 10),
              const Text('Noch keine Ergebnisse. Starte eine Abstimmung über den Knopf oben rechts.'),
              const SizedBox(height: 12),
              Align(
                alignment: Alignment.centerRight,
                child: FilledButton(onPressed: _close, child: const Text('OK')),
              ),
            ],
          ),
        );
      }
      final cur = current;
      final maxVotes = math.max(1, cur.ranking.fold(0, (a, r) => math.max(a, r.votes)));
      final mod = canModerate(ui, s);
      final names = currentSession != null && !currentSession.anonymous
          ? voterNames(v.votes, v.names, currentSession.id)
          : null;
      final older = v.history.where((h) => h.id != cur.id).toList();
      return SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.85),
          child: ListView(
            key: const Key('collabVoteResults'),
            shrinkWrap: true,
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            children: [
              Text('Ergebnis', style: t.label(size: 20)),
              const SizedBox(height: 8),
              Text(cur.title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
              Text(
                '${cur.voters} ${cur.voters == 1 ? 'Person' : 'Personen'} · ${cur.total} ${cur.total == 1 ? 'Stimme' : 'Stimmen'}'
                '${currentSession != null && !currentSession.ended ? ' · läuft noch' : ''}',
                key: const Key('collabVoteMeta'),
                style: TextStyle(color: t.grey),
              ),
              const SizedBox(height: 10),
              if (cur.ranking.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Text('Es wurde keine Stimme abgegeben.', style: TextStyle(color: t.grey)),
                )
              else
                for (final r in cur.ranking) _rankRow(context, r, maxVotes, names?[r.objectId]),
              if (older.isNotEmpty) ...[
                const SizedBox(height: 8),
                ListTile(
                  key: const Key('collabVoteHistory'),
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Frühere Abstimmungen', style: TextStyle(fontWeight: FontWeight.w600)),
                  trailing: Icon(_historyOpen ? Icons.expand_less : Icons.expand_more),
                  onTap: () => setState(() => _historyOpen = !_historyOpen),
                ),
                if (_historyOpen)
                  for (final h in older)
                    ListTile(
                      key: ValueKey('collabVoteOld-${h.id}'),
                      dense: true,
                      title: Text(h.title),
                      trailing: Text(_shortDate(h.at), style: TextStyle(color: t.grey)),
                      onTap: () => setState(() {
                        _wanted = h.id;
                        _historyOpen = false;
                      }),
                    ),
              ],
              const SizedBox(height: 12),
              Wrap(
                alignment: WrapAlignment.end,
                spacing: 8,
                runSpacing: 8,
                children: [
                  if (mod.can && currentSession != null && currentSession.ended)
                    TextButton(
                      key: const Key('collabVoteCloseResults'),
                      onPressed: () {
                        unawaited(ui.controller.act('collab.vote.close', const {}, label: 'Abstimmung schließen'));
                        Navigator.of(context).maybePop();
                      },
                      child: const Text('Abstimmung schließen'),
                    ),
                  FilledButton(key: const Key('collabVoteDone'), onPressed: _close, child: const Text('Fertig')),
                ],
              ),
            ],
          ),
        ),
      );
    },
  );

  Widget _rankRow(BuildContext context, Ranked r, int max, List<String>? who) {
    final o = ui.controller.state[r.objectId];
    final top = r.rank == 1;
    return InkWell(
      key: ValueKey('collabRank-${r.objectId}'),
      onTap: o == null
          ? null
          : () {
              _close();
              ui.editor.select({o.id});
              final b = objectRect(o);
              flyTo(ui, b.center, minZoomTo: 0.6);
            },
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(
          children: [
            SizedBox(
              width: 32,
              child: top
                  ? const Icon(Icons.emoji_events_outlined, size: 20)
                  : Text(
                      '${r.rank}',
                      textAlign: TextAlign.center,
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
            ),
            const SizedBox(width: 6),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(voteObjectLabel(ui, o), maxLines: 1, overflow: TextOverflow.ellipsis),
                  if (who != null && who.isNotEmpty)
                    Text(who.join(', '), style: TextStyle(fontSize: 12, color: ui.theme.grey)),
                  const SizedBox(height: 3),
                  LayoutBuilder(
                    builder: (context, c) => Container(
                      height: 5,
                      width: c.maxWidth * r.votes / max,
                      decoration: BoxDecoration(
                        color: top ? CollabColors.green : CollabColors.blue,
                        borderRadius: BorderRadius.circular(3),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 10),
            Text('${r.votes}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
          ],
        ),
      ),
    );
  }
}

/// „2. Nov.“ like `toLocaleDateString('de-DE', {day: 'numeric', month: 'short'})`.
String _shortDate(String iso) {
  final d = DateTime.tryParse(iso)?.toLocal();
  if (d == null) return '';
  const months = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sept.', 'Okt.', 'Nov.', 'Dez.'];
  return '${d.day}. ${months[d.month - 1]}';
}
