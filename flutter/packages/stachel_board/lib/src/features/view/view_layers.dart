import 'dart:async';

import 'package:flutter/material.dart';

import '../../editor/camera.dart';

import '../../editor/registry/board_ui.dart';
import 'board_background.dart';
import 'minimap.dart';
import 'view_camera.dart';
import 'view_state.dart';

/// Hint when the UI is hidden on a touch device (web Toolbar.tsx `toggleUi`).
const uiHiddenHint = 'Oberfläche ausgeblendet. Das Auge unten rechts holt sie zurück.';

/// „Oberfläche ausblenden“ / back (M14).
void toggleUi(BoardUi ui) {
  final s = BoardViewPrefs.of(ui);
  s.uiHidden.value = !s.uiHidden.value;
  if (s.uiHidden.value) ui.host.showMessage(uiHiddenHint);
}

/// Bottom right of the board (web `.bottom-right`): minimap (closed on the phone) and the zoom bar − / % / + / fit;
/// the eye that brings a hidden UI back. Away while presenting, while something is selected (the context bar sits
/// there) and while writing. Also hooks the board background into the painter and ends fullscreen on leaving.
class ViewLayer extends StatefulWidget {
  const ViewLayer({super.key, required this.ui});
  final BoardUi ui;

  @override
  State<ViewLayer> createState() => _ViewLayerState();
}

class _ViewLayerState extends State<ViewLayer> {
  BoardUi get ui => widget.ui;
  final _minimapKey = GlobalKey(), _zoomKey = GlobalKey();

