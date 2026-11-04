import 'package:flutter/material.dart';
import 'package:stachel_board/stachel_board.dart';

/// Native board without app and server: the debug screen (all object types, 2 000 / 5 000 objects).
/// `flutter run --profile` on the phone shows the real frame times in the badge (UI/Raster).
void main() => runApp(const BoardExampleApp());

class BoardExampleApp extends StatelessWidget {
  const BoardExampleApp({super.key, this.initial = DebugBoard.allTypes});

  final DebugBoard initial;

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Stachel Board',
    debugShowCheckedModeBanner: false,
    theme: ThemeData(colorSchemeSeed: const Color(0xFFEC4E92)),
    home: BoardDebugScreen(initial: initial),
  );
}
