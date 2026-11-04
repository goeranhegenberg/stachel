// P2 stickers and icons (parity audit C16, E14, J03–J05): the web's stamps/emoji/icons from the constants, placing
// like `objectFor` (72² / 96² / 64²), stamps stay active, emoji and icons are selected, recently used emoji per
// device, the library's sticker and icon tabs with search, the icon's color and line width, stamps drawn from the
// web's SVG.

import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/src/features/stickers/sticker_data.dart';
import 'package:stachel_board/stachel_board.dart';

import '../shapes/p2_board.dart';

void main() {
  setUp(RecentEmoji.resetForTest);

  group('Daten wie im Web', () {
    test('8 Stempel, 8 Emoji-Gruppen, 268 Icons in 11 Gruppen; Suche ≤ 160 mit deutschen Stichwörtern', () {
      expect(stamps.map((s) => s.id), ['like', 'heart', 'check', 'question', 'plusOne', 'star', 'exclaim', 'dislike']);
      expect(emojiGroups, hasLength(8));
      expect(emojiGroups.first.label, 'Smileys');
      expect(icons, hasLength(268));
      expect(iconGroups, hasLength(11));
      expect(searchEmoji('glück').map((e) => e.ch), containsAll(['😃', '🤞', '🍀']));
      expect(searchEmoji('gluecklich').map((e) => e.ch), ['😃'], reason: 'Umlaute wie ae/oe/ue');
      expect(allEmoji.map((e) => e.ch).toSet().length, allEmoji.length, reason: 'jedes Zeichen einmal');
    });

    test('Objekte wie objectFor: Stempel 72², Emoji 96², Icon 64² mit iconNode und Farbe', () {
      expect(stickerObjectFor(const StampItem('heart'), 100, 100), {
        'type': 'sticker',
        'stamp': 'heart',
        'x': 64.0,
        'y': 64.0,
        'w': 72.0,
        'h': 72.0,
      });
      expect(stickerObjectFor(const EmojiItem('🎉'), 100.4, 99.5)['x'], 52.0);
      final star = icons.firstWhere((i) => i.name == 'star');
      final o = stickerObjectFor(IconItem(star), 0, 0);
      expect((o['type'], o['icon'], o['w'], o['color']), ('icon', 'star', 64.0, '#0a0a0a'));
      expect(o['iconNode'], same(star.node));
    });

    test('zuletzt verwendet: Standard wie im Web, 12, vorn eingereiht, gespeichert', () async {
      expect(RecentEmoji.list, defaultRecentEmoji);
      final stored = <String, String>{};
      for (var i = 0; i < 14; i++) {
        RecentEmoji.remember('$i', (k, v) async => stored[k] = v);
      }
      RecentEmoji.remember('3', (k, v) async => stored[k] = v);
      expect(RecentEmoji.list, hasLength(12));
      expect(RecentEmoji.list.first, '3');
      RecentEmoji.resetForTest();
      await RecentEmoji.load((k) async => stored[k]);
      expect(RecentEmoji.list.take(2), ['3', '13']);
    });
  });

  group('Sticker-Werkzeug (C16)', () {
    testWidgets('unter „···“; Stempel bleibt aktiv (zweimal stempeln, nichts gewählt), Emoji wird gewählt', (
      tester,
    ) async {
      final b = await pumpP2Board(tester);
      await tester.tap(find.byKey(const Key('stachelToolMore')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('stachelMoreSticker')));
      await tester.pumpAndSettle();
      expect(b.editor.activeToolId, 'shapes.sticker');
      expect(find.byKey(const Key('stachelStickerOptions')), findsOneWidget);
      for (final s in stamps) {
        expect(find.byKey(Key('stachelSticker-stamp-${s.id}')), findsOneWidget);
      }
      expect(find.byKey(const Key('stachelSticker-emoji-👍')), findsOneWidget, reason: '4 zuletzt verwendete');
      await tester.tap(find.byKey(const Key('stachelSticker-stamp-check')));
      await tester.pump();
      await b.tapWorld(const Offset(100, 100));
      await b.tapWorld(const Offset(300, 100));
      expect(b.ops.where((o) => o['op'] == 'create'), hasLength(2));
      expect(b.created.single['stamp'], 'check');
      expect(b.editor.activeToolId, 'shapes.sticker', reason: 'Stempel bleibt aktiv');
      expect(b.editor.selection.value, isEmpty);

      await tester.tap(find.byKey(const Key('stachelSticker-emoji-🎉')));
      await tester.pump();
      await b.tapWorld(const Offset(500, 300));
      final e = b.created.single;
      expect((e['emoji'], e['w']), ('🎉', 96.0));
      expect(b.editor.tool, BoardTool.select);
      expect(b.editor.selection.value, {e['id']});
      expect(RecentEmoji.list.first, '🎉');
      expect(b.host.settings[recentEmojiSetting], contains('🎉'), reason: 'je Gerät gespeichert');
    });

    testWidgets('Bibliothek: Sticker-Suche, „Nichts gefunden.“; Icons nach Gruppen, Icon setzen und Strichstärke', (
      tester,
    ) async {
      final b = await pumpP2Board(tester);
      b.editor.useTool('shapes.sticker');
      await tester.pump();
      await tester.tap(find.byKey(const Key('stachelStickerAll')));
      await tester.pumpAndSettle();
      expect(find.text('STEMPEL'), findsOneWidget);
      expect(find.text('ZULETZT VERWENDET'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('stachelLibSearch')), 'stempel');
      await tester.pump();
      expect(find.byKey(const Key('stachelLib-search-stamp-like')), findsOneWidget);
      await tester.enterText(find.byKey(const Key('stachelLibSearch')), 'qqqq');
      await tester.pump();
      expect(find.text('Nichts gefunden.'), findsOneWidget);
      await tester.tap(find.byKey(const Key('stachelLibTab-icons')));
      await tester.pumpAndSettle();
      expect(find.text('ALLGEMEIN'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('stachelLibSearch')), 'stern');
      await tester.pump();
      await tester.tap(find.byKey(const Key('stachelLib-search-icon-star')));
      await tester.pumpAndSettle();
      expect(
        find.byKey(const Key('stachelSticker-icon-star')),
        findsOneWidget,
        reason: 'gewähltes Icon in den Optionen',
      );
      await b.tapWorld(const Offset(200, 200));
      final o = b.created.single;
      expect((o['type'], o['icon'], o['w']), ('icon', 'star', 64.0));
      expect(b.editor.selection.value, {o['id']});

      // E14: ink colors and line width 1 / 1,5 / 2 / 2,5 / 3 (2 = field removed)
      await b.ctx('stachelCtxColor');
      expect(find.byKey(const Key('stachelColor-#7048e8')), findsOneWidget);
      await tester.tap(find.byKey(const Key('stachelColor-#7048e8')));
      await tester.pumpAndSettle();
      expect(b.patches, {
        o['id']: {'color': '#7048e8'},
      });
      await b.ctx('stachelIconStroke-1,5');
      expect(b.patches, {
        o['id']: {'strokeWidth': 1.5},
      });
      await b.ctx('stachelIconStroke-2');
      expect(b.patches, {
        o['id']: {'strokeWidth': null},
      });
    });
  });

  test('Stempel wie das SVG des Webs: Plakette in der Stempelfarbe, Glyphe in der Schriftfarbe', () async {
    for (final s in stamps) {
      final rec = ui.PictureRecorder();
      paintStamp(Canvas(rec), s, 64);
      final img = await rec.endRecording().toImage(64, 64);
      final data = (await img.toByteData())!;
      Color at(int x, int y) {
        final i = (y * 64 + x) * 4;
        return Color.fromARGB(data.getUint8(i + 3), data.getUint8(i), data.getUint8(i + 1), data.getUint8(i + 2));
      }

      final bg = Color(int.parse('FF${s.bg.substring(1)}', radix: 16));
      expect(at(32, 4), bg, reason: '${s.id}: Rand der Plakette');
      expect(at(1, 1).a, 0, reason: '${s.id}: außen frei');
    }
  });
}
