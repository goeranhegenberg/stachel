import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../editor/registry/board_ui.dart';
import '../view/board_prefs.dart';

/// UX P5 (B5): a short introduction to the board's gestures on the first board opened on this device – four cards
/// with tiny animations (move/zoom, hold = grab, hold on the empty board + drag = select, two fingers = undo).
/// Skippable, shown once per device ([BoardPrefs] key [seenKey], kept by the app), opened again from the board menu
/// („Gesten-Einführung“).
abstract final class GestureOnboarding {
  /// Device setting: the introduction was seen (`'1'`).
  static const seenKey = 'stachel.onboarding.gestures';

  /// Show it by itself on the first board (tests of hosts switch it off). It also needs the device storage
  /// ([BoardPrefs.persist]) – without it „once per device“ cannot be kept, so it stays away.
  static bool autoShow = true;

  /// Shown in this app run already (the storage write may still be on its way).
  static bool _shownThisRun = false;

  static bool get seen => BoardPrefs.get(seenKey) != null;

  /// Whether the board of [ui] should show it now by itself.
  static bool due(BoardUi ui) =>
      autoShow &&
      !_shownThisRun &&
      BoardPrefs.persist != null &&
      !seen &&
      ui.controller.loaded &&
      ui.editor.editable &&
      !ui.presenting.value;

  /// Forget [_shownThisRun] (tests).
  static void resetForTest() => _shownThisRun = false;

  static const cards = [
    OnboardingCard(
      key: 'move',
      title: 'Ansicht bewegen',
      text: 'Mit einem Finger ziehen verschiebt die Ansicht. Mit zwei Fingern zoomen.',
    ),
    OnboardingCard(
      key: 'grab',
      title: 'Halten = greifen',
      text: 'Kurz auf einem Objekt halten, bis es vibriert – dann mit dem Finger verschieben.',
    ),
    OnboardingCard(
      key: 'select',
      title: 'Halten und ziehen = auswählen',
      text: 'Auf leerer Fläche halten und ziehen wählt alles im Rechteck aus. Oder „Mehrere wählen“ in der Leiste.',
    ),
    OnboardingCard(
      key: 'undo',
      title: 'Zwei Finger tippen = rückgängig',
      text: 'Mit zwei Fingern tippen macht den letzten Schritt rückgängig, mit drei Fingern stellt ihn wieder her.',
    ),
  ];
}

/// One card of the introduction.
class OnboardingCard {
  const OnboardingCard({required this.key, required this.title, required this.text});
  final String key;
  final String title;
  final String text;
}

/// Opens the introduction (from the board menu, or by itself via [GestureOnboardingTrigger]); marks it as seen when
/// it closes (skipped, finished or dismissed).
Future<void> showGestureOnboarding(BuildContext context, BoardUi ui) async {
  GestureOnboarding._shownThisRun = true;
  await showDialog<void>(
    context: context,
    barrierDismissible: true,
    builder: (ctx) => GestureOnboardingDialog(ui: ui),
  );
  BoardPrefs.set(GestureOnboarding.seenKey, '1');
}

/// Overlay that opens the introduction once the board is there ([GestureOnboarding.due]).
class GestureOnboardingTrigger extends StatefulWidget {
  const GestureOnboardingTrigger({super.key, required this.ui});
  final BoardUi ui;

  @override
  State<GestureOnboardingTrigger> createState() => _GestureOnboardingTriggerState();
}

class _GestureOnboardingTriggerState extends State<GestureOnboardingTrigger> {
  late final Listenable _watch = Listenable.merge([widget.ui.controller, widget.ui.editor, BoardPrefs.changes]);
  bool _scheduled = false;

  @override
  void initState() {
    super.initState();
    _watch.addListener(_check);
    _check();
  }

  @override
  void dispose() {
    _watch.removeListener(_check);
    super.dispose();
  }

  void _check() {
    if (_scheduled || !GestureOnboarding.due(widget.ui)) return;
    _scheduled = true;
    // after the frame that shows the board (it stays visible behind the cards)
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !GestureOnboarding.due(widget.ui)) {
        _scheduled = false;
        return;
      }
      unawaited(showGestureOnboarding(context, widget.ui));
    });
  }

  @override
  Widget build(BuildContext context) => const SizedBox.shrink();
}

