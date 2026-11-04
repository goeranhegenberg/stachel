// P7: page logic of PDF documents like the web (`features/documents/pages.ts`, cases from `documents.test.ts`).

import 'dart:math' as math;
import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';
import 'package:stachel_board/src/features/documents/doc_pages.dart';

BoardObject _o(Map<String, Object?> m) => BoardObject.fromJson({'id': 'd', 'type': 'document', ...m})!;

void main() {
  test('begrenzt die Seite und verträgt kaputte Werte', () {
    expect(currentPage(_o({'docCount': 3, 'docPage': 7})), 2);
    expect(currentPage(_o({'docCount': 3, 'docPage': -2})), 0);
    expect(currentPage(_o({'docCount': 3, 'docPage': 'x'})), 0);
    expect(currentPage(_o({})), 0);
    expect(pageCount(_o({})), 1);
    expect(pageCount(_o({'docCount': 0})), 1);
  });

  test('fehlende Seiten: die aktuelle zuerst', () {
    expect(
      missingPages(
        _o({
          'docCount': 4,
          'docPage': 2,
          'docPages': {'0': 'a'},
        }),
      ),
      [2, 1, 3],
    );
    expect(
      missingPages(
        _o({
          'docCount': 2,
          'docPages': {'0': 'a', '1': 'b'},
        }),
      ),
      isEmpty,
    );
    expect(
      pageImage(
        _o({
          'docPages': {'0': ''},
        }),
        0,
      ),
      isNull,
    );
  });

  test('Seitenverhältnis mit Rückfall auf Seite 1 bzw. A4', () {
    expect(
      pageRatio(
        _o({
          'docRatios': [0.5, 2],
        }),
        1,
      ),
      2,
    );
    expect(
      pageRatio(
        _o({
          'docRatios': [0.5],
        }),
        5,
      ),
      0.5,
    );
    expect(pageRatio(_o({}), 0), closeTo(595 / 842, 1e-9));
    expect(
      pageRatio(
        _o({
          'docRatios': [-1],
        }),
        0,
      ),
      closeTo(595 / 842, 1e-9),
    );
  });

  test('Größe beim Einfügen, Render-Maßstab und Pixelgröße wie der Canvas des Web', () {
    expect(docSize(0.5), const Size(320, 640));
    expect(docSize(2), const Size(640, 320));
    expect(docSize(0.707), const Size(452, 640)); // A4 hoch (Math.round(452.48))
    // A4 hoch: längere Kante 1800 px
    expect(842 * renderScale(595, 842), closeTo(1800, 1e-6));
    final a4 = renderSize(595, 842);
    expect(a4.width, (595 * (1800 / 842)).floor());
    expect(a4.height, (842 * (1800 / 842)).floor());
    // sehr großer Plan: höchstens 4 Mio. Pixel
    final s = renderScale(3000, 3000);
    expect(3000 * s * 3000 * s, lessThanOrEqualTo(4000001));
    final big = renderSize(3000, 3000);
    expect(big.width * big.height, lessThanOrEqualTo(4000000));
    expect(ratioOf(595, 842), 0.707);
    expect(ratioOf(842, 595), 1.415);
  });

  test('Raster „Alle Seiten aufs Board“ rechts neben dem Dokument, oben bündig, ohne Überlappung', () {
    final rects = expandLayout(
      _o({'x': 100, 'y': 50, 'w': 200, 'h': 400, 'docCount': 12, 'docRatios': List.filled(12, 0.5)}),
    );
    expect(rects, hasLength(12));
    expect(rects[0], const Rect.fromLTWH(100 + 200 + 16, 50, 200, 400));
    expect(rects.map((r) => r.left).toSet().length, (math.sqrt(12 * 1.6)).ceil());
    for (var i = 0; i < rects.length; i++) {
      for (var j = i + 1; j < rects.length; j++) {
        expect(rects[i].overlaps(rects[j]), isFalse);
      }
    }
    expect(expandLayout(_o({'x': 0, 'y': 0, 'w': 100, 'h': 100, 'docCount': 3})).map((r) => r.top), [0, 0, 0]);
  });

  test('Dateinamen und PDF-Erkennung', () {
    expect(cleanName(r'C:\fakepath\Lage plan.pdf'), 'Lage plan.pdf');
    expect(cleanName(''), 'Dokument.pdf');
    expect(cleanName('${'x' * 300}.pdf'), hasLength(120));
    expect(isPdfFile(name: 'a.PDF'), isTrue);
    expect(isPdfFile(name: 'a', mime: 'application/pdf'), isTrue);
    expect(isPdfFile(name: 'a.png', mime: 'image/png'), isFalse);
    expect(looksLikePdf('%PDF-1.7'.codeUnits), isTrue);
    expect(looksLikePdf('<html>'.codeUnits), isFalse);
  });
}
