import 'package:flutter/painting.dart';

import '../editor/camera.dart';
import '../geometry/shape_paths.dart';
import '../mindmap/mind_render.dart';
import '../model/board_object.dart';
import 'board_images.dart';
import 'board_scene.dart';
import 'paint_utils.dart';
import 'text_fit.dart';
import 'text_layout.dart';
import 'types/render_common.dart';
import 'types/sticky_renderer.dart';
import 'types/text_renderer.dart';
import 'types/shape_renderer.dart';
import 'types/frame_renderer.dart';
import 'types/image_renderer.dart';
import 'types/pen_renderer.dart';
import 'types/connector_renderer.dart';
import 'types/card_renderer.dart';
import 'types/table_renderer.dart';
import 'types/timeline_renderer.dart';
import 'types/sticker_renderer.dart';
import 'types/icon_renderer.dart';
import 'types/document_renderer.dart';
import 'types/placeholder_renderer.dart';

export 'types/sticky_renderer.dart';
export 'types/text_renderer.dart';
export 'types/shape_renderer.dart';
export 'types/frame_renderer.dart';
export 'types/image_renderer.dart';
export 'types/pen_renderer.dart';
export 'types/connector_renderer.dart';
export 'types/card_renderer.dart';
export 'types/table_renderer.dart';
export 'types/timeline_renderer.dart';
export 'types/sticker_renderer.dart';
export 'types/icon_renderer.dart';
export 'types/document_renderer.dart';
export 'types/placeholder_renderer.dart';

/// Everything a renderer needs besides the object.
class RenderContext {
  RenderContext({required this.scene, required this.text, required this.fonts, required this.images});

  final BoardScene scene;
  final TextLayoutCache text;
  final BoardFonts fonts;
  final BoardImages images;

  /// Current zoom and device pixel ratio (only for live-drawn objects: image tiers).
  double zoom = 1;
  double devicePixelRatio = 1;

  /// Object whose text is being edited: drawn without its text (the text field shows it).
  String? editingId;

  /// Paints the board background instead of the default (color + dots); returns false to fall back to the default.
  /// The hook for P4's board settings (`tools.settings`: color, pattern) – nothing else changes in the painter.
  bool Function(Canvas canvas, Size size, Camera camera)? background;
}

/// Where and how an object's text sits (the text field while editing matches the drawing).
class EditTextBox {
  const EditTextBox({
    required this.box,
    required this.fontSize,
    required this.align,
    required this.valign,
    required this.color,
    required this.weight,
  });

  /// Text area in object coordinates (0,0)–(w,h).
  final Rect box;
  final double fontSize;
  final TextAlign align;

  /// `top`, `middle`, `bottom`.
  final String valign;
  final Color color;
  final int weight;
}

/// The text area of a sticky note, text or shape like the renderer computes it (auto font size included).
EditTextBox? editTextBox(BoardObject o, RenderContext ctx) {
  switch (o.type) {
    case 'sticky':
      final fill = parseColor(o.color ?? defaultStickyColor, const Color(0xFFFFF27A));
      // like the renderer (web StickyView): padded note, `stickyFontSize`
      final pad = stickyPadding(o.w, o.h);
      final inner = Rect.fromLTRB(pad, pad, o.w - pad, o.h - pad);
      final ink = readableInk(fill);
      final fs = stickyFontSizeOf(o, (fs) => objectTextSpan(o, fontSize: fs, color: ink, fonts: ctx.fonts));
      return EditTextBox(
        box: inner,
        fontSize: fs,
        align: textAlignOf(o.align, TextAlign.center),
        valign: o.valign ?? 'middle',
        color: ink,
        weight: 500,
      );
    case 'text':
      return EditTextBox(
        box: Rect.fromLTWH(0, 0, o.w, o.h),
        fontSize: o.fontSize ?? 24,
        align: textAlignOf(o.align, TextAlign.left),
        valign: 'top',
        color: parseColor(o.color, BoardColors.ink),
        weight: 500,
      );
    case 'shape':
      final fill = parseColor(o.color ?? '#ffffff', const Color(0xFFFFFFFF));
      final alpha = isOpenShapeKind(o.shape) ? 0.0 : o.fillOpacity;
      final (t, r, b, l) = shapeInsets(o.shape, o.w, o.h);
      final inner = Rect.fromLTRB(l, t, o.w - r, o.h - b);
      final ink = alpha < 0.5 ? BoardColors.ink : textOn(fill);
      // web `shapeFontSize`, rich text measured in the layout (F19)
      final fs = shapeFontSizeOf(
        o,
        inner.width,
        inner.height,
        (fs) => objectTextSpan(o, fontSize: fs, color: ink, fonts: ctx.fonts, weight: 600),
      );
      return EditTextBox(
        box: inner,
        fontSize: fs,
        align: textAlignOf(o.align, TextAlign.center),
        valign: o.valign ?? 'middle',
        color: ink,
        weight: 600,
      );
    case 'mindnode':
      return mindEditBox(o, ctx);
  }
  return null;
}

