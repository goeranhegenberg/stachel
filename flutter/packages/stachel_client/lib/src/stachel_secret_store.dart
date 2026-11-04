import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Where secrets of the app (the Stachel session token `sts_…`) are kept: never in plain SharedPreferences
/// (Play data safety, L4 in docs/store/data_safety.md).
abstract class StachelSecretStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

/// Keeps values only in memory (gone after the app ends).
class StachelMemorySecretStore implements StachelSecretStore {
  final _values = <String, String>{};

  @override
  Future<String?> read(String key) async => _values[key];

  @override
  Future<void> write(String key, String value) async => _values[key] = value;

  @override
  Future<void> delete(String key) async => _values.remove(key);
}

/// flutter_secure_storage (Android: encrypted with a key in the Android Keystore; iOS: Keychain). When the platform
/// side is missing or fails (unit tests without a mock, a broken Keystore) it keeps the values in memory for this run
/// instead – never in plain storage. After such a failure it stays in memory for the rest of the run, so a value
/// written there is also read from there.
class StachelPlatformSecretStore implements StachelSecretStore {
  StachelPlatformSecretStore({FlutterSecureStorage? storage}) : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;
  final _memory = StachelMemorySecretStore();
  bool _failed = false;

  /// Whether the platform storage failed and values are only kept in memory.
  bool get inMemoryOnly => _failed;

  Future<T> _try<T>(Future<T> Function(StachelSecretStore s) op) async {
    if (!_failed) {
      try {
        return await op(_Platform(_storage));
      } catch (_) {
        _failed = true;
      }
    }
    return op(_memory);
  }

  @override
  Future<String?> read(String key) => _try((s) => s.read(key));

  @override
  Future<void> write(String key, String value) => _try((s) => s.write(key, value));

  @override
  Future<void> delete(String key) => _try((s) => s.delete(key));
}

class _Platform implements StachelSecretStore {
  const _Platform(this.storage);
  final FlutterSecureStorage storage;

  @override
  Future<String?> read(String key) => storage.read(key: key);

  @override
  Future<void> write(String key, String value) => storage.write(key: key, value: value);

  @override
  Future<void> delete(String key) => storage.delete(key: key);
}
