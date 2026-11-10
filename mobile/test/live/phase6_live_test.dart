import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:maximus/api/client.dart';
import 'package:maximus/api/models.dart';
import 'package:maximus/api/session_store.dart';
import 'package:maximus/auth/auth_state.dart';

/// Live E2E for Phase 6 (routines, computer review, on-phone tools)
/// against a real harness. Skips unless set:
///   MAXIMUS_E2E_BASE=http://127.0.0.1:8841 flutter test test/live/
/// Uses loopback owner trust (no pairing needed on a dev harness).
void main() {
  final base = Platform.environment['MAXIMUS_E2E_BASE'];
  final code = Platform.environment['MAXIMUS_E2E_CODE'];

  test('routines CRUD + run now + history', skip: base == null, () async {
    final client = MaximusClient();
    try {
      final bots = await client.bots(base!);
      expect(bots, isNotEmpty);

      final created = await client.createRoutine(
        base,
        name: 'E2E morning check',
        prompt: 'Check in on open work.',
        botId: bots.first.id,
        schedule: const {
          'type': 'daily',
          'time': '08:00',
        },
      );
      expect(created.id, isNotEmpty);

      final listed = await client.routines(base);
      expect(listed.routines.any((r) => r.id == created.id), isTrue);

      final paused = await client.patchRoutine(base, created.id, {
        'enabled': false,
      });
      expect(paused.enabled, isFalse);

      // A paused routine still runs on demand.
      final run = await client.runRoutineNow(base, created.id);
      expect(run.routineId, created.id);

      final history =
          (await client.routines(base)).runs.where((r) => r.routineId == created.id);
      expect(history, isNotEmpty);

      expect(await client.deleteRoutine(base, created.id), isTrue);
      // ignore: avoid_print
      print('phase6 routines live ok');
    } finally {
      client.close();
    }
  });

  test('computer frames + browser viewer fail closed', skip: base == null,
      () async {
    final client = MaximusClient();
    try {
      // No computer sharing on a fresh harness: empty, not an error.
      final frames = await client.computerFrames(base!);
      expect(frames.computers, isEmpty);

      // Viewer actions against a bot with no browser session fail closed.
      final bots = await client.bots(base);
      expect(bots, isNotEmpty);
      var sawError = false;
      try {
        await client.browserAction(base, bots.first.id, {
          'type': 'take',
          'viewerId': 'e2e',
        });
      } on ApiError {
        sawError = true;
      }
      expect(sawError, isTrue);
      // ignore: avoid_print
      print('phase6 computer live ok');
    } finally {
      client.close();
    }
  });

  test('phone register, poll, unregister', skip: base == null || code == null,
      () async {
    final client = MaximusClient();
    try {
      // phones/self needs a paired session, not loopback trust.
      final auth = AuthState(store: MemorySessionStore(), client: client);
      await auth.load();
      await auth.pair(baseUrl: base!, code: code!, label: 'e2e-phone6');
      client.setCompanionToken(auth.active?.companionToken);
      final registered = await client.registerPhone(
        base,
        installId: 'e2e-install',
        name: 'E2E Phone',
        platform: 'ios',
        appVersion: '0.0.0-e2e',
        timeZone: 'America/New_York',
        capabilities: const {'calendar': '1', 'reminders': '1'},
      );
      expect(registered, isNotNull);

      final self = await client.phoneSelf(base);
      expect(self, isNotNull);
      expect(self?.key, registered?.key);

      final phones = await client.phones(base);
      expect(phones.any((p) => p.key == registered?.key), isTrue);

      // No jobs assigned: the long poll answers null (fast on a harness
      // with no queue wait configured).
      final job = await client.pollPhoneJob(base);
      expect(job, isNull);

      expect(await client.unregisterPhone(base), isTrue);
      // ignore: avoid_print
      print('phase6 phones live ok');
    } finally {
      client.close();
    }
  });
}
