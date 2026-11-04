// Legal CR-4 (docs/legal/lizenzen.md §5.2): the package's fonts and icons appear on the apps' license page.
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('Source Serif 4, JetBrains Mono und lucide stehen im LicenseRegistry (einmal, mit Text)', () async {
    registerStachelBoardLicenses();
    registerStachelBoardLicenses(); // idempotent
    final entries = await LicenseRegistry.licenses.toList();
    String text(String package) {
      final e = entries.where((e) => e.packages.contains(package)).toList();
      expect(e, hasLength(1), reason: package);
      return e.single.paragraphs.map((p) => p.text).join('\n');
    }

    final serif = text('Source Serif 4');
    expect(serif, contains('Adobe'));
    expect(serif, contains('Reserved Font Name ‘Source’'));
    expect(serif, isNot(contains('Google Inc.')));
    expect(serif, contains('SIL OPEN FONT LICENSE Version 1.1'));
    expect(text('JetBrains Mono'), contains('The JetBrains Mono Project Authors'));
    final lucide = text('lucide');
    expect(lucide, contains('ISC License'));
    expect(lucide, contains('Cole Bemis'));
  });
}
