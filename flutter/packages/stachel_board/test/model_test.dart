// Board model: parsing every object type of the snapshot (contract §4 + feature docs), unknown types pass through,
// patches (set/unset/created/removed), paint order, rich text.
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

BoardObject obj(Map<String, Object?> m) => BoardObject.fromJson({'id': 'x', 'type': 'sticky', ...m})!;

void main() {
  final snapshot = BoardSnapshot.fromJson(allTypesBoardJson());
  BoardObject byId(String id) => snapshot.objects.firstWhere((o) => o.id == id);

  group('BoardObject aus dem Schnappschuss', () {
    test('alle Typen des Fixtures werden gelesen, nur bekannte gelten als bekannt', () {
      final types = snapshot.objects.map((o) => o.type).toSet();
      expect(types, containsAll(knownObjectTypes), reason: 'das Fixture enthält jeden nativ dargestellten Typ');
      expect(types.difference(knownObjectTypes), {'kanban'});
      expect(byId('unknown-1').isKnownType, isFalse);
      expect(snapshot.skipped, 0);
    });

    test('unbekannter Typ: alle Felder bleiben unverändert erhalten', () {
      final o = byId('unknown-1');
      expect(o.raw['lanes'], 3);
      expect(o.raw['futureField'], {'a': 1});
      final patched = o.patched(set: {'x': 5});
      expect(patched.raw['futureField'], {'a': 1});
      expect(patched.x, 5);
    });

    test('Einträge ohne id/type werden übersprungen und gezählt', () {
      final s = BoardSnapshot.fromJson({
        'objects': [
          {'id': 'a', 'type': 'sticky'},
          {'type': 'sticky'},
          {'id': 'b'},
          {'id': '', 'type': 'text'},
          'kaputt',
          42,
        ],
      });
      expect(s.objects.map((o) => o.id), ['a']);
      expect(s.skipped, 5);
    });

    test('Haftnotiz: Farbe, Tags, Format, Drehung', () {
      final tags = byId('sticky-tags');
      expect(tags.color, '#ffb3d1');
      expect(tags.tags.map((t) => (t.label, t.color)), [('Werbung', '#1763b5'), ('dringend', '#e03131')]);
      final rot = byId('sticky-rotated');
      expect(rot.rotation, 8);
      expect(rot.align, 'left');
      expect(rot.valign, 'top');
    });

    test('Text: Schrift, autoWidth, fontFamily', () {
      final t = byId('text-title');
      expect(t.fontSize, 48);
      expect(t.bold, isTrue);
      expect(t.autoWidth, isTrue);
      expect(t.fontFamily, 'condensed');
    });

    test('Form: Art, Rand, Strichart, Füllung', () {
      expect(byId('shape-cloud').shape, 'cloud');
      final dotted = byId('shape-dotted');
      expect(dotted.dash, 'dotted');
      expect(dotted.fillOpacity, 0);
      expect(dotted.strokeWidth, 4);
      expect(byId('shape-dashed').dash, 'dashed');
    });

    test('Verbinder: Enden, Linienart, Spitzen mit Rückfall auf arrowStart/arrowEnd', () {
      final straight = byId('con-straight');
      expect(straight.from, isA<AttachedEnd>().having((e) => e.objectId, 'id', 'shape-rect'));
      expect(straight.lineStyle, 'straight');
      expect(straight.capStart, 'none');
      expect(straight.capEnd, 'triangle');
      final elbow = byId('con-elbow');
      expect((elbow.from as AttachedEnd).side, 's');
      expect(elbow.lineStyle, 'elbow');
      expect(elbow.capEnd, 'arrow');
      final curved = byId('con-curved');
      expect(curved.capStart, 'circle');
      expect(curved.displayText, 'danach');
      final free = byId('con-free');
      expect(free.from, isA<FreeEnd>().having((e) => (e.x, e.y), 'xy', (1420.0, 340.0)));
      expect(free.capStart, 'diamondOpen');
      expect(free.capEnd, 'triangleOpen');
      // fallback rules (shapes.md)
      expect(obj({'type': 'connector', 'arrowStart': true}).capStart, 'triangle');
      expect(obj({'type': 'connector', 'arrowEnd': false}).capEnd, 'none');
      expect(obj({'type': 'connector', 'capEnd': 'quatsch'}).capEnd, 'triangle');
      expect(obj({'type': 'connector', 'lineStyle': 'wavy'}).lineStyle, 'straight');
      expect(obj({'type': 'connector', 'labelPos': 3}).labelPos, 0.98); // web labelPosOf: 0.02–0.98
    });

    test('kaputte Enden: Seite unbekannt, Punkt nicht endlich', () {
      expect((ConnectorEnd.fromJson({'objectId': 'a', 'side': 'x'}) as AttachedEnd).side, isNull);
      expect(ConnectorEnd.fromJson({'x': double.nan, 'y': 1}), isNull);
      expect(ConnectorEnd.fromJson('a'), isNull);
    });

    test('Stift: Punkte, Textmarker, ungerade/kaputte Punktlisten', () {
      final pen = byId('pen-1');
      expect(pen.points.length, 16);
      expect(byId('pen-marker').marker, isTrue);
      expect(
        obj({
          'type': 'pen',
          'points': [1, 2, 3],
        }).points,
        [1, 2],
      );
      expect(
        obj({
          'type': 'pen',
          'points': [1, 2, 'x', 4],
        }).points,
        [1, 2],
      );
    });

    test('Bild und PDF-Dokument', () {
      expect(byId('image-1').imageId, 'img-1');
      final doc = byId('doc-1');
      expect(doc.docName, 'Lageplan.pdf');
      expect(doc.docCount, 3);
      expect(doc.docPage, 1);
      expect(doc.docPages, {0: 'pg-0', 1: 'pg-1'});
      expect(obj({'type': 'document', 'docCount': 2, 'docPage': 9}).docPage, 1);
    });

    test('Rahmen mit Raster', () {
      final f = byId('frame-grid');
      expect(f.title, 'Rahmen mit Raster');
      expect(f.frameGrid, 80);
      expect(f.frameGridLabels, isTrue);
    });

    test('Karte: Status, Fälligkeit, Tags, zuständig', () {
      final c = byId('card-1');
      expect(c.status, 'doing');
      expect(c.due, '2026-08-20');
      expect(c.assigneeName, 'Jonas Beispiel');
      expect(c.desc, startsWith('Angebot'));
      expect(obj({'type': 'card', 'due': '2026-02-30', 'status': 'later'}).due, isNull);
      expect(obj({'type': 'card', 'status': 'later'}).status, isNull);
    });

    test('Tabelle: Zeilen, Spalten, Zellen, Gewichte, Kopf', () {
      final t = byId('table-1').table!;
      expect(t.rows.length, 4);
      expect(t.cols.length, 3);
      expect(t.cell('r2', 'c2'), 'Mara');
      expect(t.cell('r4', 'c3'), '');
      expect(t.weight('c1'), 2);
      expect(t.weight('c2'), 1);
      expect(byId('table-1').tableHead, 'row');
      expect(
        TableData.fromJson({
          'rows': [],
          'cols': ['a'],
        }),
        isNull,
      );
    });

    test('Mindmap-Knoten: Eltern, Ebene, Seite, eingeklappt, versteckt', () {
      final a = byId('mind-a').mind;
      expect(a.parent, 'mind-root');
      expect(a.level, 1);
      expect(a.side, 'r');
      expect(byId('mind-c').mind.collapsed, isTrue);
      expect(byId('mind-c1').mind.hidden, isTrue);
      expect(isVisibleObject(byId('mind-c1')), isFalse);
    });

    test('Zeitleiste: Spuren, Namen, Einträge; tolerant wie safeTimeline', () {
      final tl = byId('timeline-1');
      expect(tl.tlStart, DateTime.utc(2026, 8, 3));
      expect(tl.tlEnd, DateTime.utc(2026, 9, 6));
      expect(tl.tlUnit, 'week');
      final data = tl.timeline!;
      expect(data.lanes, ['l1', 'l2']);
      expect(data.names['l2'], 'Programm');
      expect(data.items.map((i) => i.id), ['i1', 'i2', 'i3']);
      expect(data.items.last.milestone, isTrue);
      final messy = TimelineData.fromJson({
        'lanes': ['a', 'a', 'b'],
        'items': {
          'x': {'lane': 'gone', 'start': '2026-05-10', 'end': '2026-05-01', 'title': 'T'},
          'y': {'lane': 'b', 'start': 'kaputt'},
        },
      })!;
      expect(messy.lanes, ['a', 'b']);
      expect(messy.items.single.lane, 'a');
      expect(messy.items.single.start, DateTime.utc(2026, 5, 1));
    });

    test('Sticker, Stempel (unbekannt = like), Icon', () {
      expect(byId('sticker-emoji').emoji, '🌵');
      expect(byId('sticker-stamp').stamp, 'heart');
      expect(obj({'type': 'sticker', 'stamp': 'neu'}).stamp, 'like');
      final icon = byId('icon-tent');
      expect(icon.icon, 'tent');
      expect(icon.iconNode.length, 4);
      expect(icon.iconNode.first.$1, 'path');
    });

    test('Zahlen tolerant: fehlend/NaN/negativ', () {
      final o = obj({'x': double.nan, 'y': '3', 'w': -5, 'rotation': 540});
      expect(o.x, 0);
      expect(o.y, 0);
      expect(o.w, 100, reason: 'Vertrag §8.5: fehlend/ungültig = 100');
      expect(obj({'w': 0.5}).w, 1);
      expect(o.rotation, 180);
      expect(obj({'rotation': -190}).rotation, 170);
    });
  });

  group('Rich-Text', () {
    test('Absätze, Marks, Listen, Aufgaben – Klartext wie der Web-Spiegel', () {
      final doc = byId('sticky-rich').richText!;
      expect(doc.plainText, 'Einkauf mit fettem Text\nGetränke\nBecher\nPfand klären');
      expect(doc.blocks.map((b) => b.kind), [
        RichBlockKind.paragraph,
        RichBlockKind.bullet,
        RichBlockKind.bullet,
        RichBlockKind.task,
      ]);
      expect(doc.blocks.first.runs[1].marks.bold, isTrue);
      expect(doc.blocks.last.checked, isTrue);
    });

    test('alle Knoten und Marks aus RICH_TEXT_NODES/RICH_TEXT_MARKS', () {
      final doc = RichDoc.fromJson({
        'type': 'doc',
        'content': [
          {
            'type': 'heading',
            'attrs': {'level': 3},
            'content': [
              {'type': 'text', 'text': 'H'},
            ],
          },
          {
            'type': 'orderedList',
            'attrs': {'start': 4},
            'content': [
              {
                'type': 'listItem',
                'content': [
                  {
                    'type': 'paragraph',
                    'content': [
                      {'type': 'text', 'text': 'vier'},
                    ],
                  },
                  {
                    'type': 'bulletList',
                    'content': [
                      {
                        'type': 'listItem',
                        'content': [
                          {
                            'type': 'paragraph',
                            'content': [
                              {'type': 'text', 'text': 'tief'},
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            'type': 'blockquote',
            'content': [
              {
                'type': 'paragraph',
                'content': [
                  {'type': 'text', 'text': 'Zitat'},
                ],
              },
            ],
          },
          {
            'type': 'codeBlock',
            'content': [
              {'type': 'text', 'text': 'x = 1'},
            ],
          },
          {
            'type': 'paragraph',
            'content': [
              {
                'type': 'text',
                'text': 'a',
                'marks': [
                  {'type': 'italic'},
                  {'type': 'strike'},
                  {'type': 'underline'},
                  {'type': 'code'},
                ],
              },
              {'type': 'hardBreak'},
              {
                'type': 'text',
                'text': 'b',
                'marks': [
                  {
                    'type': 'link',
                    'attrs': {'href': 'https://x'},
                  },
                  {
                    'type': 'highlight',
                    'attrs': {'color': '#ff0000'},
                  },
                  {
                    'type': 'textStyle',
                    'attrs': {'color': '#00ff00'},
                  },
                  {'type': 'futureMark'},
                ],
              },
            ],
          },
          {
            'type': 'futureBlock',
            'content': [
              {'type': 'text', 'text': 'bleibt'},
            ],
          },
        ],
      })!;
      expect(doc.blocks[0].kind, RichBlockKind.heading);
      expect(doc.blocks[0].level, 3);
      expect(doc.blocks[1].kind, RichBlockKind.ordered);
      expect(doc.blocks[1].index, 4);
      expect(doc.blocks[2].kind, RichBlockKind.bullet);
      expect(doc.blocks[2].depth, 1);
      expect(doc.blocks[3].kind, RichBlockKind.quote);
      expect(doc.blocks[4].kind, RichBlockKind.code);
      final a = doc.blocks[5].runs[0].marks;
      expect((a.italic, a.strike, a.underline, a.code), (true, true, true, true));
      expect(doc.blocks[5].runs[1].text, '\n');
      final b = doc.blocks[5].runs[2].marks;
      expect((b.link, b.highlight, b.color), ('https://x', '#ff0000', '#00ff00'));
      expect(doc.blocks[6].plainText, 'bleibt');
      expect(doc.plainText, 'H\nvier\ntief\nZitat\nx = 1\na\nb\nbleibt');
    });

    test('kein ProseMirror-Dokument → null (XML-String eines Clients ohne Rich-Text-Modul)', () {
      expect(RichDoc.fromJson('<paragraph>x</paragraph>'), isNull);
      expect(RichDoc.fromJson({'type': 'paragraph'}), isNull);
    });

    test('alter Client hat nur text geändert: text gilt (Vertrag §4)', () {
      final o = obj({
        'text': 'neu',
        'content': {
          'type': 'doc',
          'content': [
            {
              'type': 'paragraph',
              'content': [
                {'type': 'text', 'text': 'alt'},
              ],
            },
          ],
        },
      });
      expect(o.richText, isNull);
      expect(o.displayText, 'neu');
    });

    test('Objekte ohne content zeigen text', () {
      expect(obj({'text': 'nur Text'}).richText, isNull);
      expect(obj({'text': 'nur Text'}).displayText, 'nur Text');
      expect(RichDoc.plain('a\nb').blocks.length, 2);
    });
  });

  group('BoardState', () {
    test('Reihenfolge: Rahmen unten, dann z byteweise, gleiches z nach id', () {
      final s = BoardState()
        ..applySnapshot(
          BoardSnapshot.fromJson({
            'objects': [
              {'id': 'b', 'type': 'sticky', 'z': 'a1'},
              {'id': 'a', 'type': 'sticky', 'z': 'a1'},
              {'id': 'upper', 'type': 'sticky', 'z': 'Zz'},
              {'id': 'lower', 'type': 'sticky', 'z': 'a0'},
              {'id': 'frame', 'type': 'frame', 'z': 'zzz'},
              {'id': 'broken', 'type': 'sticky', 'z': 42},
            ],
          }),
          rev: 1,
          epoch: 'e',
        );
      // byte order: 'Z' (0x5A) < 'a' (0x61), unlike localeCompare
      expect(s.ordered.map((o) => o.id), ['frame', 'broken', 'upper', 'lower', 'a', 'b']);
      expect(s.orderOf('a'), 4);
      expect(s.orderOf('nope'), -1);
    });

    test('Patches: setzen, entfernen, anlegen, löschen; alte Revisionen werden ignoriert', () {
      final s = BoardState()
        ..applySnapshot(
          BoardSnapshot.fromJson({
            'objects': [
              {'id': 'n', 'type': 'sticky', 'x': 0, 'dash': 'dashed', 'z': 'a'},
              {'id': 'gone', 'type': 'sticky', 'z': 'b'},
            ],
          }),
          rev: 10,
          epoch: 'e1',
        );
      final v0 = s.version;
      final changed = s.applyPatch(
        PatchMessage.fromJson({
          't': 'patch',
          'rev': 11,
          'by': 'm:7',
          'changes': [
            {
              'id': 'n',
              'set': {'x': 40},
              'unset': ['dash'],
            },
            {'id': 'gone', 'removed': true},
            {
              'id': 'new',
              'created': {'type': 'text', 'text': 'Hallo', 'z': 'c'},
            },
            {
              'id': 'unknown',
              'set': {'x': 1},
            },
          ],
        }),
      );
      expect(changed, {'n', 'gone', 'new'});
      expect(s['n']!.x, 40);
      expect(s['n']!.raw.containsKey('dash'), isFalse);
      expect(s['gone'], isNull);
      expect(s['new']!.text, 'Hallo');
      expect(s['unknown'], isNull);
      expect(s.rev, 11);
      expect(s.version, greaterThan(v0));
      // replayed patch (e.g. after resume) changes nothing
      final again = s.applyPatch(
        PatchMessage.fromJson({
          't': 'patch',
          'rev': 11,
          'changes': [
            {
              'id': 'n',
              'set': {'x': 999},
            },
          ],
        }),
      );
      expect(again, isEmpty);
      expect(s['n']!.x, 40);
    });

    test('id und type ändert ein Patch nie', () {
      final o = obj({'id': 'keep'}).patched(set: {'id': 'other', 'type': 5});
      expect(o.id, 'keep');
      expect(o.type, 'sticky');
    });
  });
}
