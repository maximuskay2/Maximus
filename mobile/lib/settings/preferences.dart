import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Phase 7: on-phone preferences (appearance, haptics, language,
/// timezone). Plain prefs, not secrets: SharedPreferences.
class AppPreferences extends ChangeNotifier {
  AppPreferences({SharedPreferences? store}) : _store = store; // ignore: prefer_initializing_formals

  SharedPreferences? _store;
  bool _loaded = false;

  bool get loaded => _loaded;

  static const _themeKey = 'maximus.prefs.theme';
  static const hapticsKey = 'maximus.prefs.haptics';
  static const _languageKey = 'maximus.prefs.language';
  static const _timeZoneKey = 'maximus.prefs.timeZone';
  static const _workspaceKey = 'maximus.prefs.workspace';

  ThemeMode _theme = ThemeMode.system;
  bool _haptics = true;
  String? _language;
  String? _timeZone;
  String _workspace = '';

  ThemeMode get theme => _theme;
  bool get haptics => _haptics;

  /// BCP-47 tag the owner picked for server-written lines
  /// (briefs, proactive notes), or null for the phone default.
  String? get language => _language;

  /// IANA zone override reported to the server, or null for the
  /// phone's own zone.
  String? get timeZone => _timeZone;

  /// Last workspace opened on the active server.
  String get workspace => _workspace;

  Future<void> load() async {
    _store ??= await SharedPreferences.getInstance();
    final store = _store!;
    _theme = switch (store.getString(_themeKey)) {
      'light' => ThemeMode.light,
      'dark' => ThemeMode.dark,
      _ => ThemeMode.system,
    };
    _haptics = store.getBool(hapticsKey) ?? true;
    _language = store.getString(_languageKey);
    _timeZone = store.getString(_timeZoneKey);
    _workspace = store.getString(_workspaceKey) ?? '';
    _loaded = true;
    notifyListeners();
  }

  Future<void> setTheme(ThemeMode mode) async {
    _theme = mode;
    notifyListeners();
    await _store?.setString(
      _themeKey,
      switch (mode) {
        ThemeMode.light => 'light',
        ThemeMode.dark => 'dark',
        ThemeMode.system => 'system',
      },
    );
  }

  Future<void> setHaptics(bool on) async {
    _haptics = on;
    notifyListeners();
    await _store?.setBool(hapticsKey, on);
  }

  Future<void> setLanguage(String? tag) async {
    _language = (tag == null || tag.isEmpty) ? null : tag;
    notifyListeners();
    if (_language == null) {
      await _store?.remove(_languageKey);
    } else {
      await _store?.setString(_languageKey, _language!);
    }
  }

  Future<void> setTimeZone(String? zone) async {
    _timeZone = (zone == null || zone.isEmpty) ? null : zone;
    notifyListeners();
    if (_timeZone == null) {
      await _store?.remove(_timeZoneKey);
    } else {
      await _store?.setString(_timeZoneKey, _timeZone!);
    }
  }

  /// Buzz unless the owner turned haptics off. Reads the stored
  /// preference directly so send/answer sites need no plumbing.
  static Future<void> buzz({bool medium = false}) async {
    try {
      final store = await SharedPreferences.getInstance();
      if (store.getBool(hapticsKey) ?? true) {
        if (medium) {
          await HapticFeedback.mediumImpact();
        } else {
          await HapticFeedback.lightImpact();
        }
      }
    } catch (_) {}
  }

  Future<void> setWorkspace(String id) async {
    _workspace = id;
    notifyListeners();
    await _store?.setString(_workspaceKey, id);
  }
}
