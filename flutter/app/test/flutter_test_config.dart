// Runs before every test file of this package: the gesture introduction (UX P5) would open by itself over the first
// board of every test that has SharedPreferences – tests that want it switch it on themselves.
import 'dart:async';

import 'package:stachel_board/stachel_board.dart' show GestureOnboarding;

Future<void> testExecutable(FutureOr<void> Function() testMain) async {
  GestureOnboarding.autoShow = false;
  await testMain();
}
