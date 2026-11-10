import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';

import '../api/client.dart';
import '../api/models.dart';
import 'rtc.dart';

/// Call phases, mirroring the desktop live-call states.
enum CallPhase {
  idle,
  starting,
  live,
  ending,
  ended,
  failed,
}

/// Why a call failed in words the call screen can show.
enum CallFailure {
  /// No provider key on the server (409 needsKey).
  needsKey,

  /// Another call is already running (409 activeCall).
  busy,

  /// The mic is missing or blocked.
  mic,

  /// Anything else (message in [CallController.notice]).
  other,
}

/// Owns one live voice call: mic + WebRTC offer, the server session trade,
/// mute/speaker, hangup, and server-state polling.
class CallController extends ChangeNotifier {
  CallController({
    required RtcDriver rtc,
    required MaximusApi client,
    required String baseUrl,
    this.pollInterval = const Duration(seconds: 5),
  }) {
    _rtc = rtc;
    _client = client;
    _baseUrl = baseUrl;
  }

  late final RtcDriver _rtc;
  late final MaximusApi _client;
  late final String _baseUrl;
  final Duration pollInterval;

  CallPhase _phase = CallPhase.idle;
  CallPhase get phase => _phase;

  LiveCallState? _call;
  LiveCallState? get call => _call;

  CallFailure? _failure;
  CallFailure? get failure => _failure;

  String? _notice;
  String? get notice => _notice;

  bool _muted = false;
  bool get muted => _muted;

  bool _speaker = false;
  bool get speaker => _speaker;

  /// True once the voice's audio track arrived.
  bool _hearing = false;
  bool get hearing => _hearing;

  RtcCall? _media;
  Timer? _poll;
  int _generation = 0;
  bool _disposed = false;

  void _set(CallPhase phase) {
    if (_disposed) return;
    _phase = phase;
    _notify();
  }

  void _notify() {
    if (_disposed) return;
    notifyListeners();
  }

  /// Starts a call with [botId] in [threadId]. The mic prompt (if any)
  /// comes from this explicit tap.
  Future<void> start({
    required String botId,
    required String threadId,
  }) async {
    if (_phase == CallPhase.starting || _phase == CallPhase.live) return;
    final mine = ++_generation;
    _failure = null;
    _notice = null;
    _hearing = false;
    _muted = false;
    _set(CallPhase.starting);
    RtcCall? media;
    try {
      media = await _rtc.start(
        onRemoteTrack: () {
          if (_disposed || mine != _generation) return;
          _hearing = true;
          _notify();
        },
        onConnectionState: (state) {
          if (mine != _generation) return;
          if (state.endsWith('Failed') || state.endsWith('Closed')) {
            _notice = 'The call dropped.';
            unawaited(end(silent: true));
          }
        },
      );
      if (mine != _generation) {
        await media.dispose();
        return;
      }
      _media = media;
      final offer = await media.offer();
      if (mine != _generation) return;
      final session = await _client.startLiveSession(
        _baseUrl,
        botId: botId,
        threadId: threadId,
        sdp: offer,
        client: Platform.isIOS ? 'ios' : 'android',
      );
      if (mine != _generation) {
        await _client.endLiveCall(_baseUrl, session.call.callId);
        return;
      }
      await media.answer(session.answerSdp);
      if (mine != _generation) return;
      _call = session.call;
      _set(CallPhase.live);
      _poll = Timer.periodic(pollInterval, (_) => _refresh());
      await _refresh();
    } on ApiError catch (error) {
      if (mine != _generation) return;
      await media?.dispose();
      _media = null;
      if (error.status == 409 && error.details?['needsKey'] == true) {
        _failure = CallFailure.needsKey;
        _notice =
            'Live calls use your own provider key. Add it in Settings → API keys.';
      } else if (error.status == 409 &&
          error.details?['activeCall'] != null) {
        _failure = CallFailure.busy;
        _notice = 'A live call is already running.';
      } else {
        _failure = CallFailure.other;
        _notice = error.message;
      }
      _set(CallPhase.failed);
    } catch (error) {
      if (mine != _generation) return;
      await media?.dispose();
      _media = null;
      _failure = CallFailure.mic;
      _notice = error is StateError && error.message.contains('SDP')
          ? 'The call could not start — try again.'
          : 'The microphone is missing or blocked.';
      _set(CallPhase.failed);
    }
  }

  Future<void> _refresh() async {
    final callId = _call?.callId;
    if (callId == null || _disposed) return;
    try {
      final current = await _client.currentLiveCall(_baseUrl);
      if (current == null || current.callId != callId) {
        // The server ended it (idle, revoked, another client hung up).
        _notice = 'The call ended.';
        await end(silent: true);
        return;
      }
      if (current.status != _call?.status) {
        _call = current;
        _notify();
      }
    } catch (_) {
      // Polling never ends a healthy call; the next tick retries.
    }
  }

  Future<void> setMuted(bool muted) async {
    _muted = muted;
    _notify();
    try {
      await _media?.setMuted(muted);
    } catch (_) {}
  }

  Future<void> setSpeaker(bool on) async {
    _speaker = on;
    _notify();
    try {
      await _media?.setSpeaker(on);
    } catch (_) {}
  }

  /// Hangs up. [silent] skips the ended phase (the server ended first).
  /// Safe to call after dispose (page teardown races): it just releases.
  Future<void> end({bool silent = false}) async {
    if (_disposed) return;
    final mine = ++_generation;
    _poll?.cancel();
    _poll = null;
    if (!silent) _set(CallPhase.ending);
    final callId = _call?.callId;
    _call = null;
    if (callId != null) {
      try {
        await _client.endLiveCall(_baseUrl, callId);
      } catch (_) {}
    }
    await _media?.dispose();
    _media = null;
    if (_disposed || mine != _generation) return;
    if (!silent) _set(CallPhase.ended);
    if (silent) _notify();
  }

  @override
  void dispose() {
    _generation++;
    _disposed = true;
    _poll?.cancel();
    unawaited(_media?.dispose());
    super.dispose();
  }
}
