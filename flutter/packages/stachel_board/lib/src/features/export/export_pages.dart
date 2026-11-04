import 'dart:math' as math;
import 'dart:ui';

import '../../model/board_object.dart';
import '../frames/frames_model.dart';

// Export areas and pages: port of the web's `features/tools/export/exporter.ts` (+ `clampScale` from `render.tsx`,
// `fileName` from `tools/util.ts`). Pure functions, checked against the web's numbers in the tests.

/// What to export (web `ExportArea`).
sealed class ExportArea {
  const ExportArea();
}

/// The whole board (without hidden objects), with a margin.
class ExportBoardArea extends ExportArea {
  const ExportBoardArea();
}

/// The selection (selected frames bring their content, connectors between selected objects come along).
class ExportSelectionArea extends ExportArea {
  const ExportSelectionArea();
}

/// One frame (its rectangle).
class ExportFrameArea extends ExportArea {
  const ExportFrameArea(this.id);
  final String id;
}

/// All frames in presentation order (PDF: one page per frame).
class ExportFramesArea extends ExportArea {
  const ExportFramesArea();
}

/// `png` or `pdf`.
enum ExportFormat { png, pdf }

/// One page: world rectangle and the objects on it (bottom → top); [label] = frame title.
class ExportPage {
  const ExportPage(this.rect, this.objects, {this.label});
  final Rect rect;
  final List<BoardObject> objects;
  final String? label;
}

/// Margin around board/selection exports (web `PAD`).
const exportPad = 40.0;

/// Largest side and pixel count of an export (web `MAX_SIDE`/`MAX_PIXELS`).
const exportMaxSide = 8192.0;
const exportMaxPixels = 36000000.0;

/// Qualities of the export sheet: pixels per board unit.
const exportQualities = [(1, 'Normal'), (2, 'Scharf'), (3, 'Druck')];

/// Unrotated rectangle of an object (web `objRect` for frames).
Rect _box(BoardObject o) => Rect.fromLTWH(o.x, o.y, o.w, o.h);

bool _intersects(Rect a, Rect b) => a.left <= b.right && b.left <= a.right && a.top <= b.bottom && b.top <= a.bottom;

bool _contains(Rect outer, Rect inner) =>
    inner.left >= outer.left && inner.top >= outer.top && inner.right <= outer.right && inner.bottom <= outer.bottom;

Rect? _union(Iterable<Rect> rects) {
  Rect? r;
  for (final x in rects) {
    r = r == null ? x : r.expandToInclude(x);
  }
  return r;
}

bool _isContainer(BoardObject o) => o.type == 'frame';

/// Connectors whose attached ends both lie in [objs] belong to a selection (web `withConnectors`).
List<BoardObject> _withConnectors(List<BoardObject> objs, List<BoardObject> ordered) {
  final ids = {for (final o in objs) o.id};
  for (final c in ordered) {
    if (ids.contains(c.id) || c.hidden || c.type != 'connector') continue;
    final ends = [c.from, c.to];
    bool attached(ConnectorEnd? e) => e is AttachedEnd;
    final allIn = ends.every((e) => e == null || (e is AttachedEnd && ids.contains(e.objectId)));
    if (allIn && ends.any(attached)) ids.add(c.id);
  }
  return [
    for (final o in ordered)
      if (ids.contains(o.id)) o,
  ];
}

/// Pages for [area]; empty = nothing to export. [ordered] = all objects bottom → top, [bounds] = world bounds of an
/// object (connectors: their route) or null.
List<ExportPage> exportPages(
  List<BoardObject> ordered,
  Set<String> selection,
  ExportArea area,
  Rect? Function(BoardObject o) bounds,
) {
  final all = [
    for (final o in ordered)
      if (!o.hidden) o,
  ];
  ExportPage frame(BoardObject f) {
    final rect = _box(f);
    return ExportPage(rect, [
      for (final o in all)
        if (o.id == f.id || (bounds(o) != null && _intersects(bounds(o)!, rect))) o,
    ], label: (f.title ?? '').isEmpty ? 'Rahmen' : f.title);
  }

  List<ExportPage> around(List<BoardObject> objs) {
    final r = _union([for (final o in objs) ?bounds(o)]);
    return r != null && objs.isNotEmpty ? [ExportPage(r.inflate(exportPad), objs)] : const [];
  }

  switch (area) {
    case ExportBoardArea():
      return around(all);
    case ExportSelectionArea():
      final sel = {...selection};
      final picked = [
        for (final o in all)
          if (sel.contains(o.id)) o,
      ];
      // selected frames bring their content
      for (final f in picked.where(_isContainer)) {
        final r = _box(f);
        for (final o in all) {
          if (!sel.contains(o.id) && !_isContainer(o) && _contains(r, _box(o))) sel.add(o.id);
        }
      }
      if (picked.length == 1 && _isContainer(picked.first)) return [frame(picked.first)];
      return around(
        _withConnectors([
          for (final o in all)
            if (sel.contains(o.id)) o,
        ], ordered),
      );
    case ExportFrameArea(:final id):
      final f = ordered.where((o) => o.id == id).firstOrNull;
      return f == null ? const [] : [frame(f)];
    case ExportFramesArea():
      return [for (final f in framesInOrderWeb(all)) frame(f)];
  }
}

/// Page size in points: screen pixels at 96 dpi, longest side between A5 and A2 (web `pageSizePt`).
({double widthPt, double heightPt}) pageSizePt(Rect rect) {
  final w = rect.width * 0.75;
  final h = rect.height * 0.75;
  final longest = math.max(math.max(w, h), 1.0);
  final f = longest > 1684 ? 1684 / longest : (longest < 420 ? 420 / longest : 1.0);
  return (widthPt: w * f, heightPt: h * f);
}

/// Scale limited so the image fits the limits (web `clampScale`).
double clampScale(Rect rect, double wanted, {double maxSide = exportMaxSide, double maxPixels = exportMaxPixels}) {
  final w = math.max(1.0, rect.width);
  final h = math.max(1.0, rect.height);
  return math.max(0.01, [wanted, maxSide / w, maxSide / h, math.sqrt(maxPixels / (w * h))].reduce(math.min));
}

/// Pixel size of a page at [quality] (rounded like the canvas).
({int width, int height}) exportPixels(Rect rect, double quality) {
  final s = clampScale(rect, quality);
  return (width: math.max(1, (rect.width * s).round()), height: math.max(1, (rect.height * s).round()));
}

final _forbidden = RegExp(r'[\\/:*?"<>|\u0000-\u001f]+');
final _spaces = RegExp(r'\s+');

/// File name without forbidden characters: „Sommerfest – Ablauf.png“ (web `fileName`).
String exportFileName(String base, String ext) {
  var clean = base.replaceAll(_forbidden, ' ').replaceAll(_spaces, ' ').trim();
  if (clean.length > 80) clean = clean.substring(0, 80);
  return '${clean.isEmpty ? 'Stachel' : clean}.$ext';
}

/// File name of an export of [pages] (web `runExport`): „Board – Rahmen“ for one frame.
String exportNameFor(String boardTitle, ExportArea area, List<ExportPage> pages, ExportFormat format) {
  final title = boardTitle.trim().isEmpty ? 'Board' : boardTitle.trim();
  final one = pages.length == 1 ? pages.first.label : null;
  final suffix = area is ExportFrameArea || (area is ExportSelectionArea && one != null)
      ? ' – ${pages.first.label}'
      : '';
  return exportFileName('$title$suffix', format.name);
}