/// The four cards: picture with a small looping animation (still with „weniger Bewegung“), title, text, page dots,
/// „Überspringen“ and „Weiter“ / „Los geht's“.
class GestureOnboardingDialog extends StatefulWidget {
  const GestureOnboardingDialog({super.key, required this.ui});
  final BoardUi ui;

  @override
  State<GestureOnboardingDialog> createState() => _GestureOnboardingDialogState();
}

class _GestureOnboardingDialogState extends State<GestureOnboardingDialog> with SingleTickerProviderStateMixin {
  final _pages = PageController();
  late final AnimationController _anim = AnimationController(vsync: this, duration: const Duration(milliseconds: 2600));
  int _page = 0;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final still = MediaQuery.maybeDisableAnimationsOf(context) ?? false;
    if (still) {
      _anim
        ..stop()
        ..value = 0.7;
    } else if (!_anim.isAnimating) {
      unawaited(_anim.repeat());
    }
  }

  @override
  void dispose() {
    _anim.dispose();
    _pages.dispose();
    super.dispose();
  }

  void _next() {
    if (_page >= GestureOnboarding.cards.length - 1) {
      Navigator.of(context).pop();
      return;
    }
    unawaited(_pages.nextPage(duration: const Duration(milliseconds: 250), curve: Curves.easeOut));
  }

  @override
  Widget build(BuildContext context) {
    final theme = widget.ui.theme;
    final cards = GestureOnboarding.cards;
    final last = _page == cards.length - 1;
    return Dialog(
      key: const Key('stachelOnboarding'),
      insetPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
      backgroundColor: theme.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: theme.ink, width: 2),
      ),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 380),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(18, 16, 18, 10),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('SO GEHT DAS BOARD', style: theme.label(size: 13, color: theme.grey)),
              const SizedBox(height: 10),
              SizedBox(
                height: 300,
                child: PageView(
                  controller: _pages,
                  onPageChanged: (i) => setState(() => _page = i),
                  children: [
                    for (final c in cards)
                      Column(
                        key: Key('stachelOnboardingCard-${c.key}'),
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          ClipRRect(
                            borderRadius: BorderRadius.circular(10),
                            child: SizedBox(
                              height: 170,
                              child: ExcludeSemantics(
                                child: CustomPaint(
                                  painter: OnboardingPainter(c.key, _anim, accent: theme.accent, ink: theme.ink),
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(height: 14),
                          Text(c.title, style: theme.label(size: 20)),
                          const SizedBox(height: 6),
                          // large system fonts: the text scrolls inside the card instead of overflowing
                          Expanded(
                            child: SingleChildScrollView(
                              child: Text(c.text, style: TextStyle(fontSize: 15, height: 1.3, color: theme.ink)),
                            ),
                          ),
                        ],
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 8),
              Semantics(
                label: 'Karte ${_page + 1} von ${cards.length}',
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    for (var i = 0; i < cards.length; i++)
                      AnimatedContainer(
                        duration: const Duration(milliseconds: 200),
                        margin: const EdgeInsets.symmetric(horizontal: 3),
                        width: i == _page ? 18 : 8,
                        height: 8,
                        decoration: BoxDecoration(
                          color: i == _page ? theme.accent : theme.grey.withValues(alpha: 0.35),
                          borderRadius: BorderRadius.circular(4),
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 6),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  if (!last)
                    Flexible(
                      child: TextButton(
                        key: const Key('stachelOnboardingSkip'),
                        onPressed: () => Navigator.of(context).pop(),
                        child: Text(
                          'Überspringen',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(color: theme.grey),
                        ),
                      ),
                    )
                  else
                    const SizedBox.shrink(),
                  FilledButton(
                    key: const Key('stachelOnboardingNext'),
                    style: FilledButton.styleFrom(backgroundColor: theme.ink, minimumSize: const Size(104, 44)),
                    onPressed: _next,
                    child: Text(last ? "Los geht's" : 'Weiter'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The little pictures of the cards (board-like light area, notes, a finger as a grey circle), [t] loops 0 … 1.
class OnboardingPainter extends CustomPainter {
  OnboardingPainter(this.card, this.t, {required this.accent, required this.ink}) : super(repaint: t);

  final String card;
  final Animation<double> t;
  final Color accent;
  final Color ink;

  static const _paper = Color(0xFFF4F3EE);
  static const _yellow = Color(0xFFFFE27A);
  static const _orange = Color(0xFFFFD08A);
  static const _green = Color(0xFFC9E14A);
  static const _blue = Color(0xFF1763B5);

  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawRect(Offset.zero & size, Paint()..color = _paper);
    final v = t.value;
    switch (card) {
      case 'move':
        _move(canvas, size, v);
      case 'grab':
        _grab(canvas, size, v);
      case 'select':
        _select(canvas, size, v);
      case 'undo':
        _undo(canvas, size, v);
    }
  }

  static double _seg(double v, double a, double b) => Curves.easeInOut.transform(((v - a) / (b - a)).clamp(0.0, 1.0));

  void _dots(Canvas canvas, Size size, Offset shift, double scale) {
    final p = Paint()..color = const Color(0x22000000);
    final step = 18 * scale;
    final ox = shift.dx % step, oy = shift.dy % step;
    for (var x = ox; x < size.width; x += step) {
      for (var y = oy; y < size.height; y += step) {
        canvas.drawCircle(Offset(x, y), 1.1, p);
      }
    }
  }

  void _note(Canvas canvas, Rect r, Color color, {bool lifted = false, bool selected = false}) {
    if (lifted) {
      canvas.drawRRect(
        RRect.fromRectAndRadius(r.shift(const Offset(4, 6)), const Radius.circular(4)),
        Paint()..color = const Color(0x33000000),
      );
    }
    canvas.drawRRect(RRect.fromRectAndRadius(r, const Radius.circular(4)), Paint()..color = color);
    final line = Paint()
      ..color = const Color(0x55000000)
      ..strokeWidth = 2
      ..strokeCap = StrokeCap.round;
    canvas.drawLine(
      r.topLeft + Offset(r.width * 0.18, r.height * 0.38),
      r.topLeft + Offset(r.width * 0.8, r.height * 0.38),
      line,
    );
    canvas.drawLine(
      r.topLeft + Offset(r.width * 0.18, r.height * 0.6),
      r.topLeft + Offset(r.width * 0.6, r.height * 0.6),
      line,
    );
    if (selected) {
      canvas.drawRRect(
        RRect.fromRectAndRadius(r.inflate(3), const Radius.circular(6)),
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2
          ..color = _blue,
      );
    }
  }

  void _finger(Canvas canvas, Offset at, {double press = 0, double ring = 0}) {
    canvas.drawCircle(at, 17 - 2 * press, Paint()..color = const Color(0x66000000));
    canvas.drawCircle(
      at,
      17 - 2 * press,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2.5
        ..color = const Color(0xFFFFFFFF),
    );
    if (ring > 0) {
      canvas.drawArc(
        Rect.fromCircle(center: at, radius: 24),
        -math.pi / 2,
        2 * math.pi * ring,
        false,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 3.5
          ..strokeCap = StrokeCap.round
          ..color = accent,
      );
    }
  }

  void _move(Canvas canvas, Size size, double v) {
    final c = size.center(Offset.zero);
    // 0 … 0.45: one finger pans to the right; 0.5 … 0.95: two fingers spread – zoom in
    final pan = _seg(v, 0.05, 0.45) * 70 - 35;
    final zoom = 1 + _seg(v, 0.55, 0.95) * 0.45;
    final shift = Offset(pan, 0);
    _dots(canvas, size, shift + c, zoom);
    canvas.save();
    canvas.translate(c.dx + shift.dx, c.dy);
    canvas.scale(zoom);
    _note(canvas, const Rect.fromLTWH(-70, -34, 54, 48), _yellow);
    _note(canvas, const Rect.fromLTWH(-6, -18, 54, 48), _green);
    _note(canvas, const Rect.fromLTWH(-40, 22, 54, 40), _orange);
    canvas.restore();
    if (v < 0.5) {
      _finger(canvas, c + Offset(pan + 50, 40), press: 1);
    } else {
      final spread = 22 + _seg(v, 0.55, 0.95) * 34;
      _finger(canvas, c + Offset(-spread, spread * 0.6), press: 1);
      _finger(canvas, c + Offset(spread, -spread * 0.6), press: 1);
    }
  }

  void _grab(Canvas canvas, Size size, double v) {
    _dots(canvas, size, Offset.zero, 1);
    final hold = _seg(v, 0.08, 0.38);
    final move = _seg(v, 0.42, 0.85);
    final start = Offset(size.width * 0.32, size.height * 0.5);
    final end = Offset(size.width * 0.68, size.height * 0.42);
    final at = Offset.lerp(start, end, move)!;
    _note(
      canvas,
      Rect.fromCenter(center: Offset(size.width * 0.72, size.height * 0.72), width: 50, height: 40),
      _green,
    );
    _note(
      canvas,
      Rect.fromCenter(center: at, width: 76, height: 62),
      _yellow,
      lifted: hold >= 1,
      selected: hold >= 1,
    );
    _finger(canvas, at + const Offset(10, 8), press: hold, ring: hold >= 1 ? 0 : hold);
  }

  void _select(Canvas canvas, Size size, double v) {
    _dots(canvas, size, Offset.zero, 1);
    final hold = _seg(v, 0.05, 0.3);
    final drag = _seg(v, 0.33, 0.8);
    final a = Offset(size.width * 0.18, size.height * 0.18);
    final b = Offset.lerp(a, Offset(size.width * 0.74, size.height * 0.84), drag)!;
    final rect = Rect.fromPoints(a, b);
    final notes = [
      (Rect.fromLTWH(size.width * 0.26, size.height * 0.3, 50, 40), _yellow),
      (Rect.fromLTWH(size.width * 0.5, size.height * 0.46, 50, 40), _orange),
      (Rect.fromLTWH(size.width * 0.8, size.height * 0.24, 44, 36), _green),
    ];
    for (final (r, color) in notes) {
      _note(canvas, r, color, selected: drag > 0 && rect.overlaps(r));
    }
    if (drag > 0) {
      canvas.drawRect(rect, Paint()..color = const Color(0x221763B5));
      canvas.drawRect(
        rect,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.5
          ..color = _blue,
      );
    }
    _finger(canvas, drag > 0 ? b : a, press: hold, ring: drag > 0 ? 0 : hold);
  }

  void _undo(Canvas canvas, Size size, double v) {
    _dots(canvas, size, Offset.zero, 1);
    // the note was moved (right); two fingers tap at 0.3 → it goes back to where it was (left)
    final back = _seg(v, 0.42, 0.7);
    final from = Offset(size.width * 0.66, size.height * 0.5);
    final to = Offset(size.width * 0.32, size.height * 0.5);
    final at = Offset.lerp(from, to, back)!;
    // where it was: dashed outline until it is back
    if (back < 1) {
      final ghost = Rect.fromCenter(center: to, width: 72, height: 58);
      final dash = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.5
        ..color = const Color(0x66000000);
      final path = Path()..addRRect(RRect.fromRectAndRadius(ghost, const Radius.circular(4)));
      for (final m in path.computeMetrics()) {
        for (var d = 0.0; d < m.length; d += 9) {
          canvas.drawPath(m.extractPath(d, math.min(d + 5, m.length)), dash);
        }
      }
    }
    _note(canvas, Rect.fromCenter(center: at, width: 72, height: 58), _yellow);
    final tap = v >= 0.22 && v < 0.4;
    if (tap) {
      final p = _seg(v, 0.22, 0.4);
      final c = Offset(size.width * 0.5, size.height * 0.22);
      for (final dx in const [-20.0, 20.0]) {
        _finger(canvas, c + Offset(dx, 0), press: 1 - (2 * p - 1).abs());
      }
    }
    if (v >= 0.42 && v < 0.9) {
      // the undo arrow over the board
      final c = Offset(size.width * 0.5, size.height * 0.22);
      final arrow = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 3.5
        ..strokeCap = StrokeCap.round
        ..color = ink;
      canvas.drawArc(Rect.fromCircle(center: c, radius: 14), math.pi * 1.1, math.pi * 1.3, false, arrow);
      final tip = c + Offset(14 * math.cos(math.pi * 1.1), 14 * math.sin(math.pi * 1.1));
      canvas.drawLine(tip, tip + const Offset(-1, -9), arrow);
      canvas.drawLine(tip, tip + const Offset(8, -3), arrow);
    }
  }

  @override
  bool shouldRepaint(covariant OnboardingPainter old) => old.card != card || old.t != t;
}
