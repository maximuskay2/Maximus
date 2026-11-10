import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'models.dart';

/// Secure persistence for paired servers. One credential per server.
abstract class SessionStore {
  Future<List<ServerRef>> servers();
  Future<void> saveServer(ServerRef server);
  Future<void> removeServer(String id);
  Future<String?> controlPlaneUrl();
  Future<void> saveControlPlaneUrl(String? url);
}

/// Production store backed by Keychain/Keystore.
class SecureSessionStore implements SessionStore {
  SecureSessionStore({FlutterSecureStorage? storage})
    : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  static const _serversKey = 'maximus.servers';
  static const _controlPlaneKey = 'maximus.controlPlaneUrl';

  @override
  Future<List<ServerRef>> servers() async {
    final raw = await _storage.read(key: _serversKey);
    if (raw == null || raw.isEmpty) return const [];
    final decoded = jsonDecode(raw);
    if (decoded is! List) return const [];
    return [
      for (final item in decoded)
        if (item is Map<String, Object?>) ServerRef.fromJson(item),
    ];
  }

  @override
  Future<void> saveServer(ServerRef server) async {
    final all = [for (final s in await servers()) if (s.id != server.id) s];
    all.add(server);
    await _storage.write(
      key: _serversKey,
      value: jsonEncode([for (final s in all) s.toJson()]),
    );
  }

  @override
  Future<void> removeServer(String id) async {
    final all = [for (final s in await servers()) if (s.id != id) s];
    await _storage.write(
      key: _serversKey,
      value: jsonEncode([for (final s in all) s.toJson()]),
    );
  }

  @override
  Future<String?> controlPlaneUrl() => _storage.read(key: _controlPlaneKey);

  @override
  Future<void> saveControlPlaneUrl(String? url) {
    if (url == null) return _storage.delete(key: _controlPlaneKey);
    return _storage.write(key: _controlPlaneKey, value: url);
  }
}

/// In-memory store for tests.
class MemorySessionStore implements SessionStore {
  final List<ServerRef> _servers = [];
  String? _controlPlaneUrl;

  @override
  Future<List<ServerRef>> servers() async => List.unmodifiable(_servers);

  @override
  Future<void> saveServer(ServerRef server) async {
    _servers.removeWhere((s) => s.id == server.id);
    _servers.add(server);
  }

  @override
  Future<void> removeServer(String id) async {
    _servers.removeWhere((s) => s.id == id);
  }

  @override
  Future<String?> controlPlaneUrl() async => _controlPlaneUrl;

  @override
  Future<void> saveControlPlaneUrl(String? url) async {
    _controlPlaneUrl = url;
  }
}
