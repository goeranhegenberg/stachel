import 'package:flutter/widgets.dart';

/// What the mouse wheel does without Strg (web `editor/interaction/wheel.ts`, setting „Mausrad“ in the shortcut list).
enum WheelMode { pan, zoom }

/// Mouse and keyboard like the web (docs/features/desktop.md): the Windows/Linux app and tablets with a mouse.
///
/// Mouse gestures follow the pointer kind of each event (a mouse is a mouse, also on a tablet); [enabled] only picks
/// what the app explains (introduction with mouse words instead of finger gestures, shortcut hints). The large-window
/// layout follows the size ([isWide], UX-Review P12 – also tablets).
abstract final class BoardDesktop {
  /// The app runs with mouse and keyboard as main input (desktop app); the host app sets it at start, tests set it.
  static bool enabled = false;

  /// Space is held (web „Leertaste + Ziehen“): a left drag pans the view instead of selecting. Set by the keyboard
  /// handling of the board, read by the board view.
  static final spaceDown = ValueNotifier<bool>(false);

  /// What the wheel of a mouse does without Strg – like the web (`getWheelMode`, default „Zoomen“; Göran: the app
  /// behaves like the web version). Umschalt + wheel pans sideways, Strg + wheel and a trackpad pinch always zoom at
  /// the pointer, a trackpad swipe always pans.
  static final wheel = ValueNotifier<WheelMode>(WheelMode.zoom);

  /// Device setting key of [wheel] (`pan` / `zoom`, kept with `BoardPrefs`).
  static const wheelKey = 'stachel.wheel';

  /// From this window width (and [wideMinHeight]) the board uses the large-window layout: tool bar on the left like
  /// the web, the context bar floating near the selection, comments and frames as side panels.
  static const wideWidth = 900.0;
  static const wideMinHeight = 520.0;

  static bool isWide(Size s) => s.width >= wideWidth && s.height >= wideMinHeight;

  /// [isWide] for the window of [context].
  static bool wideOf(BuildContext context) => isWide(MediaQuery.sizeOf(context));

  /// Back to the defaults (tests).
  @visibleForTesting
  static void resetForTest() {
    enabled = false;
    spaceDown.value = false;
    wheel.value = WheelMode.zoom;
  }
}