  @override
  void initState() {
    super.initState();
    _install();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) setState(_install);
    });
  }

  void _install() {
    installBoardBackground(ui);
    BoardViewPrefs.of(ui).chromeRects = _chrome;
    // M04: „Alles einpassen“ leaves room for the zoom bar and the minimap like the web (`chromeInsets`)
    ui.view?.fitPadding ??= (r, maxZoomFit) => measuredFitPadding(ui, r, maxZoomFit);
  }

  /// Zoom bar and minimap in board coordinates (web: `.bottom-right > *`, each on its own).
  List<Rect> _chrome() {
    final view = ui.view;
    final vb = view != null && view.mounted ? view.context.findRenderObject() : null;
    if (vb is! RenderBox || !vb.hasSize) return const [];
    return [
      for (final k in [_minimapKey, _zoomKey])
        if (k.currentContext?.findRenderObject() case final RenderBox b when b.attached && b.hasSize)
          vb.globalToLocal(b.localToGlobal(Offset.zero)) & b.size,
    ];
  }

  @override
  void dispose() {
    BoardViewPrefs.of(ui).dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final vs = BoardViewPrefs.of(ui);
    return ListenableBuilder(
      listenable: Listenable.merge([vs.chromeHidden, ui.editor.selection, ui.editor, vs.searchOpen]),
      builder: (context, _) {
        if (ui.presenting.value) return const SizedBox.shrink();
        if (vs.uiHidden.value) {
          return Stack(
            children: [
              Positioned(
                right: 10,
                bottom: 10,
                child: Material(
                  color: ui.theme.surface,
                  elevation: 3,
                  shape: const CircleBorder(),
                  child: IconButton(
                    key: const Key('stachelShowUi'),
                    tooltip: 'Oberfläche einblenden',
                    icon: const Icon(Icons.visibility_outlined),
                    onPressed: () => toggleUi(ui),
                  ),
                ),
              ),
            ],
          );
        }
        final busy = ui.editor.selection.value.isNotEmpty || ui.editor.editingId != null || ui.view == null;
        if (busy) return const SizedBox.shrink();
        // UX-Review P9 (B9): on a phone one zooms with two fingers – no zoom bar in the thumb's corner; the percentage
        // shows briefly while zooming (tap = zoom menu, ⛶ = Alles einpassen), the minimap button sits top right
        // below the bars on top
        if (ui.view!.viewSize.width < phoneMaxWidth) {
          return ListenableBuilder(
            listenable: ui.topBars,
            builder: (context, _) => Stack(
              children: [
                Positioned(
                  right: 8,
                  top: ui.topBars.bottom + 8,
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      ZoomFlash(ui: ui),
                      const SizedBox(width: 6),
                      KeyedSubtree(
                        key: _minimapKey,
                        child: MinimapView(ui: ui),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          );
        }
        return Stack(
          children: [
            Positioned(
              right: 8,
              bottom: 8,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                mainAxisSize: MainAxisSize.min,
                children: [
                  KeyedSubtree(
                    key: _minimapKey,
                    child: MinimapView(ui: ui),
                  ),
                  const SizedBox(height: 6),
                  KeyedSubtree(
                    key: _zoomKey,
                    child: ZoomBar(ui: ui),
                  ),
                ],
              ),
            ),
          ],
        );
      },
    );
  }
}

/// Zoom bar (M02/M03, web Editor.tsx `.zoombar`): − / percent (menu: Alles einpassen, 50 %, 100 %, 200 %) / + / fit.
class ZoomBar extends StatelessWidget {
  const ZoomBar({super.key, required this.ui});
  final BoardUi ui;

  @override
  Widget build(BuildContext context) {
    final view = ui.view!;
    final t = ui.theme;
    Widget btn(String key, String label, IconData icon, VoidCallback onTap) => SizedBox(
      width: 40,
      height: 40,
      child: IconButton(key: Key(key), tooltip: label, onPressed: onTap, icon: Icon(icon, size: 20)),
    );
    return Material(
      key: const Key('stachelZoomBar'),
      color: t.surface,
      elevation: 2,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: BorderSide(color: t.ink.withValues(alpha: 0.25)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          btn('stachelZoomOut', 'Verkleinern', Icons.remove, () => zoomStep(ui, -1)),
          ValueListenableBuilder(
            valueListenable: view.camera,
            builder: (context, cam, _) => InkWell(
              key: const Key('stachelZoomValue'),
              onTap: () => showZoomMenu(context, ui),
              child: Semantics(
                label: 'Zoom-Stufe wählen',
                button: true,
                child: Container(
                  constraints: const BoxConstraints(minWidth: 52),
                  height: 40,
                  alignment: Alignment.center,
                  child: Text('${(cam.z * 100).round()} %', style: t.label(size: 13)),
                ),
              ),
            ),
          ),
          btn('stachelZoomIn', 'Vergrößern', Icons.add, () => zoomStep(ui, 1)),
          Container(width: 1, height: 22, color: t.ink.withValues(alpha: 0.15)),
          btn('stachelZoomFit', 'Alles einpassen', Icons.fit_screen_outlined, () => ui.view?.fitAll()),
        ],
      ),
    );
  }
}

/// The phone's zoom display (UX-Review P9): after the zoom changed, „66 %“ (tap = zoom menu) and „Alles einpassen“
/// for [visibleFor], then nothing; the first placement of the camera when the board opens does not count.
class ZoomFlash extends StatefulWidget {
  const ZoomFlash({super.key, required this.ui, this.visibleFor = const Duration(milliseconds: 2500)});
  final BoardUi ui;
  final Duration visibleFor;

  @override
  State<ZoomFlash> createState() => _ZoomFlashState();
}

class _ZoomFlashState extends State<ZoomFlash> {
  ValueNotifier<Camera>? _camera;
  double? _z;
  Timer? _hide;
  bool _shown = false;

  /// Zoom changes count only after the first moment (the start camera: fit, start zoom).
  bool _armed = false;
  late final Timer _arm = Timer(const Duration(milliseconds: 800), () => _armed = true);

  @override
  void initState() {
    super.initState();
    _arm;
    _attach();
  }

  @override
  void didUpdateWidget(ZoomFlash old) {
    super.didUpdateWidget(old);
    _attach();
  }

  void _attach() {
    final cam = widget.ui.view?.camera;
    if (identical(cam, _camera)) return;
    _camera?.removeListener(_moved);
    _camera = cam?..addListener(_moved);
    _z = cam?.value.z;
  }

  void _moved() {
    final z = _camera!.value.z;
    final changed = _z != null && (z - _z!).abs() > 0.0005;
    _z = z;
    if (!changed || !_armed) return;
    _hide?.cancel();
    _hide = Timer(widget.visibleFor, () {
      if (mounted) setState(() => _shown = false);
    });
    if (!_shown && mounted) setState(() => _shown = true);
  }

  @override
  void dispose() {
    _arm.cancel();
    _hide?.cancel();
    _camera?.removeListener(_moved);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final cam = _camera;
    if (!_shown || cam == null) return const SizedBox.shrink();
    final t = widget.ui.theme;
    return Material(
      key: const Key('stachelZoomFlash'),
      color: t.surface,
      elevation: 2,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: BorderSide(color: t.ink.withValues(alpha: 0.25)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          ValueListenableBuilder(
            valueListenable: cam,
            builder: (context, c, _) => InkWell(
              key: const Key('stachelZoomValue'),
              onTap: () => showZoomMenu(context, widget.ui),
              child: Semantics(
                label: 'Zoom-Stufe wählen',
                button: true,
                child: Container(
                  constraints: const BoxConstraints(minWidth: 56),
                  height: 40,
                  alignment: Alignment.center,
                  child: Text('${(c.z * 100).round()} %', style: t.label(size: 13)),
                ),
              ),
            ),
          ),
          SizedBox(
            width: 40,
            height: 40,
            child: IconButton(
              key: const Key('stachelZoomFit'),
              tooltip: 'Alles einpassen',
              onPressed: () => widget.ui.view?.fitAll(),
              icon: const Icon(Icons.fit_screen_outlined, size: 20),
            ),
          ),
        ],
      ),
    );
  }
}

/// Zoom menu at the percentage (web: Alles einpassen, 50 %, 100 %, 200 %; the center stays).
Future<void> showZoomMenu(BuildContext context, BoardUi ui) async {
  final picked = await ui.openSheet<double>(
    context,
    (ctx) => SafeArea(
      child: Column(
        key: const Key('stachelZoomMenu'),
        mainAxisSize: MainAxisSize.min,
        children: [
          ListTile(
            key: const Key('stachelZoomMenuFit'),
            leading: const Icon(Icons.fit_screen_outlined),
            title: const Text('Alles einpassen'),
            onTap: () => Navigator.of(ctx).pop(-1.0),
          ),
          const Divider(height: 1),
          for (final z in const [0.5, 1.0, 2.0])
            ListTile(
              key: Key('stachelZoomMenu-${(z * 100).round()}'),
              leading: const SizedBox(width: 24),
              title: Text('${(z * 100).round()} %'),
              onTap: () => Navigator.of(ctx).pop(z),
            ),
        ],
      ),
    ),
    closeOnSelectionChange: false,
  );
  if (picked == null) return;
  if (picked < 0) {
    ui.view?.fitAll();
  } else {
    zoomTo(ui, picked);
  }
}
