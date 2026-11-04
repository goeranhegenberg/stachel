import 'package:flutter/material.dart';
import 'package:stachel_client/stachel_client.dart';

/// The Stachel look of the web app (`web/src/styles`): ink `#0a0a0a` on white, green `#c9e14a` as highlight, blue and
/// pink as accents, Barlow / Barlow Condensed, round pill buttons, rounded panels.
class StachelTheme {
  StachelTheme._();

  static const ink = Color(0xFF0A0A0A);
  static const paper = Color(0xFFFFFFFF);
  static const canvas = Color(0xFFF3F3EF);
  static const line = Color(0xFFDEDED8);
  static const muted = Color(0xFF6B6B66);
  static const green = Color(0xFFC9E14A);
  static const blue = Color(0xFF1763B5);
  static const pink = Color(0xFFEC4E92);
  static const danger = Color(0xFFD6336C);

  /// The shared screens' look (`stachel_client` [Sk]).
  static const style = StachelStyle(
    accent: pink,
    accentDark: Color(0xFFC93A78),
    highlight: green,
    blue: blue,
    ink: ink,
    paper: paper,
    danger: danger,
    grey: muted,
    stripe: [ink],
  );

  // ---- dark mode (UX-Review P14, Göran 04.11.: follows the system; the board itself stays light) -------------------

  static const darkInk = Color(0xFFF1F1EC);
  static const darkPaper = Color(0xFF1B1B1E);
  static const darkCanvas = Color(0xFF26262A);
  static const darkLine = Color(0xFF3A3A40);
  static const darkMuted = Color(0xFFA6A6A0);
  static const darkBlue = Color(0xFF6FA8EC);
  static const darkPink = Color(0xFFF27AAE);
  static const darkDanger = Color(0xFFF3739B);

  /// [style] in dark: light ink on dark surfaces, the same green and pink (a lighter pink for active things).
  static const darkStyle = StachelStyle(
    accent: pink,
    accentDark: darkPink,
    highlight: green,
    blue: darkBlue,
    ink: darkInk,
    paper: darkPaper,
    danger: darkDanger,
    grey: darkMuted,
    stripe: [darkLine],
  );

  /// The dark [ThemeData] (screens, bars, sheets, dialogs); the board view keeps its light canvas.
  static ThemeData darkTheme() => theme(dark: true);

  static ThemeData theme({bool dark = false}) {
    final ink = dark ? darkInk : StachelTheme.ink;
    final paper = dark ? darkPaper : StachelTheme.paper;
    final canvas = dark ? darkCanvas : StachelTheme.canvas;
    final line = dark ? darkLine : StachelTheme.line;
    final danger = dark ? darkDanger : StachelTheme.danger;
    final scheme = ColorScheme.fromSeed(
      seedColor: StachelTheme.ink,
      primary: ink,
      onPrimary: dark ? StachelTheme.ink : Colors.white,
      secondary: green,
      onSecondary: StachelTheme.ink,
      tertiary: pink,
      surface: paper,
      onSurface: ink,
      error: danger,
      brightness: dark ? Brightness.dark : Brightness.light,
    );
    TextStyle head(double size, [FontWeight w = FontWeight.w700]) =>
        TextStyle(fontFamily: 'BarlowCondensed', fontWeight: w, fontSize: size, height: 1.05, color: ink);
    const pill = StadiumBorder();
    const buttonText = TextStyle(
      fontFamily: 'BarlowCondensed',
      fontWeight: FontWeight.w600,
      fontSize: 17,
      letterSpacing: 0.6,
    );
    final base = ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: paper,
      canvasColor: paper,
      fontFamily: 'Barlow',
    );
    return base.copyWith(
      textTheme: base.textTheme.copyWith(
        displaySmall: head(34, FontWeight.w800),
        headlineMedium: head(28, FontWeight.w800),
        headlineSmall: head(24),
        titleLarge: head(20),
        titleMedium: TextStyle(fontFamily: 'Barlow', fontWeight: FontWeight.w600, fontSize: 16, color: ink),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: paper,
        foregroundColor: ink,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleTextStyle: TextStyle(
          fontFamily: 'BarlowCondensed',
          fontWeight: FontWeight.w700,
          fontSize: 22,
          letterSpacing: 0.4,
          color: ink,
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: ink,
          foregroundColor: dark ? StachelTheme.ink : Colors.white,
          minimumSize: const Size(64, 48),
          shape: pill,
          textStyle: buttonText,
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: ink,
          minimumSize: const Size(64, 48),
          shape: pill,
          side: BorderSide(color: ink, width: 1.5),
          textStyle: buttonText,
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(foregroundColor: ink, textStyle: buttonText.copyWith(fontSize: 16)),
      ),
      floatingActionButtonTheme: const FloatingActionButtonThemeData(
        backgroundColor: green,
        foregroundColor: StachelTheme.ink,
        shape: StadiumBorder(),
        extendedTextStyle: buttonText,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: canvas,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(9), borderSide: BorderSide.none),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(9),
          borderSide: BorderSide(color: ink, width: 1.5),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: dark ? darkCanvas : StachelTheme.ink,
        contentTextStyle: const TextStyle(fontFamily: 'Barlow', color: Colors.white),
        actionTextColor: green,
        behavior: SnackBarBehavior.floating,
      ),
      dividerTheme: DividerThemeData(color: line, space: 1),
      bottomSheetTheme: BottomSheetThemeData(backgroundColor: paper, modalBackgroundColor: paper),
      dialogTheme: DialogThemeData(backgroundColor: paper),
      checkboxTheme: CheckboxThemeData(
        fillColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? ink : null),
        checkColor: WidgetStatePropertyAll(dark ? StachelTheme.ink : Colors.white),
      ),
    );
  }
}
