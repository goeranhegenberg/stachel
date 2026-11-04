// The app session token (`sts_…`) is kept in secure storage, not in SharedPreferences (Play data safety, L4 in
// docs/store/data_safety.md): saving, moving a token an older version left in SharedPreferences, falling back to
// memory when the platform storage is missing or fails.

import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stachel_client/stachel_client.dart';

const _prefsKey = 'stachel_app_session_v1';

/// A store whose platform side throws (no plugin, broken Keystore).
class _Broken implements StachelSecretStore {
  @override
  Future<String?> read(String key) async => throw PlatformException(code: 'keystore');
  @override
  Future<void> write(String key, String value) async => throw PlatformException(code: 'keystore');
  @override
  Future<void> delete(String key) async => throw PlatformException(code: 'keystore');
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late StachelSecretStore original;
  late StachelMemorySecretStore secrets;

  setUp(() async {
    original = StachelSession.secrets;
    secrets = StachelMemorySecretStore();
    StachelSession.secrets = secrets;
    SharedPreferences.setMockInitialValues({});
    await StachelSession.clear();
  });
  tearDown(() => StachelSession.secrets = original);

  test('speichert das Token im sicheren Speicher, nicht in SharedPreferences', () async {
    await StachelSession.save('login-a', 'sts_geheim');
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getKeys().where((k) => prefs.get(k).toString().contains('sts_geheim')), isEmpty);
    final stored = jsonDecode((await secrets.read(_prefsKey))!) as Map;
    expect(stored['token'], 'sts_geheim');
    expect(stored['for'], StachelSession.ownerOf('login-a'));
    expect(await StachelSession.load('login-a'), 'sts_geheim');
    expect(await StachelSession.load('login-b'), isNull, reason: 'andere Anmeldung');
  });

  test('übernimmt ein Token aus SharedPreferences (ältere Version) und löscht es dort', () async {
    SharedPreferences.setMockInitialValues({
      _prefsKey: jsonEncode({'for': StachelSession.ownerOf('login-a'), 'token': 'sts_alt'}),
    });
    expect(await StachelSession.load('login-a'), 'sts_alt');
    expect((await SharedPreferences.getInstance()).getString(_prefsKey), isNull);
    expect(jsonDecode((await secrets.read(_prefsKey))!)['token'], 'sts_alt');
  });

  test('abmelden löscht das Token im sicheren Speicher', () async {
    await StachelSession.save('login-a', 'sts_weg');
    await StachelSession.clear();
    expect(await secrets.read(_prefsKey), isNull);
    expect(await StachelSession.load('login-a'), isNull);
  });

  test('Plattform-Speicher kaputt: Token nur im Speicher des Prozesses, nie in SharedPreferences', () async {
    final store = StachelPlatformSecretStore();
    // no plugin in unit tests → MissingPluginException → memory
    StachelSession.secrets = store;
    await StachelSession.save('login-a', 'sts_nur_hier');
    expect(store.inMemoryOnly, isTrue);
    await StachelSession.clear();
    await StachelSession.save('login-a', 'sts_nur_hier');
    expect(await store.read(_prefsKey), contains('sts_nur_hier'));
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString(_prefsKey), isNull);
  });

  test('wirft der Speicher selbst, gibt es eben kein Token (keine Ausnahme nach außen)', () async {
    StachelSession.secrets = _Broken();
    expect(await StachelSession.load('login-a'), isNull);
    await StachelSession.clear();
  });

  test('mit flutter_secure_storage (Mock): schreibt über das Plugin', () async {
    FlutterSecureStorage.setMockInitialValues({});
    final store = StachelPlatformSecretStore();
    StachelSession.secrets = store;
    await StachelSession.save('login-a', 'sts_plugin');
    expect(store.inMemoryOnly, isFalse);
    expect(await const FlutterSecureStorage().read(key: _prefsKey), contains('sts_plugin'));
  });
}
