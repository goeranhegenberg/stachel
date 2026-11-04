import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../editor/board_editor.dart';
import '../../editor/camera.dart';
import '../../editor/registry/board_ui.dart';
import '../../model/board_object.dart';
import '../../protocol/native_messages.dart';
import '../../render/board_scene.dart';
import '../view/board_prefs.dart';
import '../view/view_camera.dart';
import '../view/view_state.dart';
import 'frames_model.dart';

// Presentation (H03–H05, H08; web editor/interaction/Frames.tsx PresentBar, Editor.tsx goFrame/startPresent,
// features/structure/frames/present.ts): frames one after another, fitted above the bar (max 400 %), swipe or tap the
// outer thirds to page, fullscreen (immersive, remembered), „Andere folgen lassen“ (`structure.present`), the camera
// returns afterwards. Viewers see who presents and can follow.

/// Awareness field of the presenting person (web `PRESENT_FIELD`): `{frameId, index, total, title, from?}` (`from` =
/// clientId of the person who handed the presentation over, docs/features/private.md §7).
const presentField = 'structure.present';

/// Awareness field of a handover offer (docs/features/private.md §7): `{to: <user key>, id, index, frameId}`.
const handoverField = 'structure.handover';

/// Speaker notes of a frame (plain text, empty = none).
String frameNotes(BoardObject f) {
  final n = f.raw['notes'];
  return n is String ? n.trim() : '';
}

/// Minimum swipe on the phone (web `SWIPE_PX`).
const swipePx = 50.0;

/// A new id of a handover offer (12 characters of `[A-Za-z0-9_-]`, the contract allows ≤ 16).
String handoverId() {
  const alphabet = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';
  final r = math.Random();
  return String.fromCharCodes(List.generate(12, (_) => alphabet.codeUnitAt(r.nextInt(64))));
}

/// The running presentation of a board screen (one per [BoardUi]).
class Presentation extends ChangeNotifier {
  Presentation._(this.ui) {
    ui.controller.addListener(_boardChanged);
  }
  final BoardUi ui;

  static final _of = Expando<Presentation>('Presentation');
  static Presentation of(BoardUi ui) => _of[ui] ??= Presentation._(ui);

  /// Current frame (null = not presenting).
  int? index;

  /// Others may follow (web: on by default).
  bool share = true;

  /// The presentation was handed over to me by the client [handedFrom] (`structure.present.from`).
  int? handedFrom;

  /// My open handover offer (`structure.handover`) and the name of the person it goes to.
  Map<String, Object?>? offer;
  String? offerName;

  /// Speaker notes shown over the bar.
  bool notesOpen = false;

  /// Client whose presentation I follow (null = none); the layer „Mara präsentiert“ and a handover set it.
  int? following;

  Camera? _before;
  bool _ownFullscreen = false;
  String? _frameId;

  bool get running => index != null;

  List<BoardObject> get frames => framesInOrderWeb(ui.controller.state.ordered);

  BoardObject? get frame {
    final i = index;
    final list = frames;
    return i == null || list.isEmpty ? null : list[i.clamp(0, list.length - 1)];
  }

  /// „Präsentieren“ (from 0) / „Ab hier präsentieren“ ([from]); [handedFrom] = taken over from that client.
  void start(int from, {int? handedFrom}) {
    if (frames.isEmpty) return;
    this.handedFrom = handedFrom;
    following = null;
    notesOpen = false;
    _before = ui.view?.camera.value;
    final v = ui.view;
    if (ui.editor.editingId != null) v?.finishEditing();
    ui.editor
      ..select(const {})
      ..tool = BoardTool.select;
    ui.presenting.value = true;
    if (BoardPrefs.get(BoardPrefs.presentFullscreen) != '0' && !BoardViewPrefs.of(ui).immersive.value) {
      _ownFullscreen = true;
      BoardViewPrefs.of(ui).setImmersive(true);
    }
    go(from);
  }

