// Legal CR-4 (docs/legal/lizenzen.md §5.2): PDFium (native library, not in Flutter's NOTICES) and the board package's
// fonts/icons appear on the apps' license page.
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_client/stachel_client.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('registerStachelLicenses: PDFium samt Teilen, Schriften und lucide – einmal', () async {
    registerStachelLicenses();
    registerStachelLicenses(); // idempotent
    final entries = await LicenseRegistry.licenses.toList();
    final packages = entries.expand((e) => e.packages).toSet();
    expect(packages, containsAll(['PDFium', 'Source Serif 4', 'JetBrains Mono', 'lucide']));
    final pdfium = entries.where((e) => e.packages.contains('PDFium')).toList();
    expect(pdfium, hasLength(stachelPdfiumLicenseFiles.length));
    final all = pdfium.map((e) => e.paragraphs.map((p) => p.text).join('\n')).join('\n');
    expect(all, contains('Benoit Blanchon'));
    expect(all, contains('FreeType'));
    expect(all, contains('libjpeg-turbo'));
    expect(entries.where((e) => e.packages.contains('lucide')), hasLength(1));
  });
}
