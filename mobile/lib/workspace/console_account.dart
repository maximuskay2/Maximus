import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../api/client.dart';
import '../api/models.dart';

/// Phase 7: control-plane account state for one paired server. The
/// account token comes from email OTP and is kept in secure storage
/// next to the pairing token (it spends money; the pairing token only
/// talks to the server).
class ConsoleAccount extends ChangeNotifier {
  ConsoleAccount({
    required this.client,
    required this.serverId,
    required this.baseUrl,
    FlutterSecureStorage? storage,
  }) : _storage = storage ?? const FlutterSecureStorage();

  final MaximusApi client;
  final String serverId;
  final String baseUrl;
  final FlutterSecureStorage _storage;

  bool _loaded = false;
  bool get loaded => _loaded;

  String? _email;
  String? _token;
  List<ConsoleMembership> _memberships = const [];
  String? _error;

  String? get email => _email;
  String? get token => _token;
  bool get signedIn => _token != null;
  List<ConsoleMembership> get memberships => _memberships;
  String? get error => _error;

  String get _key => 'maximus.console.$serverId';

  Future<void> load() async {
    try {
      final raw = await _storage.read(key: _key);
      if (raw != null && raw.isNotEmpty) {
        final decoded = jsonDecode(raw);
        if (decoded is Map<String, Object?>) {
          _email = decoded['email'] as String?;
          _token = decoded['token'] as String?;
        }
      }
    } catch (_) {
      _email = null;
      _token = null;
    }
    _loaded = true;
    notifyListeners();
    if (_token != null) await refreshMemberships();
  }

  Future<void> _persist() => _storage.write(
    key: _key,
    value: jsonEncode({'email': _email, 'token': _token}),
  );

  /// Starts email sign-in; the code arrives by email.
  Future<void> startSignIn(String email) async {
    _error = null;
    notifyListeners();
    try {
      await client.consoleOtpStart(baseUrl, email.trim());
      _email = email.trim();
    } on ApiError catch (error) {
      _error = _friendly(error);
    } finally {
      notifyListeners();
    }
  }

  /// Verifies the emailed code and keeps the account token.
  Future<bool> verifyCode(String email, String code) async {
    _error = null;
    notifyListeners();
    try {
      final login = await client.consoleOtpVerify(
        baseUrl,
        email: email.trim(),
        code: code.trim(),
      );
      _email = login.email.isNotEmpty ? login.email : email.trim();
      _token = login.token;
      await _persist();
      await refreshMemberships();
      return true;
    } on ApiError catch (error) {
      _error = _friendly(error);
      return false;
    } finally {
      notifyListeners();
    }
  }

  Future<void> refreshMemberships() async {
    final token = _token;
    if (token == null) return;
    try {
      _memberships = await client.consoleMemberships(baseUrl, token);
      _error = null;
    } on ApiError catch (error) {
      if (error.unauthorized) {
        // The account token died server-side: sign in again.
        await signOut();
        _error = 'Sign in again to continue.';
      } else {
        _error = _friendly(error);
      }
    } finally {
      notifyListeners();
    }
  }

  Future<void> signOut() async {
    _email = null;
    _token = null;
    _memberships = const [];
    try {
      await _storage.delete(key: _key);
    } catch (_) {}
    notifyListeners();
  }

  static String _friendly(ApiError error) {
    if (error.status == 503 || error.code == 'unavailable') {
      return 'This server is not connected to a control plane.';
    }
    if (error.status == 429) return 'Too many tries — wait a minute.';
    if (error.status == 400 && error.code == 'invalid_email') {
      return 'Enter a valid email address.';
    }
    if (error.message.isNotEmpty) return error.message;
    return 'Something went wrong — try again.';
  }
}
