// „Auf dem Board“: die App hängt Zeilen an fremde Personen (Moderation: „Person melden …“, „Person blockieren“) über
// `BoardHost.personActions`; ohne Zeilen kein „···“.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

import 'p5_harness.dart';

void main() {
  Future<void> openPeople(WidgetTester tester) async {
    await tester.tap(find.byKey(const Key('collabAvatarMe')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
  }

  testWidgets('ohne Zeilen der App: kein „···“ an Personen', (tester) async {
    final b = await pumpP5(tester);
    b.peers([peer('a:lena', 'Lena', id: 3)]);
    await tester.pump();
    await openPeople(tester);
    expect(find.byKey(const ValueKey('collabPersonMore-a:lena')), findsNothing);
  });

  testWidgets('„···“ zeigt die Zeilen der App, die gewählte läuft nach dem Schließen der Liste', (tester) async {
    final b = await pumpP5(tester);
    final asked = <String>[];
    String? ran;
    b.host.persons = (key, name) {
      asked.add(key);
      return [
        MenuEntry(
          key: 'testReport',
          label: 'Person melden …',
          icon: Icons.flag_outlined,
          onSelect: (context, ui) {
            ran = '$key/$name';
            ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('gemeldet')));
          },
        ),
        MenuEntry(key: 'testBlock', label: 'Person blockieren', danger: true, onSelect: (_, _) {}),
      ];
    };
    b.peers([peer('a:lena', 'Lena', id: 3)]);
    await tester.pump();
    await openPeople(tester);
    expect(asked, contains('a:lena'));
    await tester.tap(find.byKey(const ValueKey('collabPersonMore-a:lena')));
    await tester.pumpAndSettle();
    expect(find.text('Person blockieren'), findsOneWidget);
    await tester.tap(find.byKey(const Key('testReport')));
    await tester.pumpAndSettle();
    expect(ran, 'a:lena/Lena');
    expect(find.byKey(const Key('collabPeople')), findsNothing, reason: 'Liste geschlossen');
    expect(find.text('gemeldet'), findsOneWidget, reason: 'Kontext bleibt gültig');
  });
}
