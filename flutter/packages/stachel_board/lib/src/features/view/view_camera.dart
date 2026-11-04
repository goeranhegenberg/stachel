import 'dart:math' as math;
import 'dart:ui';

import '../../editor/camera.dart';
import '../../editor/registry/board_ui.dart';
import '../../model/board_object.dart';
import '../../model/board_state.dart';
import '../../render/board_scene.dart';
import '../frames/frames_model.dart';
import 'view_state.dart';

/// „Runde“ zoom steps for − / + (web `ZOOM_STEPS` in board/geometry.ts).
const zoomSteps = [0.05, 0.1, 0.15, 0.25, 0.33, 0.5, 0.67, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0, 4.0];

/// Next step up ([dir] 1) or down (−1) from [z] (web `nextZoomStep`).
double nextZoomStep(double z, int dir) {
  if (dir > 0) {
    for (final s in zoomSteps) {
      if (s > z + 0.001) return s;
    }
    return maxZoom;
  }
  for (final s in zoomSteps.reversed) {
    if (s < z - 0.001) return s;
  }
  return minZoom;
}

/// Room left for the app's overlays when the camera fits something (web `insets()` on the phone: measured chrome).
/// In the app the title and tool bars sit outside the board; on it are only the zoom bar / minimap (bottom right) and
/// the context bar (bottom).
const fitInsets = FitPadding.fromLTRB(24, 24, 24, 72);

/// Room left around fitted content where no bar lies (web `chromeInsets` MIN), and between content and a bar (GAP).
const chromeMin = 24.0;
const chromeGap = 16.0;

/// Port of the web's `chromeInsets` (ui/chromeInsets.ts): insets per side so that content fitted into a board of
/// [board] size lies under none of the [chrome] rectangles (board coordinates: zoom bar, minimap). Each bar counts
/// for the side where it costs the least room; a corner element (the minimap bottom right) goes right or below,
/// whichever gives [r] the larger zoom (at most [maxZoom]; on a tie the side that pushes the content less off
/// center). Without [r] every corner element counts for its cheapest side.
FitPadding chromeFitPadding(Size board, Iterable<Rect> chrome, {Rect? r, double maxZoom = double.infinity}) {
  final w = board.width, h = board.height;
  var base = const _Insets(chromeMin, chromeMin, chromeMin, chromeMin);
  final corners = <(_Insets, _Insets)>[];
  for (final e in chrome) {
    if (e.width < 1 || e.height < 1) continue;
    // room needed when the bar counts for that side
    final need = _Insets(e.bottom + chromeGap, h - e.top + chromeGap, e.right + chromeGap, w - e.left + chromeGap);
    // stable like the web's sort over ['top', 'right', 'bottom', 'left']
    final order = [..._sides]
      ..sort((x, y) {
        final d = need[x].compareTo(need[y]);
        return d != 0 ? d : _sides.indexOf(x).compareTo(_sides.indexOf(y));
      });
    final best = order[0], second = order[1];
    // corner: the second side costs hardly more (minimap bottom right)
    if (r != null && need[second] < need[best] * 1.6 && need[second] < math.min(w, h) / 2) {
      corners.add((_Insets.only(best, need[best]), _Insets.only(second, need[second])));
    } else {
      base = base.withMax(best, need[best]);
    }
  }
  if (r == null || corners.isEmpty) {
    for (final (a, _) in corners) {
      base = base.merge(a);
    }
    return base.toPadding();
  }
  double zoomOf(_Insets p) => math.min(
    math.min(
      math.max(1, w - p.left - p.right) / math.max(r.width, 1),
      math.max(1, h - p.top - p.bottom) / math.max(r.height, 1),
    ),
    maxZoom,
  );
  double skew(_Insets p) => (p.left - p.right).abs() + (p.top - p.bottom).abs();
  var cur = base;
  for (final (a, c) in corners) {
    final withA = cur.merge(a), withC = cur.merge(c);
    final za = zoomOf(withA), zc = zoomOf(withC);
    cur = (za - zc).abs() <= 0.01 * math.max(za, zc)
        ? (skew(withC) < skew(withA) ? withC : withA)
        : zc > za
        ? withC
        : withA;
  }
  // web `symmetric`: same insets on both sides of an axis as long as that does not cost zoom (content stays centered)
  final hor = math.max(cur.left, cur.right), ver = math.max(cur.top, cur.bottom);
  final best = zoomOf(cur);
  bool ok(_Insets q) => zoomOf(q) >= best * 0.99;
  final both = _Insets(ver, ver, hor, hor);
  if (ok(both)) return both.toPadding();
  final h1 = _Insets(cur.top, cur.bottom, hor, hor);
  if (ok(h1)) return h1.toPadding();
  final v1 = _Insets(ver, ver, cur.left, cur.right);
  return (ok(v1) ? v1 : cur).toPadding();
}

enum _Side { top, right, bottom, left }

const _sides = _Side.values;

