import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../model/board_object.dart';
import '../../model/collab.dart' show Person;
import '../../model/board_source.dart';
import '../board_editor.dart';
import '../board_view.dart';
import '../desktop.dart';
import '../ui/board_side_panel.dart';
import '../ui/board_hints.dart';
import 'menu_item_def.dart';
import 'registry.dart';

/// Services of the host app the board UI needs but the package cannot provide itself (links, browser …). The app
/// **extends** this class (packages add methods with a default implementation later without breaking the app).
class BoardHost {
  const BoardHost();

  /// Board ID (links, sheets).
  String get boardId => '';

  /// „Link zum Board/Objekt kopieren“ (`/b/<id>?o=<obj>`).
  Future<void> copyLink({String? objectId}) async {}

  /// „Im Browser öffnen“; with [objectId] the web opens on that object (`o=`, audit E23).
  Future<void> openInBrowser({String? objectId}) async {}

  /// A short hint at the bottom (snackbar); default: nothing.
  void showMessage(String text) {}

  /// Opens a link from a text on the board in the system browser (P8, „Link öffnen?“); default: nothing.
  Future<void> openUrl(String url) async {}

  /// A small setting kept on this device (web: `localStorage`, e.g. P2's recently used emoji); default: not kept.
  Future<String?> readSetting(String key) async => null;
  Future<void> writeSetting(String key, String value) async {}

  /// Everybody who could be on the board (web `GET /api/users`, e.g. P5's „von Mara“ at a note); default: none (the
  /// package adds the people present and the comment authors itself).
  Future<List<Person>> people() async => const [];

  /// P5: the timer's end signal (web: three short tones). Default: the platform's alert sound; the app plays the
  /// web's tones. Vibration comes from the package.
  Future<void> playChime() => SystemSound.play(SystemSoundType.alert);

  /// More rows for another person in „Auf dem Board“ (the app's moderation: „Person melden …“, „Person blockieren“);
  /// default: none.
  List<MenuEntry> personActions(String key, String name) => const [];
}

/// Look of the board UI (the app passes its own colors and fonts; defaults = the original ink/pink look).
class BoardUiTheme {
  const BoardUiTheme({
    this.ink = const Color(0xFF161118),
    this.accent = const Color(0xFFE5398B),
    this.accentDark = const Color(0xFFC81E6F),
    this.grey = const Color(0xFF6B6471),
    this.danger = const Color(0xFFD11F3A),
    this.surface = const Color(0xFFFFFFFF),
    Color? canvasInk,
    this.condensedFont,
    this.panel,
  }) : canvasInk = canvasInk ?? ink;

  final Color ink;
  final Color accent;
  final Color accentDark;
  final Color grey;
  final Color danger;

  /// Background of bars, panels and pills over the board (dark in a dark look).
  final Color surface;

  /// Ink of things drawn on the board itself, which stays light also in a dark look (hint pills over the canvas);
  /// default: [ink].
  final Color canvasInk;

  /// Font of short labels (tool names, sheet headings).
  final String? condensedFont;

  /// Panel around the context bar (null = white box, ink border, hard shadow).
  final Widget Function({Key? key, required Widget child, EdgeInsetsGeometry padding})? panel;

  /// Short bold label style (tool bar, headings).
  TextStyle label({double size = 11.5, Color? color}) => TextStyle(
    fontFamily: condensedFont,
    fontSize: size,
    fontWeight: FontWeight.w700,
    letterSpacing: 0.3,
    color: color ?? ink,
  );

  Widget panelOf({Key? key, required Widget child, EdgeInsetsGeometry padding = const EdgeInsets.all(12)}) {
    final p = panel;
    if (p != null) return p(key: key, child: child, padding: padding);
    return Container(
      key: key,
      margin: const EdgeInsets.only(right: 5, bottom: 5),
      padding: padding,
      decoration: BoxDecoration(
        color: surface,
        border: Border.all(color: ink, width: 3),
        boxShadow: [BoxShadow(color: ink, offset: const Offset(5, 5))],
      ),
      child: child,
    );
  }
}

/// What every registry callback gets (the web's `EditorApi`): editor and controller, the board view (camera, text
/// editing), the registry, the host app, the hint service, the theme. One per board screen; widgets find it with
/// [BoardUiScope.of].
class BoardUi {
  BoardUi({
    required this.editor,
    required this.registry,
    this.host = const BoardHost(),
    BoardHints? hints,
    this.theme = const BoardUiTheme(),
    GlobalKey<BoardViewState>? viewKey,
  }) : hints = hints ?? BoardHints(controller: editor.controller, editor: editor),
       viewKey = viewKey ?? GlobalKey<BoardViewState>() {
    editor.registry = registry;
    editor.onNotice ??= this.hints.show;
    editor.selection.addListener(_selectionChanged);
  }

  final BoardEditor editor;
  final BoardRegistry registry;
  final BoardHost host;
  final BoardHints hints;

  /// Colors of the board UI; the screen may set a new one (light/dark switched) and build again.
  BoardUiTheme theme;

  /// Key of the [BoardView] of this screen (pass it to the view): camera and text editing for the entries.
  final GlobalKey<BoardViewState> viewKey;

  BoardController get controller => editor.controller;
  BoardViewState? get view => viewKey.currentState;

  /// Presentation mode (P4): only overlays with `presenting` are shown.
  final presenting = ValueNotifier<bool>(false);

  /// The bars on top of the board (connection banner, search, vote/timer, mention, status pills) stack in one column
  /// instead of covering each other (UX-Review P2): each [BoardTopSlot] reports its height here.
  final topBars = BoardTopBars();