/// Default sticky note color (`STICKY_COLORS[0]`).
const defaultStickyColor = '#fff27a';

/// Types with an own renderer (everything else gets the placeholder „Im Browser ansehen“).
bool isKnownObjectType(String type) => const {
  'sticky', 'text', 'shape', 'frame', 'image', 'pen', 'connector', 'card', 'table', 'mindnode', 'timeline', //
  'sticker', 'icon', 'document',
}.contains(type);

/// Types drawn every frame instead of from a cached picture (their look depends on loaded images or zoom).
bool isLiveType(String type) => type == 'image' || type == 'document';

/// Types drawn in world coordinates (no translate/rotate by the painter).
bool isWorldType(String type) => type == 'connector';

// ---- full detail --------------------------------------------------------------------------------------------------

/// Paints [o] in full detail. Box types paint in local coordinates (0,0)–(w,h) (the caller translates/rotates);
/// connectors in world coordinates.
void paintObject(Canvas c, BoardObject o, RenderContext ctx) {
  // hidden ones are drawn only with „Ausgeblendete zeigen“ (P1, web: 38 % opacity)
  if (o.hidden) return _faded(c, () => _paintObject(c, o, ctx));
  _paintObject(c, o, ctx);
}

void _faded(Canvas c, void Function() paint) {
  c.saveLayer(null, Paint()..color = const Color.fromRGBO(0, 0, 0, 0.38));
  paint();
  c.restore();
}

void _paintObject(Canvas c, BoardObject o, RenderContext ctx) {
  switch (o.type) {
    case 'sticky':
      paintSticky(c, o, ctx);
    case 'text':
      paintTextObject(c, o, ctx);
    case 'shape':
      paintShape(c, o, ctx);
    case 'frame':
      paintFrame(c, o, ctx);
    case 'image':
      paintImageObject(c, o, ctx);
    case 'pen':
      paintPen(c, o);
    case 'connector':
      paintConnector(c, o, ctx);
    case 'card':
      paintCard(c, o, ctx);
    case 'table':
      paintTable(c, o, ctx);
    case 'mindnode':
      paintMindNode(c, o, ctx);
    case 'timeline':
      paintTimeline(c, o, ctx);
    case 'sticker':
      paintSticker(c, o, ctx);
    case 'icon':
      paintIcon(c, o);
    case 'document':
      paintDocument(c, o, ctx);
    default:
      paintPlaceholder(c, o, ctx);
  }
}

// ---- low detail (zoomed far out) ----------------------------------------------------------------------------------

/// Flat look below ~30 % zoom (like the web's `simpleStyle`): areas in the object color, no text, images as their
/// average color, connectors as plain lines. Same coordinate rules as [paintObject]. Each type in its own file.
void paintObjectSimple(Canvas c, BoardObject o, RenderContext ctx) {
  if (o.hidden) return _faded(c, () => _paintObjectSimple(c, o, ctx));
  _paintObjectSimple(c, o, ctx);
}

void _paintObjectSimple(Canvas c, BoardObject o, RenderContext ctx) {
  final r = Rect.fromLTWH(0, 0, o.w, o.h);
  switch (o.type) {
    case 'sticky':
      paintStickySimple(c, o, ctx, r);
    case 'shape':
      paintShapeSimple(c, o, ctx, r);
    case 'text':
      paintTextObjectSimple(c, o, ctx, r);
    case 'frame':
      paintFrameSimple(c, o, ctx, r);
    case 'image':
      paintImageObjectSimple(c, o, ctx, r);
    case 'pen':
      paintPenSimple(c, o, ctx, r);
    case 'connector':
      paintConnectorSimple(c, o, ctx, r);
    case 'card':
      paintCardSimple(c, o, ctx, r);
    case 'table':
      paintTableSimple(c, o, ctx, r);
    case 'timeline':
      paintTimelineSimple(c, o, ctx, r);
    case 'document':
      paintDocumentSimple(c, o, ctx, r);
    case 'sticker':
      paintStickerSimple(c, o, ctx, r);
    case 'icon':
      paintIconSimple(c, o, ctx, r);
    case 'mindnode':
      paintMindNodeSimple(c, o);
    default:
      paintPlaceholderSimple(c, o, ctx, r);
  }
}
