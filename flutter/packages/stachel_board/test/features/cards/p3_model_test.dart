// P3 without widgets (parity audit I02–I15, I29, D23): live text fields like the web's ytext.ts, card height / table
// rows / „Einfügen als …“ equal to the web code (reference values `structure_reference.json` from
// stachel/tools/native-template-fixtures.mts, same font metrics), the template catalog and its previews, the size rules
// at the side handles.

import 'dart:convert';
import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart' hide tagColors; // P1's note tags; here the card's
import 'package:stachel_board/src/features/cards/card_model.dart';
import 'package:stachel_board/src/features/cards/live_text.dart';
import 'package:stachel_board/src/features/cards/register.dart';
import 'package:stachel_board/src/features/tables/table_model.dart';
import 'package:stachel_board/src/features/templates/template_model.dart' as tm;

final _ref =
    jsonDecode(File('test/features/cards/structure_reference.json').readAsStringSync()) as Map<String, Object?>;

BoardObject _obj(Object? j) => BoardObject((j! as Map).cast<String, Object?>());

void main() {
  group('Live-Text (web ytext.ts)', () {
    test('spliceOf, mapPos, rebase wie im Web', () {
      expect(spliceOf('Hallo', 'Hallo Welt'), const Splice(5, 0, ' Welt'));
      expect(spliceOf('abc', 'aXc'), const Splice(1, 1, 'X'));
      expect(mapPos(3, 'Hallo', 'Ja Hallo'), 6);
      expect(mapPos(1, 'Hallo', 'Hallo!'), 1);
      // eigene Änderung hinter einer fremden: verschoben
      expect(applySplice('1. Bühne', rebase('Bühne', 'Bühne A', '1. Bühne')), '1. Bühne A');
      // überlappend: schon fremd Gelöschtes nicht noch einmal löschen
      expect(applySplice('Bxe', rebase('Bühne', 'Bühn', 'Bxe')), isNotEmpty);
    });

    test(
      'LiveText: sendet mit Basis (gedrosselt), übernimmt fremde Änderungen, eigene ungesendete Zeichen bleiben',
      () async {
        var board = 'Strom';
        final sent = <(String, String)>[];
        final live = LiveText(
          read: () => board,
          send: (b, t) => sent.add((b, t)),
          debounce: const Duration(milliseconds: 5),
        );
        expect(live.controller.text, 'Strom');
        live.controller.value = const TextEditingValue(text: 'Strom!', selection: TextSelection.collapsed(offset: 6));
        expect(live.dirty, isTrue);
        // jemand tippt vorne, bevor gesendet wurde: Feld = beides, Schreibmarke bleibt hinter dem eigenen Zeichen
        board = 'Viel Strom';
        live.pull();
        expect(live.controller.text, 'Viel Strom!');
        expect(live.controller.selection.baseOffset, 11);
        await Future<void>.delayed(const Duration(milliseconds: 20));
        expect(sent, [('Viel Strom', 'Viel Strom!')]);
        // Server führt zusammen und schickt den Stand zurück
        board = 'Viel Strom!';
        live.pull();
        expect((live.controller.text, live.dirty), ('Viel Strom!', false));
        // fremde Änderung ohne eigene Eingabe: Feld folgt
        board = 'Viel Strom! (erledigt)';
        live.pull();
        expect(live.controller.text, 'Viel Strom! (erledigt)');
        live.dispose();
      },
    );
  });

  group('Karten (web card/model.ts)', () {
    test(
      'Höhe aus dem Inhalt = Referenzwerte des Web-Codes (Titel, Beschreibung ≤ 4 Zeilen, Fußzeile mit Umbruch)',
      () {
        final now = DateTime(2026, 1, 5, 12);
        for (final c in (_ref['cards']! as List).cast<Map<String, Object?>>()) {
          final o = _obj(c['card']);
          expect(cardContentHeight(o, now: now), (c['h']! as num).toDouble(), reason: o.text);
        }
      },
    );

    test('Fällig: deutsches Kurzformat, Jahr nur wenn nicht dieses; überfällig nur offen', () {
      final now = DateTime(2026, 1, 5);
      expect(formatDue('2026-01-12', now), '12. Jan.');
      expect(formatDue('2026-06-03', now), '3. Juni');
      expect(formatDue('2027-03-01', now), '1. März 2027');
      BoardObject card(Map<String, Object?> f) => BoardObject({'id': 'k', 'type': 'card', ...f});
      expect(isOverdue(card({'due': '2026-01-04'}), now), isTrue);
      expect(isOverdue(card({'due': '2026-01-04', 'status': 'done'}), now), isFalse);
      expect(isOverdue(card({'due': '2026-01-05'}), now), isFalse);
    });

    test('Farben, Status, Initialen, Textfarbe wie im Web', () {
      expect(cardColors, hasLength(8));
      expect(cardColors.first, '#1763b5');
      expect(tagColors, hasLength(8));
      expect([for (final s in cardStatuses) s.label], ['Offen', 'In Arbeit', 'Blockiert', 'Erledigt']);
      expect(initialsOf('Mara Beispiel'), 'MB');
      expect(initialsOf('jonas'), 'JO');
      expect(webTextOn('#0a0a0a'), const Color(0xFFFFFFFF));
      expect(webTextOn('#c9e14a'), BoardColors.ink);
      expect(WebConstants.instance.strings('colors.user'), contains(userColorOf('m:7')));
    });

    test('Seitengriffe: Breite ≥ 160, Höhe aus dem Inhalt, linker Griff hält die rechte Kante', () {
      final o = BoardObject({
        'id': 'k',
        'type': 'card',
        'x': 100,
        'y': 0,
        'w': 300,
        'h': 96,
        'text': 'Bühne aufbauen und Strom verlegen',
      });
      final r = cardResize(o, {'x': 330.0, 'y': 0.0, 'w': 70.0, 'h': 96.0}, 'w');
      expect(r['w'], 160);
      expect(r['x'], 240);
      expect(r['h'], cardContentHeight(BoardObject({...o.raw, 'w': 160})));
      expect(r['h'], greaterThan(cardContentHeight(o)));
    });
  });

  group('Tabellen (web table/model.ts)', () {
    test('Spaltenbreiten, Zeilenhöhen, Höhe = Referenzwerte des Web-Codes', () {
      for (final t in (_ref['tables']! as List).cast<Map<String, Object?>>()) {
        final d = TableData.fromJson(t['table'])!;
        final w = (t['w']! as num).toDouble();
        final head = t['head'] == true;
        final ws = colWidths(d, w);
        expect(ws, [for (final x in t['widths']! as List) (x as num).toDouble()]);
        expect(rowHeights(d, ws, boldRow0: head), [for (final x in t['rows']! as List) (x as num).toDouble()]);
        expect(tableHeight(d, w, boldRow0: head), (t['h']! as num).toDouble());
      }
    });

    test('Nachbarzellen (Tab, Umschalt-Tab, Enter) und Zelle unter dem Finger', () {
      const d = TableData(rows: ['r1', 'r2'], cols: ['c1', 'c2'], cells: {}, widths: {});
      expect(nextCell(d, (r: 'r1', c: 'c2'), 'next'), (r: 'r2', c: 'c1'));
      expect(nextCell(d, (r: 'r2', c: 'c1'), 'prev'), (r: 'r1', c: 'c2'));
      expect(nextCell(d, (r: 'r1', c: 'c1'), 'down'), (r: 'r2', c: 'c1'));
      expect(nextCell(d, (r: 'r2', c: 'c2'), 'next'), isNull);
      final g = TableGeometry(
        BoardObject({
          'id': 't',
          'type': 'table',
          'w': 400,
          'h': 84,
          'table': {'rows': d.rows, 'cols': d.cols, 'cells': {}, 'widths': {}},
        }),
      );
      expect(g.cellAt(250, 60), (r: 'r2', c: 'c2'));
      expect(g.cellAt(-5, 2), (r: 'r1', c: 'c1'));
      expect(g.boxOf((r: 'r2', c: 'c2')), (x: 200.0, y: 42.0, w: 200.0, h: 42.0));
    });

    test('Seitengriffe: mindestens 48 je Spalte, Höhe aus den Zellen', () {
      final o = BoardObject({
        'id': 't',
        'type': 'table',
        'x': 0,
        'y': 0,
        'w': 480,
        'h': 84,
        'table': {
          'rows': ['r1', 'r2'],
          'cols': ['c1', 'c2', 'c3'],
          'cells': {'r2:c1': 'Ein langer Text, der bei schmaler Tabelle umbricht'},
          'widths': {},
        },
      });
      final r = tableResize(o, {'x': 0.0, 'y': 0.0, 'w': 100.0, 'h': 84.0});
      expect(r['w'], 144);
      expect(r['h'], greaterThan(84));
    });
  });

  group('Einfügen als … (web paste-model.ts)', () {
    test('Tabellendaten/Zeilen = Referenzwerte des Web-Codes', () {
      for (final p in (_ref['pastes']! as List).cast<Map<String, Object?>>()) {
        final c = tm.pasteChoice(p['text']! as String);
        final want = p['choice'] as Map<String, Object?>?;
        if (want == null) {
          expect(c, isNull, reason: p['text'] as String);
          continue;
        }
        expect(c!.lines, want['lines']);
        expect(
          c.table,
          want['table'] == null ? isNull : [for (final r in want['table']! as List) (r as List).cast<String>()],
        );
      }
      expect(tm.pasteNotesCount(tm.pasteChoice('a\tb\n\tc')!), 3);
    });
  });

  group('Vorlagen', () {
    test('Galerie aus den Web-Konstanten, Suche, Kategorien, „Enthält“, Vorschau-Objekte passend', () {
      expect(tm.boardTemplates, hasLength(27)); // Q2: +16
      expect(tm.templateCategories, ['Planung', 'Ideen', 'Abläufe', 'Events']);
      final kanban = tm.boardTemplates.first;
      expect((kanban.id, kanban.name, kanban.category), ('kanban', 'Kanban', 'Planung'));
      expect(tm.templateContents(kanban), ['1 Rahmen', '7 Karten', '6 Formen']);
      expect(tm.filterTemplates('Events', '').map((t) => t.id), [
        'festival',
        'shifts',
        'siteplan',
        'dayplan',
        'buildshifts',
        'awareness',
        'stageplot',
        'briefing',
        'festretro',
        'budget',
      ]);
      expect(tm.filterTemplates(null, 'schicht').map((t) => t.id), ['shifts', 'buildshifts', 'briefing']);
      expect(tm.filterTemplates(null, 'gibt es nicht'), isEmpty);
      for (final t in tm.boardTemplates) {
        final objs = tm.templateObjects(t.id);
        final counts = <String, int>{};
        for (final o in objs) {
          counts[o.type] = (counts[o.type] ?? 0) + 1;
        }
        expect(counts, t.contains, reason: t.id);
      }
      // Bezüge zeigen auf Objekte derselben Vorlage
      final flow = tm.templateObjects('flow');
      final ids = {for (final o in flow) o.id};
      for (final c in flow.where((o) => o.type == 'connector')) {
        expect(ids, contains((c.raw['from']! as Map)['objectId']));
      }
    });
  });
}