  // ---- sheets (popovers of the web as bottom sheets, D44) ---------------------------------------------------------

  final _openSheets = <Route<Object?>>[];

  /// Opens a bottom sheet; with [closeOnSelectionChange] (popovers of the context bar) a change of the selection
  /// closes it like the web closes its popover. Large windows ([BoardDesktop.isWide], UX-Review P12): with [side] a
  /// panel at the right edge instead ([showBoardSidePanel], titled [title]), else the sheet stays at most
  /// [wideSheetWidth] wide.
  Future<T?> openSheet<T>(
    BuildContext context,
    WidgetBuilder builder, {
    bool closeOnSelectionChange = true,
    bool scrollControlled = false,
    bool side = false,
    String? title,
  }) {
    Route<Object?>? route;
    Widget track(BuildContext ctx) {
      final r = ModalRoute.of(ctx);
      if (r != null && !identical(r, route)) {
        route = r;
        if (closeOnSelectionChange) _openSheets.add(r);
      }
      return builder(ctx);
    }

    final wide = BoardDesktop.wideOf(context);
    final Future<T?> open = side && wide
        ? showBoardSidePanel<T>(context, title: title, builder: track)
        : showModalBottomSheet<T>(
            context: context,
            showDragHandle: true,
            isScrollControlled: scrollControlled,
            constraints: wide ? const BoxConstraints(maxWidth: wideSheetWidth) : null,
            builder: track,
          );
    return open.whenComplete(() {
      if (route != null) _openSheets.remove(route);
    });
  }

  /// Widest a sheet from the bottom gets in a large window (Material 3's width of a bottom sheet, so wide sheets like
  /// the template gallery keep their room).
  static const wideSheetWidth = 640.0;

  /// Opens the registered sheet [id] (null if there is none).
  Future<Object?>? openRegisteredSheet(BuildContext context, String id, {Map<String, Object?> args = const {}}) {
    final def = registry.sheets[id];
    if (def == null) return null;
    return openSheet<Object?>(
      context,
      (ctx) => def.build(ctx, this, args),
      closeOnSelectionChange: def.closeOnSelectionChange,
      scrollControlled: def.scrollControlled,
      side: def.side,
      title: def.sideTitle,
    );
  }

  Set<String> _lastSelection = const {};

  void _selectionChanged() {
    final now = editor.selection.value;
    if (_openSheets.isEmpty || _sameSet(now, _lastSelection)) {
      _lastSelection = now;
      return;
    }
    _lastSelection = now;
    for (final r in [..._openSheets]) {
      if (r.isActive) r.navigator?.removeRoute(r);
    }
    _openSheets.clear();
  }

  static bool _sameSet(Set<String> a, Set<String> b) => a.length == b.length && a.containsAll(b);

  // ---- helpers for entries ----------------------------------------------------------------------------------------

  /// The selected objects.
  List<BoardObject> get selected => editor.selected;

  void dispose() {
    editor.selection.removeListener(_selectionChanged);
    if (identical(editor.registry, registry)) editor.registry = null;
    presenting.dispose();
    topBars.dispose();
    hints.dispose();
  }
}

/// Heights of the bars on top of the board by [BoardTopSlot.order] (UX-Review P2): a slot sits below every slot
/// with a smaller order that shows something, so the search, the vote bar, the timer and the mention chip never cover
/// each other. [bottom] is where the column ends (P9: the minimap button on the phone sits below it).
class BoardTopBars extends ChangeNotifier {
  final _bars = <Object, ({double order, double height, double gap})>{};
  bool _disposed = false;

  /// Reports the measured [height] of the slot [key] (0 = shows nothing); [gap] lies above it when it shows something.
  void report(Object key, {required double order, required double height, required double gap}) {
    final old = _bars[key];
    if (old != null && old.order == order && (old.height - height).abs() < 0.5 && old.gap == gap) return;
    _bars[key] = (order: order, height: height, gap: gap);
    _changed();
  }

  void remove(Object key) {
    if (_bars.remove(key) != null) _changed();
  }

  void _changed() {
    // reported during layout: listeners rebuild in the next frame
    WidgetsBinding.instance
      ..addPostFrameCallback((_) {
        if (!_disposed) notifyListeners();
      })
      ..ensureVisualUpdate();
  }

  /// Top of the slot [key] with [order] and [gap]: below the visible slots before it.
  double topOf(Object key, double order, double gap) {
    var y = 0.0;
    for (final e in _bars.entries) {
      final b = e.value;
      if (e.key == key || b.height <= 0) continue;
      if (b.order < order || (b.order == order && identityHashCode(e.key) < identityHashCode(key))) {
        y += b.gap + b.height;
      }
    }
    return y + gap;
  }

  /// Lower end of the whole column (0 = nothing on top).
  double get bottom {
    var y = 0.0;
    for (final b in _bars.values) {
      if (b.height > 0) y += b.gap + b.height;
    }
    return y;
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}

/// Makes the [BoardUi] of a board screen available to the registry widgets below.
class BoardUiScope extends InheritedWidget {
  const BoardUiScope({super.key, required this.ui, required super.child});
  final BoardUi ui;

  static BoardUi of(BuildContext context) {
    final s = context.dependOnInheritedWidgetOfExactType<BoardUiScope>();
    assert(s != null, 'BoardUiScope fehlt über diesem Widget');
    return s!.ui;
  }

  static BoardUi? maybeOf(BuildContext context) => context.dependOnInheritedWidgetOfExactType<BoardUiScope>()?.ui;

  @override
  bool updateShouldNotify(BoardUiScope oldWidget) => !identical(oldWidget.ui, ui);
}
