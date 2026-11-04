// N07 Sichtvergleich: Export „Ganzes Board“ (Normal) der App vom selben Sandbox-Board wie der Web-Export. Schreibt
// das PNG nach --dart-define=N07_OUT=<datei> (zum Ansehen neben dem Web-Export); prüft Größe und Rand wie das Web.
// Aufruf wie die anderen Live-Tests, zusätzlich --dart-define=N07_BOARD=<board-id> (Sandbox „Alle Typen“).
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';
import 'package:stachel_board/src/features/export/export_pages.dart';
import 'package:stachel_board/src/features/export/render_board.dart';

import '../live_support.dart';
import '../test_fonts.dart';

const _board = String.fromEnvironment('N07_BOARD');
const _out = String.fromEnvironment('N07_OUT');

void main() {
  test(
    'Export der App vom Board „Alle Typen“ (Ganzes Board, Normal)',
    () async {
      final token =
          ((await liveHttp('POST', '$sandbox/api/auth/app-session', bearer: 'sandbox-mara', body: {}))! as Map)['token']
              as String;
      final source = NativeBoardSource(
        base: Uri.parse(sandbox),
        board: _board,
        token: ({bool fresh = false}) async => token,
        appVersion: '1.27.0+36',
      );
      final c = BoardController(source, presenceInterval: Duration.zero);
      addTearDown(c.dispose);
      await c.start();
      await until(() => c.loaded && !c.fromCache, timeout: const Duration(seconds: 20));
      final editor = BoardEditor(controller: c, scene: BoardScene(c.state), camera: CameraController());
      addTearDown(editor.dispose);
      final ui0 = BoardUi(editor: editor, registry: standardBoardRegistry());

      // the board's images (tier 1024) like the app's HttpBoardImages would load them
      final images = MemoryBoardImages();
      for (final o in c.state.ordered) {
        final id = o.type == 'image' ? o.imageId : (o.type == 'document' ? (o.docPages[o.docPage] ?? o.imageId) : null);
        if (id == null) continue;
        final client = HttpClient();
        final req = await client.getUrl(Uri.parse('$sandbox/api/images/$id?w=1024'));
        req.headers.set('Authorization', 'Bearer $token');
        final res = await req.close();
        final bytes = await res.fold<BytesBuilder>(BytesBuilder(), (b, d) => b..add(d));
        client.close();
        if (res.statusCode != 200) continue;
        final codec = await ui.instantiateImageCodec(bytes.takeBytes());
        images.put(id, (await codec.getNextFrame()).image);
      }

      // the test binding (BoardUi.view asks it) only now: it would block the real HTTP above
      TestWidgetsFlutterBinding.ensureInitialized();
      await loadBoardFonts();
      editor.scene.bounds;
      final pages = exportPages(
        c.state.ordered,
        const {},
        const ExportBoardArea(),
        (o) => boardObjectBounds(editor.scene, o),
      );
      expect(pages, hasLength(1));
      final page = pages.single;
      final img = await renderBoardRegion(
        ui0,
        world: page.rect,
        scale: clampScale(page.rect, 1),
        objects: page.objects,
        images: images,
        fonts: const BoardFonts(),
        imageWait: Duration.zero,
      );
      final png = await img.toByteData(format: ui.ImageByteFormat.png);
      if (_out.isNotEmpty) File(_out).writeAsBytesSync(png!.buffer.asUint8List());
      // ignore: avoid_print
      print('N07 App-Export ${img.width}×${img.height} (${page.rect})');
      source.close();
    },
    skip: liveSkip ?? (_board.isEmpty ? 'N07_BOARD fehlt' : null),
    timeout: const Timeout(Duration(minutes: 2)),
  );
}
