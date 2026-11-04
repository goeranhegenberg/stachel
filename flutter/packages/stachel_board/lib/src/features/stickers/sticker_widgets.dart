import 'package:flutter/material.dart';

import '../../editor/registry/board_ui.dart';
import '../../render/types/icon_renderer.dart';
import '../../render/types/sticker_renderer.dart';
import 'sticker_data.dart';

/// A stamp, emoji or icon as a small picture (web `ItemPreview`).
class StickerItemPreview extends StatelessWidget {
  const StickerItemPreview(this.item, {super.key, this.size = 26, this.color});
  final PlaceItem item;
  final double size;

  /// Icon color (default: the icon theme's).
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final ui = BoardUiScope.maybeOf(context);
    switch (item) {
      case StampItem(:final id):
        final s = stampById(id) ?? stamps.first;
        return SizedBox(
          width: size,
          height: size,
          child: CustomPaint(painter: _StampPainter(s, ui?.view?.widget.fonts.condensed ?? 'BarlowCondensed')),
        );
      case EmojiItem(:final ch):
        return SizedBox(
          width: size,
          height: size,
          child: Center(
            child: Text(ch, style: TextStyle(fontSize: size * 0.8, height: 1)),
          ),
        );
      case IconItem(:final icon):
        return SizedBox(
          width: size,
          height: size,
          child: CustomPaint(
            painter: _IconPainter(icon.node, color ?? IconTheme.of(context).color ?? const Color(0xFF161118)),
          ),
        );
    }
  }
}

class _StampPainter extends CustomPainter {
  _StampPainter(this.stamp, this.condensed);
  final StampDef stamp;
  final String condensed;

  @override
  void paint(Canvas canvas, Size size) => paintStamp(canvas, stamp, size.shortestSide, condensed: condensed);

  @override
  bool shouldRepaint(covariant _StampPainter old) => old.stamp.id != stamp.id;
}

class _IconPainter extends CustomPainter {
  _IconPainter(this.node, this.color);
  final List<Object?> node;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) => paintIconGlyph(canvas, node, color, size.shortestSide);

  @override
  bool shouldRepaint(covariant _IconPainter old) => !identical(old.node, node) || old.color != color;
}