  /// Shows frame [i] (clamped) fitted above the bar.
  void go(int i, {bool animate = true}) {
    final list = frames;
    if (list.isEmpty) return stop();
    final idx = i.clamp(0, list.length - 1);
    index = idx;
    _frameId = list[idx].id;
    fit(animate: animate);
    _publish();
    // an open offer hands over the frame shown now
    final o = offer;
    if (o != null) _setOffer({...o, 'index': idx, 'frameId': _frameId});
    notifyListeners();
  }

  void next() => go((index ?? -1) + 1);
  void previous() => go((index ?? 1) - 1);

  /// View size the current frame was last fitted for (the bars disappear when the presentation starts).
  Size? fittedFor;

  /// Fits the current frame (again, e.g. after turning the phone).
  void fit({bool animate = true}) {
    final f = frame, v = ui.view;
    if (f == null || v == null || v.viewSize == Size.zero) return;
    fittedFor = v.viewSize;
    final cam = Camera.fit(objectRect(f), v.viewSize, padding: presentInsets, maxZoomFit: maxZoom);
    if (animate) {
      BoardViewPrefs.of(ui).animateCamera(cam);
    } else {
      v.camera.value = cam;
    }
  }

  /// Ends the presentation; the camera returns unless [restoreCamera] is false (handed over: I follow the new one).
  void stop({bool restoreCamera = true}) {
    if (!running) return;
    index = null;
    _frameId = null;
    handedFrom = null;
    notesOpen = false;
    if (offer != null) _setOffer(null);
    ui.presenting.value = false;
    ui.controller.presence.setExtra(presentField, null, immediate: true);
    if (_ownFullscreen) {
      _ownFullscreen = false;
      BoardViewPrefs.of(ui).setImmersive(false);
    }
    final b = _before;
    _before = null;
    if (b != null && restoreCamera) BoardViewPrefs.of(ui).animateCamera(b);
    notifyListeners();
  }

  // ---- handover (docs/features/private.md §7) --------------------------------------------------------------------

  /// „Übergeben an …“ [to]: offers the presentation from the current frame (a new id per offer).
  void offerTo(Peer to) {
    final f = frame;
    if (!running || f == null) return;
    offerName = to.name;
    _setOffer({'to': to.key, 'id': handoverId(), 'index': index, 'frameId': f.id});
    notifyListeners();
  }

  /// „Zurückziehen“.
  void withdraw() {
    if (offer == null) return;
    _setOffer(null);
    notifyListeners();
  }

  void _setOffer(Map<String, Object?>? o) {
    offer = o;
    if (o == null) offerName = null;
    ui.controller.presence.setExtra(handoverField, o, immediate: true);
  }

  /// „Übernehmen“ of [from]'s [offer]: present from the offered frame (by id, else by index) as the new presenter.
  void accept(Peer from, Map offer) {
    final list = frames;
    if (list.isEmpty) return;
    final at = list.indexWhere((f) => f.id == offer['frameId']);
    final i = at >= 0 ? at : ((offer['index'] as num?)?.toInt() ?? 0);
    start(i, handedFrom: from.id);
  }

  /// Speaker notes over the bar on/off (only the presenting person sees them).
  void toggleNotes() {
    notesOpen = !notesOpen;
    notifyListeners();
  }

  /// Somebody took my offer (`structure.present.from` = my client): stop and follow them.
  bool _handedOver() {
    final o = offer, me = ui.controller.clientId;
    if (!running || o == null || me == null) return false;
    for (final p in ui.controller.peers) {
      final s = p.extra[presentField];
      if (p.key == o['to'] && s is Map && s['from'] == me && s['frameId'] is String) {
        stop(restoreCamera: false);
        following = p.id;
        notifyListeners();
        return true;
      }
    }
    return false;
  }

  /// Fullscreen button of the bar: remembered for the next presentation (web `remember`).
  void toggleFullscreen() {
    final vs = BoardViewPrefs.of(ui);
    final on = !vs.immersive.value;
    BoardPrefs.set(BoardPrefs.presentFullscreen, on ? '1' : '0');
    _ownFullscreen = on;
    vs.setImmersive(on);
    notifyListeners();
  }

