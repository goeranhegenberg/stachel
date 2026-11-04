import 'package:flutter/material.dart';

/// Look of the shared Stachel screens. Each app sets [Sk.style] once at start (a host app: e.g. a pink/yellow/blue zine
/// look; Stachel app: the web's ink/green look). The app's [ThemeData] does the rest.
@immutable
class StachelStyle {
  const StachelStyle({
    this.accent = const Color(0xFFEC4E92),
    this.accentDark = const Color(0xFFC93A78),
    this.highlight = const Color(0xFFC9E14A),
    this.blue = const Color(0xFF1763B5),
    this.ink = const Color(0xFF0A0A0A),
    this.paper = const Color(0xFFFFFFFF),
    this.danger = const Color(0xFFD6336C),
    this.grey = const Color(0xFF6B6B66),
    this.body = 'Barlow',
    this.cond = 'BarlowCondensed',
    this.stripe = const [Color(0xFF0A0A0A)],
    this.panelBorder = 1.5,
    this.panelRadius = 14,
    this.hardShadow = false,
  });

  /// Accent (Stachel pink): stars, active things, primary actions in the board UI.
  final Color accent;
  final Color accentDark;

  /// Highlight (Stachel green).
  final Color highlight;
  final Color blue;
  final Color ink;
  final Color paper;
  final Color danger;
  final Color grey;
  final String body;
  final String cond;

  /// Colors of the stripe under app bars (equal parts).
  final List<Color> stripe;
  final double panelBorder;
  final double panelRadius;

  /// Hard offset shadow („sticker“ look) instead of a soft one.
  final bool hardShadow;

  /// The Stachel web look (`web/src/styles`: ink, green, blue, pink; rounded panels with a soft shadow).
  static const stachel = StachelStyle();
}

/// The current [StachelStyle] (static on purpose: many widgets use the colors in `const`-free places only).
///
/// Dark mode (UX-Review P14): an app that wants it sets [darkStyle] and calls [follow] from its `MaterialApp.builder`
/// (the Stachel app follows the system). Without [darkStyle] everything stays in [style] (a host app keeps its
/// look). [ink]/[paper] … are then the colors of the screens and bars; things drawn **on** the board – which stays
/// light – take [canvasInk].
class Sk {
  Sk._();

  /// The light look (and the only one without [darkStyle]).
  static StachelStyle style = StachelStyle.stachel;

  /// The dark look of the screens and bars (opt-in hook); null = no dark mode.
  static StachelStyle? darkStyle;

  /// Brightness the screens are shown in ([follow]); only counts with a [darkStyle].
  static Brightness brightness = Brightness.light;

  /// The look in use now.
  static StachelStyle get current => brightness == Brightness.dark ? darkStyle ?? style : style;

  /// True while the dark look is in use.
  static bool get dark => !identical(current, style);

  /// Takes the brightness of the [Theme] at [context] (call it in `MaterialApp.builder`). When it changes, everything
  /// below is built again, so the static colors follow.
  static void follow(BuildContext context) {
    final b = Theme.of(context).brightness;
    if (b == brightness) return;
    brightness = b;
    if (darkStyle == null) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!context.mounted) return;
      void rebuild(Element e) {
        e.markNeedsBuild();
        e.visitChildren(rebuild);
      }

      (context as Element).visitChildren(rebuild);
    });
  }

  static Color get pink => current.accent;
  static Color get pinkDark => current.accentDark;
  static Color get yellow => current.highlight;
  static Color get blue => current.blue;
  static Color get ink => current.ink;
  static Color get paper => current.paper;
  static Color get danger => current.danger;
  static Color get grey => current.grey;
  static String get body => current.body;
  static String get cond => current.cond;

  /// Background of bars, panels and sheets: white (as before, also in a hard-shadow look), [paper] of the dark look.
  static Color get surface => dark ? current.paper : Colors.white;

  /// Ink of things on the board (pills over the canvas, hints): always the light look's ink – the board stays light.
  static Color get canvasInk => style.ink;

  /// The stripe under app bars.
  static Widget stripe({double height = 5}) => SizedBox(
    height: height,
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [for (final c in current.stripe) Expanded(child: ColoredBox(color: c))],
    ),
  );
}

/// White panel with an ink border: hard offset shadow in the sticker look ([StachelStyle.hardShadow]), rounded with a
/// soft shadow in the Stachel look.
class SkPanel extends StatelessWidget {
  const SkPanel({super.key, required this.child, this.background, this.padding = const EdgeInsets.all(12)});

  final Widget child;

  /// null = [Sk.surface] (white; dark in the dark look).
  final Color? background;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    final s = Sk.current;
    final background = this.background ?? Sk.surface;
    const shadow = 5.0;
    if (s.hardShadow) {
      return Container(
        margin: const EdgeInsets.only(right: shadow, bottom: shadow),
        padding: padding,
        decoration: BoxDecoration(
          color: background,
          border: Border.all(color: s.ink, width: 3),
          boxShadow: [BoxShadow(color: s.ink, offset: const Offset(shadow, shadow))],
        ),
        child: child,
      );
    }
    return Container(
      margin: const EdgeInsets.all(2),
      padding: padding,
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(s.panelRadius),
        border: Border.all(color: s.ink, width: s.panelBorder),
        boxShadow: [
          BoxShadow(
            color: Sk.dark ? const Color(0x99000000) : const Color(0x2E0A0A0A),
            blurRadius: 24,
            offset: const Offset(0, 8),
            spreadRadius: -12,
          ),
        ],
      ),
      child: child,
    );
  }
}

/// App bar with the title in capitals and the stripe below.
AppBar skAppBar(String title, {List<Widget>? actions}) => AppBar(
  title: Text(title.toUpperCase()),
  actions: actions,
  bottom: PreferredSize(preferredSize: const Size.fromHeight(5), child: Sk.stripe(height: 5)),
);

/// Section heading in condensed capitals, optionally with an action on the right.
class SkHeading extends StatelessWidget {
  const SkHeading(this.text, {super.key, this.trailing});
  final String text;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: Row(
      children: [
        Expanded(child: Text(text.toUpperCase(), style: Theme.of(context).textTheme.titleLarge)),
        ?trailing,
      ],
    ),
  );
}

/// Grey hint for empty lists.
class SkEmpty extends StatelessWidget {
  const SkEmpty(this.text, {super.key});
  final String text;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 20),
    child: Text(text, style: TextStyle(fontSize: 13, color: Sk.grey)),
  );
}

/// Error page with „Erneut versuchen“.
class SkErrorView extends StatelessWidget {
  const SkErrorView({super.key, required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => ListView(
    children: [
      const SizedBox(height: 80),
      Icon(Icons.cloud_off, size: 56, color: Sk.grey),
      const SizedBox(height: 12),
      Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24),
        child: Text(message, textAlign: TextAlign.center),
      ),
      const SizedBox(height: 16),
      Center(
        child: OutlinedButton.icon(
          onPressed: onRetry,
          icon: const Icon(Icons.refresh),
          label: const Text('Erneut versuchen'),
        ),
      ),
    ],
  );
}

/// A short message at the bottom.
void skShowMsg(BuildContext context, String msg) {
  if (!context.mounted) return;
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(msg)));
}
