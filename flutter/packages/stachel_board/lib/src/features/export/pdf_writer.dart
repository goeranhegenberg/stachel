import 'dart:convert';
import 'dart:io' show ZLibCodec;
import 'dart:typed_data';

// Minimal PDF writer (PDF 1.4), port of the web's `features/tools/export/pdf.ts`: one image per page at page size.
// Images lossless (RGB, FlateDecode via dart:io zlib). No dependency, no network.

/// An image of a page: pixel size and compressed RGB data.
class PdfImage {
  const PdfImage({required this.width, required this.height, required this.data, this.filter = 'FlateDecode'});
  final int width;
  final int height;
  final Uint8List data;

  /// `FlateDecode` (zlib RGB) or `DCTDecode` (JPEG).
  final String filter;
}

/// One page: size in points (1/72 inch) and its image.
class PdfPage {
  const PdfPage({required this.widthPt, required this.heightPt, required this.image});
  final double widthPt;
  final double heightPt;
  final PdfImage image;
}

/// Text as a PDF string (UTF-16BE with BOM, hex) – titles with umlauts.
String pdfText(String s) {
  final b = StringBuffer('<FEFF');
  for (final c in s.codeUnits) {
    b.write(c.toRadixString(16).padLeft(4, '0').toUpperCase());
  }
  b.write('>');
  return b.toString();
}

/// Number like JS `(Math.round(n * 100) / 100).toString()`: „100.12“, „300“.
String _num(double n) {
  final r = (n * 100).round() / 100;
  return r == r.truncateToDouble() ? r.toInt().toString() : r.toString();
}

String _p2(int v) => v.toString().padLeft(2, '0');

/// Builds the PDF file from [pages] (objects: 1 catalog, 2 page tree, 3 info, then per page: page, content, image).
Uint8List buildPdf(List<PdfPage> pages, {String? title, DateTime? date}) {
  final out = BytesBuilder(copy: false);
  final offsets = <int, int>{};
  void push(Object b) => out.add(b is String ? latin1.encode(b) : b as List<int>);
  void obj(int n, void Function() body) {
    offsets[n] = out.length;
    push('$n 0 obj\n');
    body();
    push('\nendobj\n');
  }

  int pageObj(int i) => 4 + i * 3;
  push('%PDF-1.4\n%âãÏÓ\n');
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(
    2,
    () => push(
      '<< /Type /Pages /Kids [${[for (var i = 0; i < pages.length; i++) '${pageObj(i)} 0 R'].join(' ')}] /Count ${pages.length} >>',
    ),
  );
  final d = (date ?? DateTime.now()).toUtc();
  final stamp = 'D:${d.year}${_p2(d.month)}${_p2(d.day)}${_p2(d.hour)}${_p2(d.minute)}${_p2(d.second)}Z';
  obj(
    3,
    () => push(
      '<< /Producer ${pdfText('Stachel')} /Creator ${pdfText('Stachel')} /CreationDate ($stamp)'
      '${title != null && title.isNotEmpty ? ' /Title ${pdfText(title)}' : ''} >>',
    ),
  );
  for (var i = 0; i < pages.length; i++) {
    final p = pages[i];
    final n = pageObj(i);
    final w = _num(p.widthPt), h = _num(p.heightPt);
    obj(
      n,
      () => push(
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 $w $h] /Resources << /XObject << /Im$i ${n + 2} 0 R >> >> '
        '/Contents ${n + 1} 0 R >>',
      ),
    );
    final content = 'q\n$w 0 0 $h 0 0 cm\n/Im$i Do\nQ\n';
    obj(n + 1, () => push('<< /Length ${content.length} >>\nstream\n${content}endstream'));
    obj(n + 2, () {
      final img = p.image;
      push(
        '<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB '
        '/BitsPerComponent 8 /Filter /${img.filter} /Length ${img.data.length} >>\nstream\n',
      );
      push(img.data);
      push('\nendstream');
    });
  }
  final count = 3 + pages.length * 3 + 1;
  final xref = out.length;
  final table = StringBuffer('xref\n0 $count\n0000000000 65535 f \n');
  for (var n = 1; n < count; n++) {
    table.write('${offsets[n].toString().padLeft(10, '0')} 00000 n \n');
  }
  push(table.toString());
  push('trailer\n<< /Size $count /Root 1 0 R /Info 3 0 R >>\nstartxref\n$xref\n%%EOF\n');
  return out.takeBytes();
}

/// RGB bytes from RGBA (straight alpha, as `ui.ImageByteFormat.rawStraightRgba`) mixed onto [bg] (web `rgbaToRgb`).
Uint8List rgbaToRgb(Uint8List rgba, [List<int> bg = const [255, 255, 255]]) {
  final n = rgba.length ~/ 4;
  final out = Uint8List(n * 3);
  for (var i = 0; i < n; i++) {
    final a = rgba[i * 4 + 3] / 255;
    for (var k = 0; k < 3; k++) {
      out[i * 3 + k] = (rgba[i * 4 + k] * a + bg[k] * (1 - a)).round();
    }
  }
  return out;
}

/// Lossless page image from RGBA pixels ([bg] under transparent pixels).
PdfImage pdfImageFromRgba(Uint8List rgba, int width, int height, [List<int> bg = const [255, 255, 255]]) =>
    PdfImage(width: width, height: height, data: Uint8List.fromList(ZLibCodec(level: 6).encode(rgbaToRgb(rgba, bg))));