  void toggleShare() {
    share = !share;
    _publish();
    notifyListeners();
  }

  void _publish() {
    final f = frame;
    ui.controller.presence.setExtra(
      presentField,
      share && f != null
          ? {'frameId': f.id, 'index': index, 'total': frames.length, 'title': frameTitle(f), 'from': ?handedFrom}
          : null,
      immediate: true,
    );
  }

  /// Frames changed (reordered, renamed, deleted): stay on the shown frame, update what the others see. Others
  /// changed: my offer was taken.
  void _boardChanged() {
    if (!running) return;
    if (_handedOver()) return;
    final list = frames;
    if (list.isEmpty) return stop();
    final at = list.indexWhere((f) => f.id == _frameId);
    if (at >= 0 && at != index) index = at;
    if (index! >= list.length) index = list.length - 1;
    _frameId = list[index!].id;
    _publish();
    notifyListeners();
  }

  @override
  void dispose() {
    ui.controller.removeListener(_boardChanged);
    super.dispose();
  }
}

/// Bar and touch paging while presenting (overlay with `presenting`): it takes every touch on the board – no editing.
class PresentLayer extends StatefulWidget {
  const PresentLayer({super.key, required this.ui});
  final BoardUi ui;

  @override
  State<PresentLayer> createState() => _PresentLayerState();
}

