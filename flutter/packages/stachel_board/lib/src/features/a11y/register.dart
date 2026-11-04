import '../../editor/registry/overlay_def.dart';
import '../../editor/registry/registry.dart';
import 'a11y_layer.dart';

/// P8: Barrierefreiheit – announcements of the selection, one semantics node per visible object (z-order), German
/// color names (`color_names.dart`), „weniger Bewegung“ (`reduceMotion`).
///
/// Owner: P8 (parity audit §4, rows P01–P05). Web: `ui/a11y.ts` (`describeSelection`, `announce`, `COLOR_NAMES`),
/// `editor/Editor.tsx` (announcement, Tab through the objects), CSS `prefers-reduced-motion`.
void registerA11y(BoardRegistry r) {
  r.defineOverlay(
    OverlayDef(
      id: 'a11y.semantics',
      order: 1,
      presenting: true,
      build: (context, ui) => A11yLayer(ui: ui),
    ),
  );
}
