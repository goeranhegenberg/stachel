import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../editor/registry/board_ui.dart';
import '../../editor/ui/board_overlays.dart' show BoardTopSlot;
import '../../render/board_scene.dart' show objectRect;
import '../follow/collab_common.dart';
import 'private_model.dart';

// Views of the private mode (docs/features/private.md §1, §3 – same parts as the web module `private`): grey
// placeholders of the others' hidden objects, the lock chip „Nur für dich“ at own private objects, the hint band with
// „Aufdecken“ / „Meine aufdecken“, the countdown in the middle for everybody and the sheet „Privater Modus“.

/// Countdown of „Aufdecken“ (seconds, like the web).
const privateRevealCountdown = 3;

/// Grey of the placeholders.
const _placeholderFill = Color(0xFFE4E1E7);
const _placeholderLine = Color(0xFFB9B3BF);
const _placeholderInk = Color(0xFF6B6471);

/// Placeholders of the others' private objects (overlay `private.placeholders`): grey rounded area where and as big
/// as the object, a lock and the author's name (none when anonymous). Never hit: taps go to the board below.
class PrivatePlaceholderLayer extends StatefulWidget {
  const PrivatePlaceholderLayer({super.key, required this.ui});
  final BoardUi ui;

  @override
  State<PrivatePlaceholderLayer> createState() => _PrivatePlaceholderLayerState();
}

class _PrivatePlaceholderLayerState extends State<PrivatePlaceholderLayer> {
  BoardUi get ui => widget.ui;

  @override
  Widget build(BuildContext context) {
    final view = ui.view;
    if (view == null) return const SizedBox.shrink();
    return ListenableBuilder(
      listenable: Listenable.merge([ui.controller, view.camera]),
      builder: (context, _) {
        final items = hiddenOfOthers(ui);
        if (items.isEmpty) return const SizedBox.shrink();
        final cam = view.camera.value;
        final visible = cam.viewRect(view.viewSize).inflate(200);
        final anonymous = privateModeOf(ui).anonymous;
        final session = PrivateSession.of(ui);
        return IgnorePointer(
          key: const Key('privatePlaceholders'),
          child: Stack(
            children: [
              for (final h in items)
                if (h.type != 'connector' && h.rect.overlaps(visible))
                  _placeholder(
                    h,
                    cam.rectToScreen(h.rect),
                    cam.z,
                    anonymous || h.by == null
                        ? null
                        : session.nameOf(
                            h.by!,
                            loaded: () {
                              if (mounted) setState(() {});
                            },
                          ),
                  ),
            ],
          ),
        );
      },
    );
  }

