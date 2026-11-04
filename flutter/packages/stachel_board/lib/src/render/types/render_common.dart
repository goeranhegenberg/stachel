import 'package:flutter/painting.dart';

// Paint helpers shared by the type renderers (split out of `object_renderers.dart` in F2).

final fillPaint = Paint()..isAntiAlias = true;
Paint strokePaint(Color color, double width) => Paint()
  ..style = PaintingStyle.stroke
  ..color = color
  ..strokeWidth = width
  ..isAntiAlias = true;

void paintTextBox(Canvas c, TextPainter tp, Rect box, {String valign = 'top'}) {
  final dy = switch (valign) {
    'middle' => (box.height - tp.height) / 2,
    'bottom' => box.height - tp.height,
    _ => 0.0,
  };
  c.save();
  c.clipRect(box.inflate(2));
  tp.paint(c, Offset(box.left, box.top + dy));
  c.restore();
}

TextAlign textAlignOf(String? a, TextAlign fallback) => switch (a) {
  'left' => TextAlign.left,
  'center' => TextAlign.center,
  'right' => TextAlign.right,
  _ => fallback,
};