/// Insets per side (web `Insets`), immutable.
class _Insets {
  const _Insets(this.top, this.bottom, this.left, this.right);
  factory _Insets.only(_Side s, double v) =>
      _Insets(s == _Side.top ? v : 0, s == _Side.bottom ? v : 0, s == _Side.left ? v : 0, s == _Side.right ? v : 0);
  final double top, bottom, left, right;

  double operator [](_Side s) => switch (s) {
    _Side.top => top,
    _Side.bottom => bottom,
    _Side.left => left,
    _Side.right => right,
  };

  _Insets withMax(_Side s, double v) => merge(_Insets.only(s, v));
  _Insets merge(_Insets o) =>
      _Insets(math.max(top, o.top), math.max(bottom, o.bottom), math.max(left, o.left), math.max(right, o.right));
  FitPadding toPadding() => FitPadding.fromLTRB(left, top, right, bottom);
}

/// Insets for fitting [r] into the view of [ui] from the bars that lie on the board right now (P4's zoom bar and
/// minimap, measured by [ViewLayer]); null without a view.
FitPadding? measuredFitPadding(BoardUi ui, Rect r, double maxZoomFit) {
  final v = ui.view;
  if (v == null || v.viewSize == Size.zero) return null;
  return chromeFitPadding(v.viewSize, BoardViewPrefs.of(ui).chromeRects(), r: r, maxZoom: maxZoomFit);
}

/// Presentation: a frame fills the view above the presentation bar (web `{top: 40, right: 24, bottom: 84, left: 24}`).
const presentInsets = FitPadding.fromLTRB(24, 40, 24, 84);

/// Smallest zoom when a board opens on the phone (web `PHONE_MIN_START_ZOOM`).
const phoneMinStartZoom = 0.35;

/// Below this width the web treats the view as a phone (`clientWidth < 700`).
const phoneMaxWidth = 700.0;

/// Camera on [r] (at most [maxZoomFit]) like the web's `fitRect`.
Camera fitCamera(Rect r, Size size, {FitPadding padding = fitInsets, double maxZoomFit = 2}) =>
    Camera.fit(r, size, padding: padding, maxZoomFit: maxZoomFit);

/// Zoom of [ui] around the view's center to [z] (web `zoomTo`: the center stays).
void zoomTo(BoardUi ui, double z) {
  final v = ui.view;
  if (v == null) return;
  v.camera.zoomAt(v.viewSize.center(Offset.zero), z);
}

/// − / + of the zoom bar (web `zoomStep`).
void zoomStep(BoardUi ui, int dir) {
  final v = ui.view;
  if (v == null) return;
  zoomTo(ui, nextZoomStep(v.camera.value.z, dir));
}

/// Soft camera move onto [r] (web `fitTo`, default at most 200 %).
void fitTo(BoardUi ui, Rect r, {double maxZoomFit = 2, FitPadding padding = fitInsets}) {
  final v = ui.view;
  if (v == null || v.viewSize == Size.zero) return;
  BoardViewPrefs.of(ui).animateCamera(fitCamera(r, v.viewSize, padding: padding, maxZoomFit: maxZoomFit));
}

/// Box of an object for the camera: connectors through the scene's index, others rotated (`objRect`).
Rect? boundsOf(BoardScene scene, BoardObject o) => o.type == 'connector' ? scene.grid.rectOf(o.id) : objectRect(o);

/// „Auf Auswahl zoomen“ (M05): animated, at most 200 %.
bool zoomToSelection(BoardUi ui) {
  final v = ui.view;
  if (v == null) return false;
  v.scene.bounds; // syncs the index
  Rect? box;
  for (final o in ui.editor.selected) {
    final r = boundsOf(v.scene, o);
    if (r != null) box = box == null ? r : box.expandToInclude(r);
  }
  if (box == null) return false;
  fitTo(ui, box);
  return true;
}

/// First camera of a board on the phone (web Editor.tsx „Handy: beim ersten Öffnen nicht winzig“): everything if
/// that is at least 35 %, else the first frame, else 35 % with the content (or first frame) vertically centered and
/// horizontally centered if it fits, otherwise starting at the left edge. Wider views fit everything (null).
Camera? phoneStartCamera(BoardState state, Rect bounds, Size size) {
  if (size.width >= phoneMaxWidth || size == Size.zero) return null;
  // same as „Alles zeigen“ of the view (fitAll)
  final all = Camera.fit(bounds, size, padding: const FitPadding.all(32));
  if (all.z >= phoneMinStartZoom) return null;
  final frames = framesInOrderWeb(state.ordered);
  final first = frames.isEmpty ? null : objectRect(frames.first);
  final target = first == null ? all : fitCamera(first, size, maxZoomFit: 1);
  if (target.z >= phoneMinStartZoom) return target;
  final r = first ?? bounds;
  const z = phoneMinStartZoom;
  final availW = size.width - 32;
  final x = r.width * z <= availW ? 16 + (availW - r.width * z) / 2 - r.left * z : 16 - r.left * z;
  final top = fitInsets.top, bottom = fitInsets.bottom;
  final y = top + (size.height - top - bottom) / 2 - (r.top + r.height / 2) * z;
  return Camera(x, y, math.max(z, minZoom));
}