  Widget _placeholder(HiddenItem h, Rect r, double z, String? name) {
    final side = math.min(r.width, r.height);
    final icon = (side * 0.28).clamp(10.0, 28.0);
    final font = (13 * z).clamp(9.0, 14.0);
    return Positioned.fromRect(
      rect: r,
      child: Transform.rotate(
        angle: h.rotation * math.pi / 180,
        child: Container(
          key: Key('privatePlaceholder-${h.id}'),
          decoration: BoxDecoration(
            color: _placeholderFill,
            borderRadius: BorderRadius.circular((10 * z).clamp(3.0, 12.0)),
            border: Border.all(color: _placeholderLine, width: 1.5),
          ),
          child: side < 14
              ? null
              : Center(
                  child: Padding(
                    padding: const EdgeInsets.all(4),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.lock_outline, size: icon, color: _placeholderInk),
                        if (name != null && side >= 48)
                          Padding(
                            padding: const EdgeInsets.only(top: 2),
                            child: Text(
                              name,
                              key: Key('privatePlaceholderName-${h.id}'),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              textAlign: TextAlign.center,
                              style: TextStyle(color: _placeholderInk, fontSize: font, fontWeight: FontWeight.w600),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
        ),
      ),
    );
  }
}

/// „Nur für dich“ above each own private object (overlay `private.lock`; only the lock when the object is small).
class PrivateLockChips extends StatelessWidget {
  const PrivateLockChips({super.key, required this.ui});
  final BoardUi ui;

  @override
  Widget build(BuildContext context) {
    final view = ui.view;
    if (view == null) return const SizedBox.shrink();
    return ListenableBuilder(
      listenable: Listenable.merge([ui.controller, view.camera]),
      builder: (context, _) {
        final ids = ownPrivateIds(ui);
        if (ids.isEmpty) return const SizedBox.shrink();
        final cam = view.camera.value;
        final visible = cam.viewRect(view.viewSize);
        return IgnorePointer(
          child: Stack(
            children: [
              for (final id in ids)
                if (ui.controller.state[id] case final o? when objectRect(o).overlaps(visible))
                  Positioned(
                    left: cam.toScreen(Offset(o.x, o.y)).dx,
                    bottom: view.viewSize.height - cam.toScreen(Offset(o.x, o.y)).dy + 3,
                    child: _LockChip(id: id, short: o.w * cam.z < 96),
                  ),
            ],
          ),
        );
      },
    );
  }
}

class _LockChip extends StatelessWidget {
  const _LockChip({required this.id, required this.short});
  final String id;
  final bool short;

  @override
  Widget build(BuildContext context) => Container(
    key: Key('privateLock-$id'),
    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
    decoration: BoxDecoration(color: const Color(0xE0161118), borderRadius: BorderRadius.circular(6)),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(Icons.lock, size: 12, color: Colors.white),
        if (!short) ...[
          const SizedBox(width: 4),
          const Text(
            'Nur für dich',
            style: TextStyle(color: Colors.white, fontSize: 11.5, height: 16 / 11.5, fontWeight: FontWeight.w600),
          ),
        ],
      ],
    ),
  );
}

/// The hint band while the mode runs (overlay `private.banner`): „Privater Modus · Deine neuen Notizen sieht nur du ·
/// N verdeckt“ with „Aufdecken“ (facilitator, owner, or anybody when the facilitator is gone) / „Abbrechen“ during
/// the countdown and „Meine aufdecken“ (`ownReveal`).
class PrivateBanner extends StatefulWidget {
  const PrivateBanner({super.key, required this.ui});
  final BoardUi ui;

  @override
  State<PrivateBanner> createState() => _PrivateBannerState();
}

class _PrivateBannerState extends State<PrivateBanner> {
  BoardUi get ui => widget.ui;

  Future<void> _run(String action, [Map<String, Object?> args = const {}]) async {
    setState(() {});
    await PrivateSession.of(ui).run(action, args);
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) => BoardTopSlot(
    // in the column on top (UX-Review P2) like the search, the vote bar and the timer: the minimap button on the
    // phone sits below it instead of covering it
    ui: ui,
    order: BoardTopSlot.privateOrder,
    child: ListenableBuilder(listenable: ui.controller, builder: _band),
  );

