import 'dart:async';
import 'dart:io';

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import '../api/client.dart';
import '../api/models.dart';

/// A push message that arrived while the app runs, or that opened it.
class PushTap {
  const PushTap({
    this.title,
    this.body,
    required this.data,
  });

  final String? title;
  final String? body;

  /// Server fanout data: kind, notificationId, botId, threadId, groupId?.
  final Map<String, String> data;

  String get threadId => data['threadId'] ?? '';
}

/// Notification permission as the OS reports it.
enum PushPermission {
  granted,
  denied,

  /// Never asked: the app must not prompt on its own (the system alert
  /// would ambush the user, and device runs); an explicit Enable tap asks.
  notAsked,
}

/// Thin seam over `firebase_messaging` so tests drive a fake.
abstract class PushMessaging {
  /// Current permission without prompting.
  Future<PushPermission> permission();

  /// Asks the OS for banner/sound/badge permission. Call only from an
  /// explicit user tap.
  Future<bool> requestPermission();

  /// The FCM registration token, or null when Firebase/APNs is unready.
  Future<String?> getToken();

  Stream<String> get onTokenRefresh;
  Stream<PushTap> get onForeground;
  Stream<PushTap> get onOpened;

  /// The tap that launched a terminated app, if any.
  Future<PushTap?> getInitialTap();
}

PushTap _tapFrom(RemoteMessage message) => PushTap(
  title: message.notification?.title,
  body: message.notification?.body,
  data: {for (final e in message.data.entries) e.key: '${e.value}'},
);

/// Production messaging backed by Firebase Cloud Messaging.
///
/// Throws nothing: every Firebase failure (missing GoogleService config,
/// no APNs key, simulator without push) surfaces as null/false and the
/// controller reports push unavailable instead of crashing the app.
class FirebasePushMessaging implements PushMessaging {
  FirebaseMessaging get _fcm => FirebaseMessaging.instance;

  @override
  Future<PushPermission> permission() async {
    try {
      return switch (await _fcm.getNotificationSettings()) {
        NotificationSettings(
          authorizationStatus:
              AuthorizationStatus.notDetermined,
        ) =>
          PushPermission.notAsked,
        NotificationSettings(
          authorizationStatus: AuthorizationStatus.denied,
        ) =>
          PushPermission.denied,
        _ => PushPermission.granted,
      };
    } catch (_) {
      return PushPermission.notAsked;
    }
  }

  @override
  Future<bool> requestPermission() async {
    try {
      final settings = await _fcm.requestPermission();
      return settings.authorizationStatus == AuthorizationStatus.authorized ||
          settings.authorizationStatus == AuthorizationStatus.provisional;
    } catch (_) {
      return false;
    }
  }

  @override
  Future<String?> getToken() async {
    try {
      // v17 registers the app instance, then emits its Firebase
      // Installation ID: the direct-send target we store as the token.
      final pending = _fcm.onRegistered.first;
      await _fcm.register();
      return await pending.timeout(const Duration(seconds: 15));
    } catch (_) {
      return null;
    }
  }

  @override
  Stream<String> get onTokenRefresh {
    try {
      return _fcm.onRegistered;
    } catch (_) {
      return const Stream.empty();
    }
  }

  @override
  Stream<PushTap> get onForeground {
    try {
      return FirebaseMessaging.onMessage.map(_tapFrom);
    } catch (_) {
      return const Stream.empty();
    }
  }

  @override
  Stream<PushTap> get onOpened {
    try {
      return FirebaseMessaging.onMessageOpenedApp.map(_tapFrom);
    } catch (_) {
      return const Stream.empty();
    }
  }

  @override
  Future<PushTap?> getInitialTap() async {
    try {
      final initial = await _fcm.getInitialMessage();
      return initial == null ? null : _tapFrom(initial);
    } catch (_) {
      return null;
    }
  }
}

/// Why push is not delivering right now.
enum PushState {
  /// Not started yet (no paired server).
  idle,

  /// Permission never asked: the You tab offers an Enable row.
  prompt,

  /// Token registered with the server; banners arrive.
  on,

  /// Registered but the server's global switch is off.
  off,

  /// The user denied notification permission.
  denied,

  /// Firebase/APNs is not ready (missing config, simulator, no network).
  unavailable,
}

/// Owns the phone's push registration for one server: permission, token,
/// register/unregister, the global switch, and tap routing callbacks.
class PushController extends ChangeNotifier {
  PushController({required PushMessaging messaging}) {
    _messaging = messaging;
  }

  late final PushMessaging _messaging;

  PushState _state = PushState.idle;
  PushState get state => _state;

  /// Last 8 chars of the registered token, for the device list.
  String? _fingerprint;
  String? get fingerprint => _fingerprint;

  MaximusApi? _client;
  String? _baseUrl;
  String? _token;
  bool _starting = false;
  StreamSubscription<String>? _refreshSub;
  StreamSubscription<PushTap>? _foregroundSub;
  StreamSubscription<PushTap>? _openedSub;

