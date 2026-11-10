import 'dart:async';

import 'package:flutter_webrtc/flutter_webrtc.dart' as rtc;

/// One side of a live call's audio: mic track + peer connection.
abstract class RtcCall {
  /// Local SDP offer, after ICE gathering completes.
  Future<String> offer();

  /// Applies the server's SDP answer.
  Future<void> answer(String sdp);

  Future<void> setMuted(bool muted);
  Future<void> setSpeaker(bool on);
  Future<void> dispose();
}

/// Thin seam over WebRTC so tests drive a fake.
abstract class RtcDriver {
  /// Opens the mic and builds the peer. [onRemoteTrack] fires when the
  /// voice's audio arrives; [onConnectionState] reports connected/failed.
  Future<RtcCall> start({
    required void Function() onRemoteTrack,
    required void Function(String state) onConnectionState,
  });
}

/// Production driver backed by flutter_webrtc. Audio-only: echo
/// cancellation, noise suppression, auto gain — like the desktop client.
class WebrtcDriver implements RtcDriver {
  @override
  Future<RtcCall> start({
    required void Function() onRemoteTrack,
    required void Function(String state) onConnectionState,
  }) async {
    final stream = await rtc.mediaDevices.getUserMedia({
      'audio': {
        'echoCancellation': true,
        'noiseSuppression': true,
        'autoGainControl': true,
      },
      'video': false,
    });
    final peer = await rtc.createPeerConnection({});
    peer.onTrack = (_) => onRemoteTrack();
    peer.onConnectionState = (state) =>
        onConnectionState(state.toString().split('.').last);
    for (final track in stream.getAudioTracks()) {
      await peer.addTrack(track, stream);
    }
    // The event channel must exist before the offer is created.
    final channel = await peer.createDataChannel(
      'oai-events',
      rtc.RTCDataChannelInit(),
    );
    return _WebrtcCall(stream, peer, channel);
  }
}

class _WebrtcCall implements RtcCall {
  _WebrtcCall(this._stream, this._peer, this._channel);

  final rtc.MediaStream _stream;
  final rtc.RTCPeerConnection _peer;
  final rtc.RTCDataChannel _channel;
  bool _offered = false;

  @override
  Future<String> offer() async {
    if (_offered) throw StateError('offer already created');
    _offered = true;
    final offer = await _peer.createOffer();
    await _peer.setLocalDescription(offer);
    await _iceGathered();
    final sdp = await _peer.getLocalDescription();
    if (sdp?.sdp == null || sdp!.sdp!.isEmpty) {
      throw StateError('no SDP offer');
    }
    return sdp.sdp!;
  }

  Future<void> _iceGathered() async {
    final done =
        rtc.RTCIceGatheringState.RTCIceGatheringStateComplete;
    if (await _peer.getIceGatheringState() == done) return;
    final completer = Completer<void>();
    _peer.onIceGatheringState = (state) {
      if (state == done && !completer.isCompleted) completer.complete();
    };
    try {
      await completer.future.timeout(const Duration(seconds: 10));
    } on TimeoutException {
      // Trickle on: send the offer with what gathered so far.
    } finally {
      _peer.onIceGatheringState = null;
    }
  }

  @override
  Future<void> answer(String sdp) async {
    await _peer.setRemoteDescription(
      rtc.RTCSessionDescription(sdp, 'answer'),
    );
  }

  @override
  Future<void> setMuted(bool muted) async {
    for (final track in _stream.getAudioTracks()) {
      track.enabled = !muted;
    }
  }

  @override
  Future<void> setSpeaker(bool on) async {
    await rtc.Helper.setSpeakerphoneOn(on);
  }

  @override
  Future<void> dispose() async {
    try {
      await _channel.close();
    } catch (_) {}
    try {
      await _peer.close();
    } catch (_) {}
    try {
      await _stream.dispose();
    } catch (_) {}
  }
}
