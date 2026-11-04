import 'package:stachel_board/stachel_board.dart';

/// A mind map template like a host app would bring one ([mindmapTemplateTool]): root, four main topics (two on the
/// left), 16 nodes in all – the shape of the web's sample map.
const sampleMindmap = MindTreeSpec(
  'Sommerfest',
  children: [
    MindTreeSpec(
      'Programm',
      children: [MindTreeSpec('Bands'), MindTreeSpec('Workshops'), MindTreeSpec('Kinderprogramm')],
    ),
    MindTreeSpec('Orga', children: [MindTreeSpec('Helfer:innen'), MindTreeSpec('Schichten'), MindTreeSpec('Finanzen')]),
    MindTreeSpec('Technik', side: 'l', children: [MindTreeSpec('Strom'), MindTreeSpec('Licht & Ton')]),
    MindTreeSpec(
      'Werbung',
      side: 'l',
      children: [MindTreeSpec('Plakate'), MindTreeSpec('Social Media'), MindTreeSpec('Presse')],
    ),
  ],
);
