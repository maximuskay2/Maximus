import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:maximus/api/client.dart';

/// Live E2E for Phase 2 reads against a real harness. Skips unless set:
///   MAXIMUS_E2E_BASE=http://127.0.0.1:8841 flutter test test/live/
/// Uses loopback owner trust (no pairing needed on a dev harness).
void main() {
  final base = Platform.environment['MAXIMUS_E2E_BASE'];

  test('read bots, thread, search; pin round-trip', skip: base == null, () async {
    final client = MaximusClient();
    try {
      final bots = await client.bots(base!);
      expect(bots, isNotEmpty);
      final bot = bots.first;
      expect(bot.threadId, isNotEmpty);
      final page = await client.threadMessages(base, bot.threadId);
      expect(page.messages, isA<List>());
      final hits = await client.search(base, 'hello');
      expect(hits, isA<List>());
      // Pin round-trip on the first thread (or the main thread id).
      final threadId = bot.tasks.isEmpty
          ? bot.threadId
          : bot.tasks.first.threadId;
      await client.patchTask(base, bot.id, threadId, {'pinned': true});
      await client.patchTask(base, bot.id, threadId, {'pinned': false});
      // ignore: avoid_print
      print('phase2 live: bots=${bots.length} ok');
    } finally {
      client.close();
    }
  });
}
