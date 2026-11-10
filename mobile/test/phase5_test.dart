import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maximus/api/models.dart';
import 'package:maximus/call/call_controller.dart';
import 'package:maximus/call/call_page.dart';
import 'package:maximus/call/rtc.dart';
import 'package:maximus/chat/composer.dart';
import 'package:maximus/chat/dictation.dart';
import 'package:maximus/chat/drafts.dart';

import 'fake_api.dart';

class FakeSpeech implements SpeechDriver {
  bool ready = true;
  void Function(String text, bool finalResult)? listener;
  bool stopped = false;
  bool cancelled = false;

  @override
  Future<bool> ensureReady() async => ready;

  @override
  Future<void> listen(
    void Function(String text, bool finalResult) onResult,
  ) async {
    listener = onResult;
  }

  @override
  Future<void> stop() async {
    stopped = true;
  }

  @override
  Future<void> cancel() async {
    cancelled = true;
  }
}

class FakeRtcCall implements RtcCall {
  String offerSdp = 'fake-offer-sdp';
  String? answerSdp;
  bool muted = false;
  bool speaker = false;
  bool disposed = false;

  @override
  Future<String> offer() async => offerSdp;

  @override
  Future<void> answer(String sdp) async {
    answerSdp = sdp;
  }

  @override
  Future<void> setMuted(bool muted) async {
    this.muted = muted;
  }

  @override
  Future<void> setSpeaker(bool on) async {
    speaker = on;
  }

  @override
  Future<void> dispose() async {
    disposed = true;
  }
}

class FakeRtc implements RtcDriver {
  FakeRtcCall? last;
  Object? startError;
  void Function()? remoteHook;
  void Function(String state)? stateHook;

  @override
  Future<RtcCall> start({
    required void Function() onRemoteTrack,
    required void Function(String state) onConnectionState,
  }) async {
    if (startError != null) throw startError!;
    remoteHook = onRemoteTrack;
    stateHook = onConnectionState;
    return last = FakeRtcCall();
  }
}

BotSummary testBot() => BotSummary.fromJson({
  'id': 'b1',
  'name': 'Max',
  'title': '',
  'description': '',
  'threadId': 't1',
});

ThreadSummary testThread() => const ThreadSummary(
  threadId: 't1',
  title: 'Chat',
  createdAt: 0,
);

