import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:maximus/api/client.dart';
import 'package:maximus/api/models.dart';

/// Live E2E for Phase 5 voice endpoints. A dev harness has no Fish Audio
/// or provider key, so these prove the fail-closed contracts:
///   MAXIMUS_E2E_BASE=http://127.0.0.1:8843 flutter test test/live/
void main() {
  final base = Platform.environment['MAXIMUS_E2E_BASE'];

  test('transcribe without a Fish key answers 409', skip: base == null,
      () async {
    final client = MaximusClient();
    try {
      // Minimal valid WAV header (silence); the key check runs first.
      final wav = <int>[
        ...'RIFF'.codeUnits,
        36, 0, 0, 0,
        ...'WAVEfmt '.codeUnits,
        16, 0, 0, 0, 1, 0, 1, 0,
        0x44, 0xac, 0, 0, 0x88, 0x58, 0x01, 0x00, 0x02, 0x00, 0x10, 0x00,
        ...'data'.codeUnits,
        0, 0, 0, 0,
      ];
      try {
        await client.transcribe(base!, wav);
        fail('expected a 409 without a Fish key');
      } on ApiError catch (error) {
        expect(error.status, 409);
      }
      // ignore: avoid_print
      print('phase5 transcribe live ok');
    } finally {
      client.close();
    }
  });

  test('live session without a provider key answers needsKey',
      skip: base == null, () async {
    final client = MaximusClient();
    try {
      final bots = await client.bots(base!);
      expect(bots, isNotEmpty);

      expect(await client.currentLiveCall(base), isNull);

      try {
        await client.startLiveSession(
          base,
          botId: bots.first.id,
          threadId: bots.first.threadId,
          sdp: 'v=0\r\no=fake\r\n',
          client: 'ios',
        );
        fail('expected a 409 without a provider key');
      } on ApiError catch (error) {
        expect(error.status, 409);
        expect(error.details?['needsKey'], isTrue);
      }

      expect(await client.endLiveCall(base, 'no-such-call'), isNull);

      // ignore: avoid_print
      print('phase5 live live ok');
    } finally {
      client.close();
    }
  });
}
