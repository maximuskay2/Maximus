// ignore_for_file: prefer_initializing_formals — private fields keep public names.

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Per-conversation composer drafts. Small strings in secure storage —
/// no new dependency, and drafts survive restarts like the web client.
class DraftStore {
  DraftStore({FlutterSecureStorage? storage, Map<String, String>? memory})
    : _storage = storage,
      _memory = memory;

  final FlutterSecureStorage? _storage;
  final Map<String, String>? _memory;

  FlutterSecureStorage get _store =>
      _storage ?? const FlutterSecureStorage();

  static String _key(String threadId) => 'maximus.draft.$threadId';

  Future<String?> read(String threadId) {
    if (_memory != null) return Future.value(_memory[_key(threadId)]);
    return _store.read(key: _key(threadId));
  }

  Future<void> write(String threadId, String text) {
    if (text.isEmpty) return clear(threadId);
    if (_memory != null) {
      _memory[_key(threadId)] = text;
      return Future.value();
    }
    return _store.write(key: _key(threadId), value: text);
  }

  Future<void> clear(String threadId) {
    if (_memory != null) {
      _memory.remove(_key(threadId));
      return Future.value();
    }
    return _store.delete(key: _key(threadId));
  }
}