class _PresentLayerState extends State<PresentLayer> {
  late final Presentation p = Presentation.of(widget.ui);
  Offset? _down;
  int _pointers = 0;
  bool _multi = false;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: Listenable.merge([p, BoardViewPrefs.of(widget.ui).immersive]),
    builder: (context, _) {
      if (!p.running) return const SizedBox.shrink();
      return LayoutBuilder(
        builder: (context, c) {
          final size = c.biggest;
          // the view changed size (bars gone, phone turned): fit the frame again, after the view's own adjustment
          WidgetsBinding.instance.addPostFrameCallback((_) {
            final v = widget.ui.view;
            if (mounted && p.running && v != null && p.fittedFor != v.viewSize) p.fit();
          });
          return PopScope(
            canPop: false,
            onPopInvokedWithResult: (didPop, _) {
              if (!didPop) p.stop();
            },
            child: Stack(
              children: [
                Positioned.fill(
                  child: Listener(
                    key: const Key('stachelPresentTouch'),
                    behavior: HitTestBehavior.opaque,
                    onPointerDown: (e) {
                      _pointers++;
                      if (_pointers > 1) _multi = true;
                      _down ??= e.localPosition;
                    },
                    onPointerUp: (e) => _up(e.localPosition, size),
                    onPointerCancel: (_) => _reset(),
                  ),
                ),
                Positioned(left: 8, right: 8, bottom: 8, child: _bar()),
              ],
            ),
          );
        },
      );
    },
  );

  void _reset() {
    _pointers = 0;
    _multi = false;
    _down = null;
  }

  /// Web Editor.tsx `case 'swipe'`: ≥ 50 px sideways (and clearly more than up/down) pages, a tap (< 10 px) in the
  /// right third goes on, in the left third back.
  void _up(Offset at, Size size) {
    _pointers = (_pointers - 1).clamp(0, 10);
    final d = _down;
    if (_pointers > 0) return;
    final multi = _multi;
    _reset();
    if (d == null || multi) return;
    final dx = at.dx - d.dx, dy = at.dy - d.dy;
    if (dx.abs() >= swipePx && dx.abs() > dy.abs() * 1.5) {
      dx < 0 ? p.next() : p.previous();
    } else if ((at - d).distance < 10 && at.dx > size.width * 2 / 3) {
      p.next();
    } else if ((at - d).distance < 10 && at.dx < size.width / 3) {
      p.previous();
    }
  }

  /// „Übergeben an …“: the people present (one row per person).
  Future<void> _pickHandover(List<Peer> others) async {
    final ui = widget.ui;
    final picked = await ui.openSheet<Peer>(
      context,
      (ctx) => SafeArea(
        child: Column(
          key: const Key('stachelHandoverSheet'),
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Text('PRÄSENTATION ÜBERGEBEN AN', style: ui.theme.label(size: 15)),
            ),
            for (final o in others)
              ListTile(
                key: Key('stachelHandoverTo-${o.key}'),
                leading: const Icon(Icons.person_outline),
                title: Text(o.name.isEmpty ? 'Unbekannt' : o.name),
                onTap: () => Navigator.of(ctx).pop(o),
              ),
            const SizedBox(height: 8),
          ],
        ),
      ),
      closeOnSelectionChange: false,
    );
    if (picked != null && mounted) p.offerTo(picked);
  }

  Widget _bar() {
    final ui = widget.ui;
    final t = ui.theme;
    final f = p.frame;
    final n = p.frames.length, i = p.index ?? 0;
    final full = BoardViewPrefs.of(ui).immersive.value;
    final notes = f == null ? '' : frameNotes(f);
    final others = handoverCandidates(ui);
    Widget btn(String key, IconData icon, String label, VoidCallback? onTap, {bool active = false}) => IconButton(
      key: Key(key),
      tooltip: label,
      onPressed: onTap,
      isSelected: active,
      icon: Icon(icon),
      color: active ? t.accent : t.ink,
    );
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 560),
        child: Material(
          key: const Key('stachelPresentBar'),
          color: t.surface,
          elevation: 4,
          shape: RoundedRectangleBorder(side: BorderSide(color: t.ink, width: 2)),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (p.notesOpen && notes.isNotEmpty)
                ConstrainedBox(
                  constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.3),
                  child: SingleChildScrollView(
                    key: const Key('stachelPresentNotesPanel'),
                    padding: const EdgeInsets.fromLTRB(14, 10, 14, 6),
                    child: SizedBox(
                      width: double.infinity,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('SPRECHERNOTIZEN · NUR FÜR DICH', style: t.label(size: 12, color: t.grey)),
                          const SizedBox(height: 4),
                          Text(
                            notes,
                            key: const Key('stachelPresentNotesText'),
                            style: TextStyle(color: t.ink, fontSize: 15, height: 1.35),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              if (p.notesOpen && notes.isNotEmpty) Divider(height: 1, color: t.grey.withValues(alpha: 0.3)),
              if (p.offer != null)
                Container(
                  key: const Key('stachelPresentOffer'),
                  color: t.grey.withValues(alpha: 0.1),
                  padding: const EdgeInsets.only(left: 14),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          'Angeboten an ${p.offerName ?? 'eine Person'} …',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(color: t.ink, fontSize: 13),
                        ),
                      ),
                      TextButton(
                        key: const Key('stachelPresentWithdraw'),
                        onPressed: p.withdraw,
                        child: const Text('Zurückziehen'),
                      ),
                    ],
                  ),
                ),
              Row(
                children: [
                  btn('stachelPresentPrev', Icons.chevron_left, 'Vorheriger Rahmen', i <= 0 ? null : p.previous),
                  Text('${i + 1} / $n', key: const Key('stachelPresentPos'), style: t.label(size: 14)),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      f == null ? 'Rahmen' : frameTitle(f),
                      key: const Key('stachelPresentTitle'),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  btn('stachelPresentNext', Icons.chevron_right, 'Nächster Rahmen', i >= n - 1 ? null : p.next),
                  btn(
                    'stachelPresentShare',
                    Icons.cast,
                    p.share ? 'Andere können folgen' : 'Nur für mich',
                    p.toggleShare,
                    active: p.share,
                  ),
                  btn(
                    'stachelPresentFullscreen',
                    full ? Icons.fullscreen_exit : Icons.fullscreen,
                    'Vollbild',
                    p.toggleFullscreen,
                    active: full,
                  ),
                  btn('stachelPresentExit', Icons.close, 'Präsentation beenden', p.stop),
                ],
              ),
              if (notes.isNotEmpty || others.isNotEmpty)
                SizedBox(
                  width: double.infinity,
                  child: Wrap(
                    alignment: WrapAlignment.spaceBetween,
                    children: [
                      if (notes.isNotEmpty)
                        TextButton.icon(
                          key: const Key('stachelPresentNotes'),
                          onPressed: p.toggleNotes,
                          icon: Icon(p.notesOpen ? Icons.expand_more : Icons.expand_less, size: 18),
                          label: const Text('Notizen'),
                          style: TextButton.styleFrom(foregroundColor: t.ink),
                        ),
                      if (others.isNotEmpty)
                        TextButton.icon(
                          key: const Key('stachelPresentHandover'),
                          onPressed: () => _pickHandover(others),
                          icon: const Icon(Icons.switch_account_outlined, size: 18),
                          label: const Text('Übergeben an …'),
                          style: TextButton.styleFrom(foregroundColor: t.ink),
                        ),
                    ],
                  ),
                ),
              LinearProgressIndicator(
                key: const Key('stachelPresentProgress'),
                value: n == 0 ? 0 : (i + 1) / n,
                minHeight: 3,
                color: t.accent,
                backgroundColor: t.grey.withValues(alpha: 0.15),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// ---- following a presentation (H05, web frames.tsx FollowPresenter) -------------------------------------------------

/// The others on the board a presentation can be handed to: one per person, not me (needs presence `extra`).
List<Peer> handoverCandidates(BoardUi ui) {
  final c = ui.controller;
  if (!c.features.contains('extra')) return const [];
  final me = c.user?.key;
  final seen = <String>{};
  return [
    for (final p in c.peers)
      if (p.key != me && p.client != 'ai' && seen.add(p.key)) p,
  ];
}

/// Who presents (`structure.present` with a frame), with the raw state.
Iterable<({Peer peer, Map state})> presentersOf(BoardUi ui) sync* {
  for (final p in ui.controller.peers) {
    final s = p.extra[presentField];
    if (s is Map && s['frameId'] is String) yield (peer: p, state: s);
  }
}

/// „Mara präsentiert · 2/5 · Titel“ with „Folgen“; following fits every shown frame (max 400 %) and ends with the
/// presentation. A handover keeps it: when the followed person stops and someone presents with `from` = them, I
/// follow the new person.
class FollowPresenterLayer extends StatefulWidget {
  const FollowPresenterLayer({super.key, required this.ui});
  final BoardUi ui;

  @override
  State<FollowPresenterLayer> createState() => _FollowPresenterLayerState();
}

class _FollowPresenterLayerState extends State<FollowPresenterLayer> {
  String? _last;

  BoardUi get ui => widget.ui;
  Presentation get _p => Presentation.of(ui);

  ({Peer peer, Map state})? _presenter() {
    final all = presentersOf(ui).toList();
    if (all.isEmpty) return null;
    final f = _p.following;
    if (f != null) {
      for (final pr in all) {
        if (pr.peer.id == f) return pr;
      }
      // the followed person handed over: follow the one who took it
      for (final pr in all) {
        if (pr.state['from'] == f) {
          _p.following = pr.peer.id;
          _last = null;
          return pr;
        }
      }
    }
    return all.first;
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: Listenable.merge([ui.controller, _p]),
    builder: (context, _) {
      final pr = _presenter();
      if (pr == null) {
        if (_p.following != null) WidgetsBinding.instance.addPostFrameCallback((_) => _set(null));
        return const SizedBox.shrink();
      }
      final following = _p.following == pr.peer.id;
      if (following) _follow(pr.state);
      final s = pr.state;
      final idx = (s['index'] as num?)?.toInt() ?? 0, total = (s['total'] as num?)?.toInt() ?? 0;
      final t = ui.theme;
      return Align(
        alignment: Alignment.topCenter,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(8, 48, 8, 0),
          child: Material(
            key: const Key('stachelFollowPresenter'),
            color: following ? t.ink : t.surface,
            elevation: 3,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(22),
              side: BorderSide(color: t.ink, width: 1.5),
            ),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(14, 4, 4, 4),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Flexible(
                    child: Text(
                      '${pr.peer.name} präsentiert · ${idx + 1}/$total · ${s['title'] ?? 'Rahmen'}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(color: following ? Colors.white : t.ink, fontSize: 13),
                    ),
                  ),
                  TextButton.icon(
                    key: const Key('stachelFollowPresenterButton'),
                    onPressed: () => _set(following ? null : pr.peer.id),
                    icon: Icon(following ? Icons.visibility_off_outlined : Icons.visibility_outlined, size: 16),
                    label: Text(following ? 'Nicht mehr folgen' : 'Folgen'),
                    style: TextButton.styleFrom(foregroundColor: following ? Colors.white : t.accent),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
    },
  );

  void _set(int? id) {
    if (!mounted) return;
    setState(() {
      _p.following = id;
      _last = null;
    });
  }

  void _follow(Map state) {
    final f = ui.controller.state[state['frameId'] as String];
    if (f == null) return;
    final key = '${f.id}:${f.x}:${f.y}:${f.w}:${f.h}';
    if (_last == key) return;
    _last = key;
    WidgetsBinding.instance.addPostFrameCallback((_) => fitTo(ui, objectRect(f), maxZoomFit: maxZoom));
  }
}

// ---- handover offer to me (docs/features/private.md §7) -------------------------------------------------------------

/// „Mara möchte dir die Präsentation übergeben – Übernehmen / Ablehnen“ (overlay `structure.handover`): an offer of a
/// presenting person to my user key. „Übernehmen“ presents from the offered frame; „Ablehnen“ only closes the hint.
class HandoverNotice extends StatefulWidget {
  const HandoverNotice({super.key, required this.ui});
  final BoardUi ui;

  @override
  State<HandoverNotice> createState() => _HandoverNoticeState();
}

class _HandoverNoticeState extends State<HandoverNotice> {
  final _dismissed = <String>{};

  BoardUi get ui => widget.ui;

  ({Peer peer, Map offer})? _offer() {
    final me = ui.controller.user?.key;
    if (me == null || Presentation.of(ui).running) return null;
    for (final pr in presentersOf(ui)) {
      final o = pr.peer.extra[handoverField];
      if (o is Map && o['to'] == me && o['id'] is String && !_dismissed.contains('${pr.peer.id}:${o['id']}')) {
        return (peer: pr.peer, offer: o);
      }
    }
    return null;
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: Listenable.merge([ui.controller, Presentation.of(ui)]),
    builder: (context, _) {
      final o = _offer();
      if (o == null) return const SizedBox.shrink();
      final t = ui.theme;
      final name = o.peer.name.isEmpty ? 'Jemand' : o.peer.name;
      void dismiss() => setState(() => _dismissed.add('${o.peer.id}:${o.offer['id']}'));
      // under „Jonas präsentiert“ (the bottom belongs to zoom bar and context bar)
      return Align(
        alignment: Alignment.topCenter,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(8, 112, 8, 0),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 520),
            child: Material(
              key: const Key('stachelHandoverNotice'),
              color: t.ink,
              elevation: 4,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(14, 10, 8, 6),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '$name möchte dir die Präsentation übergeben',
                      key: const Key('stachelHandoverText'),
                      style: const TextStyle(color: Colors.white, fontSize: 14),
                    ),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        TextButton(
                          key: const Key('stachelHandoverDecline'),
                          onPressed: dismiss,
                          style: TextButton.styleFrom(foregroundColor: Colors.white),
                          child: const Text('Ablehnen'),
                        ),
                        const SizedBox(width: 4),
                        FilledButton(
                          key: const Key('stachelHandoverAccept'),
                          onPressed: () {
                            dismiss();
                            Presentation.of(ui).accept(o.peer, o.offer);
                          },
                          style: FilledButton.styleFrom(backgroundColor: t.accent),
                          child: const Text('Übernehmen'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      );
    },
  );
}
