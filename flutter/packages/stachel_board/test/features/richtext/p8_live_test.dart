// P8 against the real Stachel server in its sandbox: the rich text actions run the web's code – a check box ticked
// on the board (`richtext.toggleTask`) and the format for the whole object (`richtext.whole`: underline, list, link)
// arrive in the web; what the app's editor writes (quote, code block, nested list, part size in em, link with
// Tiptap's attributes) is accepted by the server (no nack) and arrives unchanged.
//
//   cd stachel && npm --prefix server run build
//   server\node_modules\.bin\tsx.cmd tools/sandbox.mts 8740 --seed
//   flutter test test/features/richtext/p8_live_test.dart --dart-define=STACHEL_SANDBOX=http://127.0.0.1:8740
@Tags(['live'])
library;

import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/src/features/richtext/board_hits.dart';
import 'package:stachel_board/stachel_board.dart';

import '../../live_support.dart';

Map<String, Object?> _para(String t) => {
  'type': 'paragraph',
  'content': [
    {'type': 'text', 'text': t},
  ],
};

void main() {
  late String boardId;
  late String token;

  setUpAll(() async {
    if (liveSkip != null) return;
    token =
        ((await liveHttp('POST', '$sandbox/api/auth/app-session', bearer: 'sandbox-mara', body: {}))! as Map)['token']
            as String;
    final b = await liveHttp(
      'POST',
      '$sandbox/api/boards',
      bearer: token,
      write: true,
      body: {'title': 'P8 live ${DateTime.now().toIso8601String()}'},
    );
    boardId = ((b! as Map)['board'] as Map)['id'] as String;
  });

  test(
    'Kästchen auf dem Board, Format fürs ganze Objekt und Rich-Text des Editors kommen im Web an',
    () async {
      final source = NativeBoardSource(
        base: Uri.parse(sandbox),
        board: boardId,
        token: ({bool fresh = false}) async => token,
        appVersion: '1.26.0+1',
        retryDelays: const [Duration(milliseconds: 100)],
      );
      final c = BoardController(source, presenceInterval: const Duration(milliseconds: 30), boardId: boardId);
      final editor = BoardEditor(controller: c, scene: BoardScene(c.state), camera: CameraController())
        ..textDebounce = Duration.zero;
      final nacks = <String>[];
      c.notices.listen((n) => nacks.add('${n.kind} ${n.error} ${n.message}'));
      final web = await WebPeer.start();
      addTearDown(() async {
        await web.close();
        editor.dispose();
        c.dispose();
      });
      await web.cmd({'cmd': 'open', 'board': boardId});
      await c.start();
      await until(() => c.loaded && c.canEdit);
      expect(c.canAct('richtext.whole'), isTrue);
      expect(c.canAct('richtext.toggleTask'), isTrue);

      // a note with a checklist; tick the second box from the board
      final todo = BoardController.newId();
      c.apply([
        CreateOp([
          {
            'id': todo,
            'type': 'sticky',
            'x': 0,
            'y': 0,
            'w': 200,
            'h': 200,
            'text': 'Eins\nZwei',
            'content': {
              'type': 'doc',
              'content': [
                {
                  'type': 'taskList',
                  'content': [
                    for (final t in ['Eins', 'Zwei'])
                      {
                        'type': 'taskItem',
                        'attrs': {'checked': false},
                        'content': [_para(t)],
                      },
                  ],
                },
              ],
            },
          },
        ]),
      ]);
      await untilAsync(() async => (await web.object(todo)) != null);
      toggleTaskOnBoard(editor, c.state[todo]!, 1);
      await untilAsync(() async => jsonEncode((await web.content(todo)).$1).contains('"checked":true'));
      final (ticked, _) = await web.content(todo);
      final items = ((ticked!['content'] as List).single as Map)['content'] as List;
      expect(
        [for (final i in items) (i as Map)['attrs']],
        [
          {'checked': false},
          {'checked': true},
        ],
      );

      // the whole object: underline, then a bullet list (server runs the web's ops.ts)
      final note = BoardController.newId();
      c.apply([
        CreateOp([
          {'id': note, 'type': 'sticky', 'x': 300, 'y': 0, 'w': 200, 'h': 200, 'text': 'Erste\nZweite'},
        ]),
      ]);
      await untilAsync(() async => (await web.object(note)) != null);
      final u = await c.act('richtext.whole', {
        'ids': [note],
        'op': 'underline',
        'value': true,
      });
      expect(u.ok, isTrue);
      final l = await c.act('richtext.whole', {
        'ids': [note],
        'op': 'list',
        'value': 'bulletList',
      });
      expect((l.result?.data as Map?)?['changed'], [note]);
      final link = await c.act('richtext.whole', {
        'ids': [note],
        'op': 'link',
        'value': 'beispiel.org',
      });
      expect((link.result?.data as Map?)?['href'], 'https://beispiel.org/');
      await untilAsync(() async => jsonEncode((await web.content(note)).$1).contains('bulletList'));
      final (whole, text) = await web.content(note);
      expect(text, 'Erste\nZweite', reason: 'Klartext bleibt');
      final j = jsonEncode(whole);
      expect(j, contains('"underline"'));
      expect(j, contains('https://beispiel.org/'));

      // the editor: quote, code block, nested list, part size, link – the server takes the document as is
      final rich = BoardController.newId();
      c.apply([
        CreateOp([
          {'id': rich, 'type': 'shape', 'shape': 'rect', 'x': 600, 'y': 0, 'w': 300, 'h': 300, 'text': 'A'},
        ]),
      ]);
      await until(() => c.state[rich] != null);
      editor.startEditing(rich);
      final d = editor.editingDoc!;
      editor.textChanged('A\nB\nC');
      editor.formatText((d, a, b) => d.setBlockKind(0, 0, 'quote'));
      editor.formatText((d, a, b) => d.toggleList(2, 4, 'bulletList'));
      editor.formatText((d, a, b) => d.indent(4, 4));
      editor.formatText((d, a, b) => d.setMarkAttr(2, 3, 'textStyle', 'fontSize', '1.5em'));
      editor.formatText((d, a, b) => d.setLink(4, 5, 'beispiel.org'));
      final expected = d.toJson();
      editor.stopEditing();
      await untilAsync(() async => (await web.content(rich)).$2 == 'A\nB\nC');
      final (got, _) = await web.content(rich);
      expect(canonicalJson(got), canonicalJson(expected));
      expect(jsonEncode(got), contains('blockquote'));
      expect(jsonEncode(got), contains('"fontSize":"1.5em"'));
      await until(() => c.pendingCount == 0);
      expect(nacks, isEmpty);
    },
    skip: liveSkip,
    timeout: const Timeout(Duration(minutes: 2)),
  );
}