  /// A banner arrived while the app runs (host shows it in-app).
  void Function(PushTap tap)? onForeground;

  /// A tap should open this thread (host navigates).
  void Function(PushTap tap)? onTap;

  bool get _on => _state == PushState.on || _state == PushState.off;

  void _set(PushState next) {
    if (_state == next) return;
    _state = next;
    notifyListeners();
  }

  /// Starts push for [baseUrl]; idempotent per server, safe to call from
  /// build. Never prompts for permission on its own: when the OS reports
  /// not-asked the state becomes [PushState.prompt] and the You tab's
  /// Enable row asks from an explicit tap.
  Future<void> ensureStarted(MaximusApi client, String baseUrl) async {
    if (_starting) return;
    if (_baseUrl == baseUrl && _state != PushState.idle) return;
    _starting = true;
    _client = client;
    _baseUrl = baseUrl;
    try {
      await _cancelStreams();
      _foregroundSub =
          _messaging.onForeground.listen((tap) => onForeground?.call(tap));
      _openedSub = _messaging.onOpened.listen((tap) => onTap?.call(tap));
      _refreshSub = _messaging.onTokenRefresh.listen(_reregister);

      switch (await _messaging.permission()) {
        case PushPermission.notAsked:
          _set(PushState.prompt);
          return;
        case PushPermission.denied:
          _set(PushState.denied);
          return;
        case PushPermission.granted:
          break;
      }
      await _register();
      final initial = await _messaging.getInitialTap();
      if (initial != null) onTap?.call(initial);
    } catch (_) {
      _set(PushState.unavailable);
    } finally {
      _starting = false;
    }
  }

  /// Explicit Enable tap: asks the OS, then registers on grant.
  Future<void> enable() async {
    final client = _client;
    final baseUrl = _baseUrl;
    if (client == null || baseUrl == null || _starting) return;
    _starting = true;
    try {
      final granted = await _messaging.requestPermission();
      if (!granted) {
        _set(PushState.denied);
        return;
      }
      await _register();
    } catch (_) {
      _set(PushState.unavailable);
    } finally {
      _starting = false;
    }
  }

  Future<void> _register() async {
    final client = _client;
    final baseUrl = _baseUrl;
    if (client == null || baseUrl == null) return;
    try {
      final token = await _messaging.getToken();
      if (token == null || token.isEmpty) {
        _set(PushState.unavailable);
        return;
      }
      _token = token;
      _fingerprint = token.length > 8
          ? token.substring(token.length - 8)
          : token;
      final enabled = await client.registerPush(
        baseUrl,
        token: token,
        platform: Platform.isIOS ? 'ios' : 'android',
      );
      _set(enabled ? PushState.on : PushState.off);
    } on ApiError {
      _set(PushState.unavailable);
    }
  }

  Future<void> _reregister(String token) async {
    final client = _client;
    final baseUrl = _baseUrl;
    if (client == null || baseUrl == null) return;
    _token = token;
    try {
      final enabled = await client.registerPush(
        baseUrl,
        token: token,
        platform: Platform.isIOS ? 'ios' : 'android',
      );
      _set(enabled ? PushState.on : PushState.off);
    } catch (_) {
      // A refresh failure keeps the old token; the next start retries.
    }
  }

  /// Refreshes the global switch state from the server (admin view).
  Future<PushStatus?> status() async {
    final client = _client;
    final baseUrl = _baseUrl;
    if (client == null || baseUrl == null) return null;
    try {
      return await client.pushStatus(baseUrl);
    } on ApiError {
      return null;
    }
  }

  /// Flips the server's global push switch (admin only).
  Future<bool?> setGlobal(bool enabled) async {
    final client = _client;
    final baseUrl = _baseUrl;
    if (client == null || baseUrl == null) return null;
    try {
      final next = await client.setPushEnabled(baseUrl, enabled);
      if (_on) _set(next ? PushState.on : PushState.off);
      return next;
    } on ApiError {
      return null;
    }
  }

  /// Unregisters this phone and stops listening (logout/server removal).
  Future<void> stop() async {
    final client = _client;
    final baseUrl = _baseUrl;
    final token = _token;
    await _cancelStreams();
    _client = null;
    _baseUrl = null;
    _token = null;
    _fingerprint = null;
    if (client != null && baseUrl != null && token != null) {
      try {
        await client.unregisterPush(baseUrl, token);
      } catch (_) {}
    }
    _set(PushState.idle);
  }

  Future<void> _cancelStreams() async {
    await _refreshSub?.cancel();
    await _foregroundSub?.cancel();
    await _openedSub?.cancel();
    _refreshSub = null;
    _foregroundSub = null;
    _openedSub = null;
  }

  @override
  void dispose() {
    unawaited(_cancelStreams());
    super.dispose();
  }
}