  Widget _band(BuildContext context, Widget? _) {
    final m = privateModeOf(ui);
    if (!m.on) return const SizedBox.shrink();
    final hidden = hiddenOfOthers(ui).length;
    final host = privateHost(ui) != null;
    final busy = PrivateSession.of(ui).busy;
    final counting = countdownLeft(ui, m) != null;
    final all = host && canRevealAll(ui, m);
    final own = host && !counting && canRevealOwn(ui, m);
    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 560),
      child: CollabPill(
        key: const Key('privateBanner'),
        ring: const Color(0xFF8E7CC3),
        radius: 16,
        padding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                const Icon(Icons.lock_outline, size: 18),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Privater Modus · Deine neuen Notizen sieht nur du · $hidden verdeckt',
                    key: const Key('privateBannerText'),
                    style: const TextStyle(fontSize: 13, height: 1.25),
                  ),
                ),
              ],
            ),
            if (own || all)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Wrap(
                  alignment: WrapAlignment.end,
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    if (own)
                      CollabPillButton(
                        key: const Key('privateRevealOwn'),
                        label: 'Meine aufdecken',
                        onPressed: busy ? null : () => unawaited(_run('revealOwn')),
                      ),
                    if (all && counting)
                      CollabPillButton(
                        key: const Key('privateCancel'),
                        label: 'Abbrechen',
                        onPressed: busy ? null : () => unawaited(_run('cancel')),
                      ),
                    if (all && !counting)
                      CollabPillButton(
                        key: const Key('privateReveal'),
                        label: 'Aufdecken',
                        green: true,
                        onPressed: busy ? null : () => unawaited(_run('reveal', {'countdown': privateRevealCountdown})),
                      ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// „3 – 2 – 1“ big in the middle for everybody while the reveal countdown runs (overlay `private.countdown`).
class PrivateCountdown extends StatefulWidget {
  const PrivateCountdown({super.key, required this.ui});
  final BoardUi ui;

  @override
  State<PrivateCountdown> createState() => _PrivateCountdownState();
}

class _PrivateCountdownState extends State<PrivateCountdown> {
  Timer? _tick;

  BoardUi get ui => widget.ui;

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  void _ticking(bool on) {
    if (on && _tick == null) {
      _tick = Timer.periodic(const Duration(milliseconds: 100), (_) {
        if (mounted) setState(() {});
      });
    } else if (!on && _tick != null) {
      _tick!.cancel();
      _tick = null;
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: ui.controller,
    builder: (context, _) {
      final left = countdownLeft(ui);
      // keep ticking while a countdown is announced (it ends by itself, the server's patch ends the mode)
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _ticking(countdownLeft(ui) != null);
      });
      if (left == null) return const SizedBox.shrink();
      return IgnorePointer(
        child: Center(
          child: Container(
            key: const Key('privateCountdown'),
            width: 148,
            height: 148,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: CollabColors.ink.withValues(alpha: 0.86),
              shape: BoxShape.circle,
              border: Border.all(color: const Color(0xFF8E7CC3), width: 3),
            ),
            child: Text(
              '$left',
              key: const Key('privateCountdownValue'),
              style: const TextStyle(color: Colors.white, fontSize: 76, fontWeight: FontWeight.w800, height: 1),
            ),
          ),
        ),
      );
    },
  );
}

/// Sheet „Privater Modus“ (board menu): „Namen anonym“, „Jede:r darf eigene aufdecken“, „Starten“.
Future<void> showPrivateStart(BuildContext context, BoardUi ui) => ui.openSheet<void>(
  context,
  (context) => _PrivateStart(ui: ui),
  closeOnSelectionChange: false,
  scrollControlled: true,
);

class _PrivateStart extends StatefulWidget {
  const _PrivateStart({required this.ui});
  final BoardUi ui;

  @override
  State<_PrivateStart> createState() => _PrivateStartState();
}

class _PrivateStartState extends State<_PrivateStart> {
  bool _anonymous = false;
  bool _ownReveal = false;
  bool _busy = false;

  Future<void> _start() async {
    setState(() => _busy = true);
    final ok = await PrivateSession.of(widget.ui).run('start', {'anonymous': _anonymous, 'ownReveal': _ownReveal});
    if (!mounted) return;
    if (ok) {
      Navigator.of(context).pop();
    } else {
      setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.ui.theme;
    return SafeArea(
      child: Padding(
        key: const Key('privateStartSheet'),
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('PRIVATER MODUS', style: t.label(size: 15)),
            const SizedBox(height: 8),
            Text(
              'Neue Haftnotizen, Texte und Formen sieht nur, wer sie anlegt. Alle anderen sehen an der Stelle einen '
              'grauen Platzhalter – bis du aufdeckst.',
              style: TextStyle(color: t.grey, fontSize: 14),
            ),
            const SizedBox(height: 8),
            SwitchListTile(
              key: const Key('privateAnonymous'),
              contentPadding: EdgeInsets.zero,
              title: const Text('Namen anonym'),
              subtitle: const Text('Platzhalter und aufgedeckte Notizen ohne Namen'),
              value: _anonymous,
              onChanged: _busy ? null : (v) => setState(() => _anonymous = v),
            ),
            SwitchListTile(
              key: const Key('privateOwnReveal'),
              contentPadding: EdgeInsets.zero,
              title: const Text('Jede:r darf eigene aufdecken'),
              value: _ownReveal,
              onChanged: _busy ? null : (v) => setState(() => _ownReveal = v),
            ),
            const SizedBox(height: 8),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                key: const Key('privateStart'),
                icon: const Icon(Icons.lock_outline),
                label: const Text('STARTEN'),
                onPressed: _busy ? null : () => unawaited(_start()),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
