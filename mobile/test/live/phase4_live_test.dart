import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:maximus/api/client.dart';

/// Live E2E for Phase 4 client calls against a real harness. Skips unless:
///   MAXIMUS_E2E_BASE=http://127.0.0.1:8843 flutter test test/live/
/// Needs a harness built with the push routes (the :8841 mobile harness
/// predates them; any fresh dev-server works).
void main() {
  final base = Platform.environment['MAXIMUS_E2E_BASE'];

  test('push register, status, settings, unregister', skip: base == null,
      () async {
    final client = MaximusClient();
    try {
      const token = 'live-probe-token-phase4';
      // A previous probe may have left the global switch off.
      expect(await client.setPushEnabled(base!, true), isTrue);
      final enabled = await client.registerPush(
        base,
        token: token,
        platform: 'ios',
        deviceName: 'live probe',
      );
      expect(enabled, isTrue);

      final status = await client.pushStatus(base);
      expect(status.configured, isFalse); // no FCM creds on a dev harness
      expect(
        status.devices.any((d) => d.fingerprint == token.substring(token.length - 8)),
        isTrue,
      );

      expect(await client.setPushEnabled(base, false), isFalse);
      expect((await client.pushStatus(base)).enabled, isFalse);
      expect(await client.setPushEnabled(base, true), isTrue);

      expect(await client.unregisterPush(base, token), isTrue);
      expect(await client.unregisterPush(base, token), isFalse);

      // ignore: avoid_print
      print('phase4 push live ok');
    } finally {
      client.close();
    }
  });

  test('respond to a bogus card answers unavailable, never throws',
      skip: base == null, () async {
    final client = MaximusClient();
    try {
      final bots = await client.bots(base!);
      expect(bots, isNotEmpty);
      final outcome = await client.respondToCard(
        base,
        bots.first.threadId,
        requestId: 'no-such-card',
        behavior: 'allow',
      );
      expect(outcome, 'unavailable');
      // ignore: avoid_print
      print('phase4 respond live ok');
    } finally {
      client.close();
    }
  });
}
