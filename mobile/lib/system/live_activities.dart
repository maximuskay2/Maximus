import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// Phase 9: lock-screen activities (dictation + voice calls) through the
/// native `maximus/live_activities` channel. No-ops off iOS and when
/// activities are disabled — the call/chat UI never depends on them.
class LiveActivities {
  LiveActivities({MethodChannel? channel, this.supportedOverride})
    : _channel = channel ?? const MethodChannel('maximus/live_activities');

  final MethodChannel _channel;

  @visibleForTesting
  final bool? supportedOverride;

  bool get supported => supportedOverride ?? Platform.isIOS;

  /// Starts (or replaces) the activity. Returns true when one shows.
  Future<bool> start({
    required String kind,
    required String botName,
    String caption = '',
  }) async {
    if (!supported) return false;
    try {
      return await _channel.invokeMethod<bool>('start', {
            'kind': kind,
            'botName': botName,
            'caption': caption,
          }) ??
          false;
    } on PlatformException {
      return false;
    }
  }

  Future<void> update({
    String? status,
    String? caption,
    int? elapsedSeconds,
  }) async {
    if (!supported) return;
    try {
      await _channel.invokeMethod<void>('update', {
        'status': ?status,
        'caption': ?caption,
        'elapsedSeconds': ?elapsedSeconds,
      });
    } on PlatformException {
      // Best-effort: the activity may have ended.
    }
  }

  Future<void> end() async {
    if (!supported) return;
    try {
      await _channel.invokeMethod<void>('end');
    } on PlatformException {
      // Already gone.
    }
  }

  /// Shares [id, name] bot pairs with Siri suggestions (App Group).
  /// Silently skips when the group is unavailable (unsigned builds).
  Future<void> syncBots(List<List<String>> bots) async {
    if (!supported) return;
    try {
      await _channel.invokeMethod<void>('syncBots', {'bots': bots});
    } on PlatformException {
      // Siri falls back to free-text bot names.
    }
  }
}
