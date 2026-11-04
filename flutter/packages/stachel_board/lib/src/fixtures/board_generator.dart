import 'dart:math' as math;

/// Mixed board for the performance spike, built exactly like the web's load test (`web/e2e/perf-scale.spec.ts`
/// `seedMixed`): grid with 240 px spacing; of every 20 objects 10 rich-text sticky notes, 5 shapes, 2 texts,
/// 1 image (8 different image IDs) and 2 connectors between earlier objects.
///
/// Image IDs are `bench-img-0` … `bench-img-7`; [benchImageColors] are their average colors.
Map<String, Object?> mixedBoardJson(int n) {
  final cols = math.sqrt(n).ceil();
  const colors = ['#fff27a', '#c9e14a', '#ffb0d2', '#a6d8ff'];
  final list = <Map<String, Object?>>[];
  for (var i = 0; i < n; i++) {
    final x = (i % cols) * 240;
    final y = (i ~/ cols) * 240;
    final id = 'o$i';
    final z = 'a${i.toString().padLeft(6, '0')}';
    final kind = i % 20;
    if (kind < 10) {
      final a = 'Notiz ${i + 1} mit ';
      list.add({
        'id': id,
        'type': 'sticky',
        'x': x,
        'y': y,
        'w': 200,
        'h': 200,
        'z': z,
        'color': colors[i % 4],
        'text': '${a}fettem Text\nPunkt eins',
        'content': {
          'type': 'doc',
          'content': [
            {
              'type': 'paragraph',
              'content': [
                {'type': 'text', 'text': a},
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
                        {'type': 'text', 'text': 'Punkt eins'},
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      });
    } else if (kind < 15) {
      list.add({
        'id': id,
        'type': 'shape',
        'shape': kind.isOdd ? 'ellipse' : 'rect',
        'x': x,
        'y': y + 40,
        'w': 200,
        'h': 120,
        'z': z,
        'color': '#ffffff',
        'stroke': '#0a0a0a',
        'strokeWidth': 2,
        'text': 'Form $i',
        'fontSize': 20,
      });
    } else if (kind < 17) {
      list.add({
        'id': id,
        'type': 'text',
        'x': x,
        'y': y + 80,
        'w': 200,
        'h': 30,
        'z': z,
        'fontSize': 22,
        'text': 'Überschrift $i',
        'color': '#0a0a0a',
      });
    } else if (kind == 17) {
      list.add({
        'id': id,
        'type': 'image',
        'x': x,
        'y': y + 25,
        'w': 200,
        'h': 150,
        'z': z,
        'imageId': 'bench-img-${i % 8}',
        'color': benchImageColors[i % 8],
      });
    } else {
      list.add({
        'id': id,
        'type': 'connector',
        'x': 0,
        'y': 0,
        'w': 1,
        'h': 1,
        'z': z,
        'from': {'objectId': 'o${i - 8}'},
        'to': {'objectId': 'o${i - 6}'},
        'color': '#0a0a0a',
        'strokeWidth': 2,
        'arrowEnd': true,
      });
    }
  }
  return {'objects': list};
}

/// Average colors of the 8 benchmark images (`hsl(k·45 70% 55%)` like the web test).
const benchImageColors = [
  '#e04f4f', '#e0b04f', '#a2e04f', '#4fe063', '#4fe0d0', '#4f87e0', '#7a4fe0', '#e04fb5', //
];
