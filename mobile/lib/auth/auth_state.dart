import 'package:flutter/foundation.dart';

import '../api/thread_cache.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../api/session_store.dart';

/// App session state: paired servers, the active server, and its scopes.
/// Persisted per server in secure storage; exactly one server is active.
class AuthState extends ChangeNotifier {
  AuthState({required this._store, required this._client});

  final SessionStore _store;
  final MaximusApi _client;

  /// The shared client; it owns the session cookie jar.
  MaximusApi get client => _client;

  List<ServerRef> _servers = const [];
  String? _activeId;
  List<String> _scopes = const [];
  bool _loaded = false;

  ThreadCache? _cache;

  /// Disk cache for bots/threads; null until the app support dir resolves.
  ThreadCache? get cache => _cache;
  set cache(ThreadCache? value) {
    _cache = value;
    notifyListeners();
  }

  List<ServerRef> get servers => _servers;
  ServerRef? get active {
    for (final server in _servers) {
      if (server.id == _activeId) return server;
    }
    return null;
  }

  List<String> get scopes => _scopes;
  bool get loaded => _loaded;
  bool get isAdmin => _scopes.contains('admin');
  bool get isChatOnly =>
      _scopes.contains('client') && !isAdmin && active != null;

  Future<void> load() async {
    _servers = await _store.servers();
    if (_servers.isNotEmpty) {
      _activeId = _servers.first.id;
      _client.setCompanionToken(_servers.first.companionToken);
    }
    _loaded = true;
    notifyListeners();
  }

  /// Pairs a server by code and makes it active.
  Future<void> pair({
    required String baseUrl,
    required String code,
    required String label,
    String? name,
  }) async {
    final paired = await _client.pair(baseUrl, code: code, label: label);
    final server = ServerRef(
      id: _serverId(baseUrl),
      name: (name != null && name.isNotEmpty) ? name : _nameOf(baseUrl),
      baseUrl: baseUrl,
      companionToken: paired.token,
    );
    await _store.saveServer(server);
    _servers = await _store.servers();
    _activeId = server.id;
    _scopes = paired.scopes;
    _client.setCompanionToken(paired.token);
    notifyListeners();
  }

  /// Signs in with an email OTP code (session cookie kept by the client).
  Future<void> signInWithEmail({
    required String baseUrl,
    required String email,
    required String code,
  }) async {
    final scopes = await _client.emailVerify(
      baseUrl,
      email: email,
      code: code,
    );
    final server = ServerRef(
      id: _serverId(baseUrl),
      name: _nameOf(baseUrl),
      baseUrl: baseUrl,
    );
    await _store.saveServer(server);
    _servers = await _store.servers();
    _activeId = server.id;
    _scopes = scopes;
    notifyListeners();
  }

  /// Signs in from a provider ticket (session cookie kept by the client).
  Future<void> redeemOAuth({
    required String baseUrl,
    required String ticket,
  }) async {
    final scopes = await _client.oauthRedeem(baseUrl, ticket);
    final server = ServerRef(
      id: _serverId(baseUrl),
      name: _nameOf(baseUrl),
      baseUrl: baseUrl,
    );
    await _store.saveServer(server);
    _servers = await _store.servers();
    _activeId = server.id;
    _scopes = scopes;
    notifyListeners();
  }

  void useServer(String id) {
    if (_servers.any((s) => s.id == id)) {
      _activeId = id;
      _scopes = const [];
      _client.setCompanionToken(active?.companionToken);
      notifyListeners();
    }
  }

  Future<void> removeServer(String id) async {
    await _store.removeServer(id);
    _servers = await _store.servers();
    if (_activeId == id) {
      _activeId = _servers.isEmpty ? null : _servers.first.id;
      _scopes = const [];
      _client.setCompanionToken(active?.companionToken);
    }
    notifyListeners();
  }

  static String _serverId(String baseUrl) =>
      Uri.parse(baseUrl).host.toLowerCase();

  static String _nameOf(String baseUrl) {
    final host = Uri.parse(baseUrl).host;
    return host.isEmpty ? baseUrl : host;
  }
}
