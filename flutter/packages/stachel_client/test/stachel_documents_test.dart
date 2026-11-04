// PDF hochladen (`POST /api/boards/:id/files`): Grenzen der Instanz (server `upload-limits.ts`, Sicherheits-Review
// UPL-2) kommen mit dem deutschen Text des Servers an – Speicher voll ist nicht „zu groß“.

import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stachel_board/stachel_board.dart';
import 'package:stachel_client/stachel_client.dart';

import 'support/fake_stachel.dart';

Future<String> _uploadError(http.Response answer) async {
  final client = MockClient((req) async => answer);
  final docs = StachelDocuments(api: HttpStachelBoardsApi(TestStachelClient(client)), boardId: 'b1', client: client);
  try {
    await docs.uploadPdf(Uint8List.fromList([1, 2, 3]), 'plan.pdf');
  } on DocumentError catch (e) {
    return e.message;
  }
  fail('kein Fehler');
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    await StachelSession.clear();
  });

  test('Speicher voll: Text des Servers', () async {
    const text = 'Dein Speicherplatz ist voll (1.024 MB von 1.024 MB belegt).';
    expect(await _uploadError(json({'ok': false, 'error': 'quota_exceeded', 'message': text}, 413)), text);
  });

  test('zu groß: Grenze der Instanz aus dem Server-Text, ohne Text wie bisher', () async {
    expect(await _uploadError(json({'ok': false, 'error': 'too_large', 'message': 'Die PDF ist zu groß (höchstens 5 MB).'}, 413)), 'Die PDF ist zu groß (höchstens 5 MB).');
    expect(await _uploadError(http.Response('', 413)), 'Die PDF ist zu groß (höchstens 15 MB).');
  });

  test('zu viele Uploads: Text des Servers', () async {
    const text = 'Zu viele Uploads in kurzer Zeit. Bitte warte ein paar Minuten und versuch es dann noch einmal.';
    expect(await _uploadError(json({'ok': false, 'error': 'rate_limited', 'message': text}, 429)), text);
  });
}
