import '../geometry/shape_paths.dart';

/// Snapshot (`welcome.snapshot`, concept §4.3) with every object type and shape the native app renders, plus one
/// unknown type and one hidden object. Used by the debug screen, the golden test and the model tests.
///
/// Hand-written after `shared/protocol.ts` and `docs/features/*.md` until the server's `--seed` board /
/// `docs/native_fixtures/` exist; then this fixture is compared against (or replaced by) the server's export.
Map<String, Object?> allTypesBoardJson() {
  final objects = <Map<String, Object?>>[];
  var z = 0;
  String nz() => 'a${(z++).toString().padLeft(4, '0')}';
  void add(Map<String, Object?> o) =>
      objects.add({'z': nz(), 'createdBy': 'm:1', 'updatedAt': '2026-11-01T10:00:00Z', ...o});

  // frames (below everything)
  add({
    'id': 'frame-main',
    'type': 'frame',
    'x': -40,
    'y': -60,
    'w': 2240,
    'h': 1900,
    'title': 'Alle Objekttypen',
    'color': '#ffffff',
  });
  add({
    'id': 'frame-grid',
    'type': 'frame',
    'x': 1580,
    'y': 1360,
    'w': 560,
    'h': 380,
    'title': 'Rahmen mit Raster',
    'color': '#fdfdf6',
    'frameGrid': 80,
    'frameGridLabels': true,
  });

  // sticky notes
  add({
    'id': 'sticky-plain',
    'type': 'sticky',
    'x': 0,
    'y': 0,
    'w': 200,
    'h': 200,
    'color': '#fff27a',
    'text': 'Bühne aufbauen bis Freitag',
  });
  add({
    'id': 'sticky-rich',
    'type': 'sticky',
    'x': 230,
    'y': 0,
    'w': 350,
    'h': 200,
    'color': '#c9e14a',
    'text': 'Einkauf mit fettem Text\nGetränke\nBecher\nPfand klären',
    'content': {
      'type': 'doc',
      'content': [
        {
          'type': 'paragraph',
          'content': [
            {'type': 'text', 'text': 'Einkauf mit '},
            {
              'type': 'text',
              'text': 'fettem',
              'marks': [
                {'type': 'bold'},
              ],
            },
            {'type': 'text', 'text': ' Text'},
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
                    {'type': 'text', 'text': 'Getränke'},
                  ],
                },
              ],
            },
            {
              'type': 'listItem',
              'content': [
                {
                  'type': 'paragraph',
                  'content': [
                    {'type': 'text', 'text': 'Becher'},
                  ],
                },
              ],
            },
          ],
        },
        {
          'type': 'taskList',
          'content': [
            {
              'type': 'taskItem',
              'attrs': {'checked': true},
              'content': [
                {
                  'type': 'paragraph',
                  'content': [
                    {'type': 'text', 'text': 'Pfand klären'},
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  });
  add({
    'id': 'sticky-tags',
    'type': 'sticky',
    'x': 610,
    'y': 0,
    'w': 200,
    'h': 200,
    'color': '#ffb3d1',
    'text': 'Plakate drucken',
    'tags': [
      {'label': 'Werbung', 'color': '#1763b5'},
      {'label': 'dringend', 'color': '#e03131'},
    ],
  });
  add({
    'id': 'sticky-rotated',
    'type': 'sticky',
    'x': 840,
    'y': 0,
    'w': 200,
    'h': 200,
    'color': '#9fd3ff',
    'text': 'Gedreht um 8°',
    'rotation': 8,
    'align': 'left',
    'valign': 'top',
  });

  // text
  add({
    'id': 'text-title',
    'type': 'text',
    'x': 1100,
    'y': 0,
    'w': 420,
    'h': 60,
    'text': 'Sommerfest 2027',
    'fontSize': 48,
    'bold': true,
    'autoWidth': true,
    'fontFamily': 'condensed',
  });
  add({
    'id': 'text-rich',
    'type': 'text',
    'x': 1100,
    'y': 80,
    'w': 420,
    'h': 120,
    'fontSize': 20,
    'text': 'Ablauf\nEinlass ab 14 Uhr – mehr auf example.org',
    'content': {
      'type': 'doc',
      'content': [
        {
          'type': 'heading',
          'attrs': {'level': 2},
          'content': [
            {'type': 'text', 'text': 'Ablauf'},
          ],
        },
        {
          'type': 'paragraph',
          'content': [
            {'type': 'text', 'text': 'Einlass ab '},
            {
              'type': 'text',
              'text': '14 Uhr',
              'marks': [
                {
                  'type': 'highlight',
                  'attrs': {'color': '#fff27a'},
                },
              ],
            },
            {'type': 'text', 'text': ' – mehr auf '},
            {
              'type': 'text',
              'text': 'example.org',
              'marks': [
                {
                  'type': 'link',
                  'attrs': {'href': 'https://example.org'},
                },
              ],
            },
          ],
        },
      ],
    },
  });

  // all 41 shapes, 7 per row
  for (var i = 0; i < shapeKinds.length; i++) {
    final kind = shapeKinds[i];
    add({
      'id': 'shape-$kind',
      'type': 'shape',
      'shape': kind,
      'x': (i % 7) * 170,
      'y': 300 + (i ~/ 7) * 120,
      'w': 150,
      'h': 96,
      'color': i.isEven ? '#ffffff' : '#c9e14a',
      'stroke': '#0a0a0a',
      'strokeWidth': 2,
      'text': kind,
      'fontSize': 16,
    });
  }
  add({
    'id': 'shape-dashed',
    'type': 'shape',
    'shape': 'roundrect',
    'x': 1220,
    'y': 300,
    'w': 160,
    'h': 96,
    'color': '#ffffff',
    'stroke': '#1763b5',
    'strokeWidth': 4,
    'dash': 'dashed',
    'text': 'gestrichelt',
  });
  add({
    'id': 'shape-dotted',
    'type': 'shape',
    'shape': 'ellipse',
    'x': 1220,
    'y': 420,
    'w': 160,
    'h': 96,
    'color': '#ec4e92',
    'fillOpacity': 0,
    'stroke': '#ec4e92',
    'strokeWidth': 4,
    'dash': 'dotted',
    'text': 'gepunktet, ohne Füllung',
  });
  add({
    'id': 'shape-unknown-kind',
    'type': 'shape',
    'shape': 'hyperbolicThing',
    'x': 1220,
    'y': 540,
    'w': 160,
    'h': 96,
    'color': '#ffd08a',
    'text': 'unbekannte Form = Rechteck',
  });

  // connectors
  add({
    'id': 'con-straight',
    'type': 'connector',
    'x': 0,
    'y': 0,
    'w': 1,
    'h': 1,
    'from': {'objectId': 'shape-rect'},
    'to': {'objectId': 'shape-diamond'},
    'color': '#0a0a0a',
    'strokeWidth': 2,
    'arrowEnd': true,
  });
  add({
    'id': 'con-elbow',
    'type': 'connector',
    'x': 0,
    'y': 0,
    'w': 1,
    'h': 1,
    'from': {'objectId': 'sticky-plain', 'side': 's'},
    'to': {'objectId': 'shape-rect', 'side': 'n'},
    'lineStyle': 'elbow',
    'color': '#1763b5',
    'strokeWidth': 3,
    'capEnd': 'arrow',
    'arrowEnd': true,
  });
  add({
    'id': 'con-curved',
    'type': 'connector',
    'x': 0,
    'y': 0,
    'w': 1,
    'h': 1,
    'from': {'objectId': 'sticky-tags'},
    'to': {'objectId': 'sticky-rotated'},
    'lineStyle': 'curved',
    'color': '#ec4e92',
    'strokeWidth': 2,
    'text': 'danach',
    'capStart': 'circle',
    'arrowStart': true,
  });
  add({
    'id': 'con-free',
    'type': 'connector',
    'x': 0,
    'y': 0,
    'w': 1,
    'h': 1,
    'from': {'x': 1420, 'y': 340},
    'to': {'x': 1700, 'y': 460},
    'dash': 'dashed',
    'color': '#0a0a0a',
    'strokeWidth': 2,
    'capStart': 'diamondOpen',
    'arrowStart': true,
    'capEnd': 'triangleOpen',
  });
  add({
    'id': 'con-dotted',
    'type': 'connector',
    'x': 0,
    'y': 0,
    'w': 1,
    'h': 1,
    'from': {'x': 1420, 'y': 520},
    'to': {'x': 1700, 'y': 520},
    'dash': 'dotted',
    'color': '#7aa21b',
    'strokeWidth': 3,
    'capEnd': 'bar',
    'arrowEnd': true,
  });

  // pen strokes
  add({
    'id': 'pen-1',
    'type': 'pen',
    'x': 1420,
    'y': 580,
    'w': 300,
    'h': 120,
    'color': '#1763b5',
    'strokeWidth': 4,
    'points': [0, 60, 40, 10, 80, 100, 120, 20, 160, 90, 200, 30, 240, 80, 290, 50],
  });
  add({
    'id': 'pen-marker',
    'type': 'pen',
    'x': 1420,
    'y': 640,
    'w': 300,
    'h': 40,
    'color': '#ffe14d',
    'strokeWidth': 20,
    'marker': true,
    'points': [10, 20, 290, 20],
  });

  // image (average color until the image is loaded)
  add({
    'id': 'image-1',
    'type': 'image',
    'x': 0,
    'y': 1100,
    'w': 240,
    'h': 160,
    'imageId': 'img-1',
    'color': '#8fb3d9',
  });

  // card
  add({
    'id': 'card-1',
    'type': 'card',
    'x': 270,
    'y': 1100,
    'w': 300,
    'h': 170,
    'text': 'Toiletten bestellen',
    'desc': 'Angebot von Fa. Klo-Mobil vergleichen, 6 Kabinen + 1 barrierefrei.',
    'status': 'doing',
    'due': '2026-08-20',
    'tags': [
      {'label': 'Infrastruktur', 'color': '#7048e8'},
    ],
    'assignee': {'key': 'm:7', 'name': 'Jonas Beispiel'},
    'color': '#1763b5',
  });

  // table
  add({
    'id': 'table-1',
    'type': 'table',
    'x': 600,
    'y': 1100,
    'w': 420,
    'h': 168,
    'color': '#0a0a0a',
    'table': {
      'rows': ['r1', 'r2', 'r3', 'r4'],
      'cols': ['c1', 'c2', 'c3'],
      'cells': {
        'r1:c1': 'Was',
        'r1:c2': 'Wer',
        'r1:c3': 'Bis',
        'r2:c1': 'Bühne',
        'r2:c2': 'Mara',
        'r2:c3': 'Fr',
        'r3:c1': 'Strom',
        'r3:c2': 'Lena',
        'r3:c3': 'Do',
        'r4:c1': 'Bar',
        'r4:c2': 'Jonas',
      },
      'widths': {'c1': 2},
    },
  });

  // mind map
  add({
    'id': 'mind-root',
    'type': 'mindnode',
    'x': 1260,
    'y': 1180,
    'w': 180,
    'h': 56,
    'text': 'Festival',
    'color': '#0a0a0a',
    'mind': {'level': 0},
  });
  add({
    'id': 'mind-a',
    'type': 'mindnode',
    'x': 1500,
    'y': 1120,
    'w': 140,
    'h': 44,
    'text': 'Musik',
    'color': '#ec4e92',
    'mind': {'parent': 'mind-root', 'order': 1, 'side': 'r', 'level': 1},
  });
  add({
    'id': 'mind-b',
    'type': 'mindnode',
    'x': 1500,
    'y': 1250,
    'w': 140,
    'h': 44,
    'text': 'Essen',
    'color': '#1763b5',
    'mind': {'parent': 'mind-root', 'order': 2, 'side': 'r', 'level': 1},
  });
  add({
    'id': 'mind-a1',
    'type': 'mindnode',
    'x': 1700,
    'y': 1110,
    'w': 110,
    'h': 32,
    'text': 'Bands',
    'mind': {'parent': 'mind-a', 'order': 1, 'side': 'r', 'level': 2},
  });
  add({
    'id': 'mind-c',
    'type': 'mindnode',
    'x': 1060,
    'y': 1190,
    'w': 140,
    'h': 44,
    'text': 'Aufbau',
    'color': '#7aa21b',
    'mind': {'parent': 'mind-root', 'order': 3, 'side': 'l', 'level': 1, 'collapsed': true},
  });
  add({
    'id': 'mind-c1',
    'type': 'mindnode',
    'x': 900,
    'y': 1190,
    'w': 110,
    'h': 32,
    'text': 'versteckt',
    'mind': {'parent': 'mind-c', 'order': 1, 'side': 'l', 'level': 2, 'hidden': true},
  });

  // timeline (35 days, week scale: inner 168 + 35 × 18 = 798 wide)
  add({
    'id': 'timeline-1',
    'type': 'timeline',
    'x': 0,
    'y': 1330,
    'w': 798,
    'h': 200,
    'tlStart': '2026-08-03',
    'tlEnd': '2026-09-06',
    'timeline': {
      'lanes': ['l1', 'l2'],
      'names': {'l1': 'Aufbau', 'l2': 'Programm'},
      'items': {
        'i1': {'lane': 'l1', 'start': '2026-08-17', 'end': '2026-08-27', 'title': 'Zelte & Bühne', 'color': '#7aa21b'},
        'i2': {'lane': 'l1', 'start': '2026-08-24', 'end': '2026-08-28', 'title': 'Strom'},
        'i3': {
          'lane': 'l2',
          'start': '2026-08-29',
          'end': '2026-08-29',
          'title': 'Festival',
          'ms': true,
          'color': '#ec4e92',
        },
      },
    },
  });

  // stickers and icon
  add({'id': 'sticker-emoji', 'type': 'sticker', 'x': 850, 'y': 1330, 'w': 96, 'h': 96, 'emoji': '🌵'});
  add({
    'id': 'sticker-stamp',
    'type': 'sticker',
    'x': 960,
    'y': 1330,
    'w': 96,
    'h': 96,
    'stamp': 'heart',
    'rotation': -12,
  });
  add({
    'id': 'icon-tent',
    'type': 'icon',
    'x': 1070,
    'y': 1330,
    'w': 96,
    'h': 96,
    'icon': 'tent',
    'color': '#1763b5',
    'iconNode': [
      [
        'path',
        {'d': 'M3.5 21 14 3'},
      ],
      [
        'path',
        {'d': 'M20.5 21 10 3'},
      ],
      [
        'path',
        {'d': 'M15.5 21 12 15l-3.5 6'},
      ],
      [
        'path',
        {'d': 'M2 21h20'},
      ],
    ],
  });

  // PDF document (page 2 of 3; page images not loaded → placeholder page)
  add({
    'id': 'doc-1',
    'type': 'document',
    'x': 1200,
    'y': 1330,
    'w': 212,
    'h': 300,
    'docFile': 'pdf-1',
    'docName': 'Lageplan.pdf',
    'docCount': 3,
    'docPage': 1,
    'docPages': {'0': 'pg-0', '1': 'pg-1'},
    'docRatios': [0.707, 0.707, 0.707],
    'imageId': 'pg-1',
  });

  // a type this app does not know yet, and a hidden object
  add({
    'id': 'unknown-1',
    'type': 'kanban',
    'x': 1600,
    'y': 0,
    'w': 240,
    'h': 160,
    'lanes': 3,
    'futureField': {'a': 1},
  });
  add({
    'id': 'hidden-1',
    'type': 'sticky',
    'x': 1600,
    'y': 180,
    'w': 200,
    'h': 200,
    'text': 'ausgeblendet',
    'hidden': true,
  });

  return {'objects': objects};
}
