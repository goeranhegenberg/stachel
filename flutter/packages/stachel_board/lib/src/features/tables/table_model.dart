import 'dart:math' as math;

import '../../mindmap/mind_measure.dart';
import '../../mindmap/mind_model.dart' show wrapText;
import '../../model/board_object.dart';
import '../../web/web_constants.dart';

// Tables without widgets (port of the web's `structure/table/model.ts` + `create.ts`, package P3): column widths from
// the relative weights, row heights from the wrapped cells (15 px, line height 1.35, padding 10/12, at least 42; the head
// row bold), neighbor cells, cell under a point. The numbers come from the web constants and the Chromium font metrics
// – the server computes the same heights for its web actions.

WebConstants get _wc => WebConstants.instance;

double get tableFs => _wc.number('table.layout.fontSize') ?? 15;
double get tableLh => _wc.number('table.layout.lineHeight') ?? 1.35;
double get tablePadX => _wc.number('table.layout.padX') ?? 12;
double get tablePadY => _wc.number('table.layout.padY') ?? 10;
double get tableMinRow => _wc.number('table.layout.minRow') ?? 42;
double get tableMinColPx => _wc.number('table.layout.minColPx') ?? 48;
double get tableWidth => _wc.number('table.width') ?? 480;
List<String> get tableHeadColors => _wc.strings('table.headColors');

/// `(head, label)` of the „Kopfbereich“ choices: Kopfzeile, Kopfspalte, Beides, Ohne.
List<(String, String)> get tableHeads => [
  for (final m in _wc.maps('table.heads')) (m['head'] as String? ?? 'row', m['label'] as String? ?? ''),
];

bool hasHeadRow(BoardObject o) => o.tableHead == 'row' || o.tableHead == 'both';
bool hasHeadCol(BoardObject o) => o.tableHead == 'col' || o.tableHead == 'both';

/// Width of a cell text (Barlow 15, bold 700 else 500) like the web's `cellMeasure`.
double cellMeasure(String s, bool bold) => TextMetrics.instance.measure(s, tableFs, bold ? 700 : 500, 'Barlow');

/// The table data like the web's `safeTable` (missing/broken = one empty cell `r`/`c`).
TableData safeTable(BoardObject o) => o.table ?? const TableData(rows: ['r'], cols: ['c'], cells: {}, widths: {});

/// Column widths in world units for the total width [w].
List<double> colWidths(TableData d, double w) {
  final ws = [for (final c in d.cols) d.weight(c) > 0 ? d.weight(c) : 1.0];
  final sum = ws.fold<double>(0, (a, b) => a + b);
  final s = sum == 0 ? 1.0 : sum;
  return [for (final x in ws) x / s * w];
}

/// Wrapped lines of a cell (bold = head row).
List<String> cellLines(String text, double colW, bool bold) =>
    wrapText(text, math.max(8, colW - 2 * tablePadX), (s) => cellMeasure(s, bold));

/// Row heights: the highest cell of the row (wrapped), at least 42; [boldRow0] = head row bold (web `rowHeights`).
List<double> rowHeights(TableData d, List<double> widths, {bool boldRow0 = true}) => [
  for (var i = 0; i < d.rows.length; i++)
    () {
      var lines = 1;
      for (var j = 0; j < d.cols.length; j++) {
        final t = d.cell(d.rows[i], d.cols[j]);
        if (t.isEmpty) continue;
        lines = math.max(lines, cellLines(t, widths[j], boldRow0 && i == 0).length);
      }
      return math.max(tableMinRow, (lines * tableFs * tableLh + 2 * tablePadY).ceilToDouble());
    }(),
];

/// Height of the table at width [w] (web `tableHeight`).
double tableHeight(TableData d, double w, {bool boldRow0 = true}) =>
    rowHeights(d, colWidths(d, w), boldRow0: boldRow0).fold<double>(0, (a, b) => a + b);

/// Size while dragging a side handle (web `resize` of the type): width ≥ 48 per column, height from the content.
Map<String, Object?> tableResize(BoardObject o, Map<String, Object?> box) {
  final d = safeTable(o);
  final w0 = (box['w'] as num?)?.toDouble() ?? o.w;
  final w = math.max(d.cols.length * tableMinColPx, w0);
  final out = {...box, 'w': w, 'h': tableHeight(d, w, boldRow0: hasHeadRow(o))};
  // the left handle keeps the right edge where it was
  if (w != w0 && box['x'] is num) out['x'] = (box['x'] as num).toDouble() + w0 - w;
  return out;
}

/// A cell (row and column id).
typedef Cell = ({String r, String c});

/// Rows and columns as drawn: widths from the weights, heights stretched to the stored `h` like the web's view
/// (other font metrics or a concurrent change left it slightly off).
class TableGeometry {
  TableGeometry(this.o) : data = safeTable(o) {
    widths = colWidths(data, o.w);
    final raw = rowHeights(data, widths, boldRow0: hasHeadRow(o));
    final sum = raw.fold<double>(0, (a, b) => a + b);
    final k = sum == 0 ? 1.0 : o.h / sum;
    heights = [for (final h in raw) h * k];
  }

  final BoardObject o;
  final TableData data;
  late final List<double> widths;
  late final List<double> heights;

  double colLeft(int i) => widths.take(i).fold<double>(0, (a, b) => a + b);
  double rowTop(int i) => heights.take(i).fold<double>(0, (a, b) => a + b);

  /// Box of [cell] in object coordinates (null if it is not in the table).
  ({double x, double y, double w, double h})? boxOf(Cell cell) {
    final ri = data.rows.indexOf(cell.r), ci = data.cols.indexOf(cell.c);
    if (ri < 0 || ci < 0) return null;
    return (x: colLeft(ci), y: rowTop(ri), w: widths[ci], h: heights[ri]);
  }

  /// Cell at the point ([lx], [ly]) in object coordinates (clamped into the table).
  Cell cellAt(double lx, double ly) {
    var ci = 0, x = 0.0;
    for (; ci < widths.length - 1; ci++) {
      if (lx < x + widths[ci]) break;
      x += widths[ci];
    }
    var ri = 0, y = 0.0;
    for (; ri < heights.length - 1; ri++) {
      if (ly < y + heights[ri]) break;
      y += heights[ri];
    }
    return (r: data.rows[ri], c: data.cols[ci]);
  }
}

/// Neighbor cell for Tab (`next`), Shift-Tab (`prev`), Enter (`down`), `up`; null at the edge (web `nextCell`).
Cell? nextCell(TableData d, Cell cell, String dir) {
  var ri = d.rows.indexOf(cell.r);
  var ci = d.cols.indexOf(cell.c);
  if (ri < 0 || ci < 0) return null;
  if (dir == 'down' || dir == 'up') {
    ri += dir == 'down' ? 1 : -1;
  } else {
    ci += dir == 'next' ? 1 : -1;
    if (ci >= d.cols.length) {
      ci = 0;
      ri++;
    } else if (ci < 0) {
      ci = d.cols.length - 1;
      ri--;
    }
  }
  if (ri < 0 || ri >= d.rows.length) return null;
  return (r: d.rows[ri], c: d.cols[ci]);
}