void main() {
  test('dictation streams transcripts onto the base text', () async {
    final speech = FakeSpeech();
    final dictation = DictationController(driver: speech);
    final seen = <String>[];
    dictation.onTranscript = seen.add;

    await dictation.toggle(baseText: 'note');
    expect(dictation.listening, isTrue);
    speech.listener!('hello', false);
    speech.listener!('hello world', true);
    expect(seen, ['note hello', 'note hello world']);
    expect(dictation.listening, isFalse);
    dictation.dispose();
  });

  test('dictation reports when speech is unavailable', () async {
    final speech = FakeSpeech()..ready = false;
    final dictation = DictationController(driver: speech);
    await dictation.toggle(baseText: '');
    expect(dictation.listening, isFalse);
    expect(dictation.error, contains('not available'));
    dictation.dispose();
  });

  testWidgets('composer mic dictates into the field', (tester) async {
    final speech = FakeSpeech();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Composer(
            threadId: 't1',
            drafts: DraftStore(memory: {}),
            botNames: const [],
            onSend: (_) async {},
            onStop: () async {},
            sending: false,
            working: false,
            onAttach: () async => [],
            speech: speech,
          ),
        ),
      ),
    );
    expect(find.byTooltip('Dictate'), findsOneWidget);
    await tester.tap(find.byTooltip('Dictate'));
    await tester.pumpAndSettle();
    expect(find.text('Listening… tap the mic to stop'), findsOneWidget);
    speech.listener!('hello phone', true);
    await tester.pumpAndSettle();
    expect(find.text('hello phone'), findsOneWidget);
  });

  test('call starts, hears, mutes, and hangs up', () async {
    final rtc = FakeRtc();
    final api = FakeApi();
    final calls = CallController(
      rtc: rtc,
      client: api,
      baseUrl: 'http://x',
      pollInterval: const Duration(hours: 1),
    );
    await calls.start(botId: 'b1', threadId: 't1');
    expect(calls.phase, CallPhase.live);
    expect(calls.call!.callId, 'call-1');
    expect(rtc.last!.answerSdp, 'fake-answer-sdp');

    rtc.remoteHook!();
    expect(calls.hearing, isTrue);

    await calls.setMuted(true);
    expect(rtc.last!.muted, isTrue);
    await calls.setSpeaker(true);
    expect(rtc.last!.speaker, isTrue);

    await calls.end();
    expect(calls.phase, CallPhase.ended);
    expect(api.liveCall, isNull);
    expect(rtc.last!.disposed, isTrue);
    calls.dispose();
  });

  test('call maps needsKey and busy failures', () async {
    final rtc = FakeRtc();
    final keyApi = FakeApi()
      ..liveStartError = const ApiError(409, 'needs a key', details: {
        'needsKey': true,
      });
    final keyCalls = CallController(
      rtc: rtc,
      client: keyApi,
      baseUrl: 'http://x',
    );
    await keyCalls.start(botId: 'b1', threadId: 't1');
    expect(keyCalls.phase, CallPhase.failed);
    expect(keyCalls.failure, CallFailure.needsKey);

    final busyApi = FakeApi()
      ..liveStartError = const ApiError(409, 'busy', details: {
        'activeCall': {'callId': 'other'},
      });
    final busyCalls = CallController(
      rtc: rtc,
      client: busyApi,
      baseUrl: 'http://x',
    );
    await busyCalls.start(botId: 'b1', threadId: 't1');
    expect(busyCalls.failure, CallFailure.busy);
    keyCalls.dispose();
    busyCalls.dispose();
  });

  test('call maps mic failures', () async {
    final rtc = FakeRtc()..startError = StateError('no mic');
    final calls = CallController(
      rtc: rtc,
      client: FakeApi(),
      baseUrl: 'http://x',
    );
    await calls.start(botId: 'b1', threadId: 't1');
    expect(calls.phase, CallPhase.failed);
    expect(calls.failure, CallFailure.mic);
    calls.dispose();
  });

  test('server-ended calls finish silently', () async {
    final rtc = FakeRtc();
    final api = FakeApi();
    final calls = CallController(
      rtc: rtc,
      client: api,
      baseUrl: 'http://x',
      pollInterval: const Duration(milliseconds: 20),
    );
    await calls.start(botId: 'b1', threadId: 't1');
    expect(calls.phase, CallPhase.live);
    // The server drops the call out from under the phone.
    api.liveCall = null;
    await Future<void>.delayed(const Duration(milliseconds: 60));
    expect(calls.phase, CallPhase.live); // silent end keeps the page alive
    expect(calls.notice, 'The call ended.');
    calls.dispose();
  });

  testWidgets('call page shows the live indicator and ends', (tester) async {
    final rtc = FakeRtc();
    final api = FakeApi();
    final calls = CallController(
      rtc: rtc,
      client: api,
      baseUrl: 'http://x',
      pollInterval: const Duration(hours: 1),
    );
    await tester.pumpWidget(
      MaterialApp(
        home: CallPage(
          client: api,
          baseUrl: 'http://x',
          bot: testBot(),
          thread: testThread(),
          controller: calls,
        ),
      ),
    );
    // Explicit pumps: the live pulse + clock tick forever by design.
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Max'), findsOneWidget);
    rtc.remoteHook!();
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Live'), findsOneWidget);
    await tester.tap(find.byIcon(Icons.mic));
    await tester.pump(const Duration(milliseconds: 100));
    expect(rtc.last!.muted, isTrue);
    await tester.tap(find.byIcon(Icons.call_end));
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Call ended'), findsOneWidget);
    // Let the auto-leave timer fire (no-op: the page is home here),
    // only then dispose.
    await tester.pump(const Duration(milliseconds: 1500));
    await tester.pump(const Duration(milliseconds: 100));
    calls.dispose();
  });

  test('hangup started before dispose does not notify a dead controller', () async {
    final calls = CallController(
      rtc: FakeRtc(),
      client: FakeApi(),
      baseUrl: 'http://x',
      pollInterval: const Duration(hours: 1),
    );
    await calls.start(botId: 'b1', threadId: 't1');
    final pending = calls.end(silent: true);
    calls.dispose();
    await pending;
  });

  testWidgets('a long failure notice stays inside the call screen', (tester) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final api = FakeApi()
      ..liveStartError = const ApiError(409, 'needs a key', details: {
        'needsKey': true,
      });
    final calls = CallController(
      rtc: FakeRtc(),
      client: api,
      baseUrl: 'http://x',
    );
    await calls.start(botId: 'b1', threadId: 't1');
    await tester.pumpWidget(
      MaterialApp(
        home: CallPage(
          client: api,
          baseUrl: 'http://x',
          bot: testBot(),
          thread: testThread(),
          controller: calls,
        ),
      ),
    );
    await tester.pump();
    expect(find.textContaining('provider key'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pump(const Duration(milliseconds: 1500));
    calls.dispose();
  });

  test('transcribe round-trips through the fake', () async {
    final api = FakeApi();
    expect(await api.transcribe('http://x', [1, 2, 3]), 'hello from the mic');
    api.transcribeError = const ApiError(409, 'fish key required');
    expect(
      () => api.transcribe('http://x', [1]),
      throwsA(isA<ApiError>()),
    );
  });
}
