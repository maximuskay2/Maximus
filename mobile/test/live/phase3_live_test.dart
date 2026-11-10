import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:maximus/api/client.dart';

/// Live E2E for Phase 3 writes against a real harness. Skips unless set:
///   MAXIMUS_E2E_BASE=http://127.0.0.1:8841 flutter test test/live/
/// Uses loopback owner trust (no pairing needed on a dev harness).
void main() {
  final base = Platform.environment['MAXIMUS_E2E_BASE'];

  test('send, react, interrupt, upload, bot + group CRUD', skip: base == null, () async {
    final client = MaximusClient();
    try {
      final bots = await client.bots(base!);
      expect(bots, isNotEmpty);
      final bot = bots.first;

      // Send a message (the turn may stall without engines; the post echoes).
      final sent = await client.sendMessage(base, bot.id, 'hello from e2e');
      expect(sent.text, contains('hello from e2e'));

      // React to it, then remove the reaction.
      await client.react(base, bot.threadId, sent.id, '👍', true);
      await client.react(base, bot.threadId, sent.id, '👍', false);

      // Interrupt the (probably stalled) turn.
      await client.interrupt(base, bot.id, bot.threadId);

      // Upload a tiny PNG (attachments endpoint is image-only).
      const png = [
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
        0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
        0x54, 0x08, 0xd7, 0x63, 0xf8, 0x0f, 0x00, 0x00,
        0x01, 0x01, 0x01, 0x00, 0x1b, 0xe8, 0x1a, 0xe5,
        0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
        0xae, 0x42, 0x60, 0x82,
      ];
      final uploaded = await client.uploadAttachment(
        base,
        png,
        'image/png',
      );
      expect(uploaded.path, isNotEmpty);

      // Bot create + edit.
      final created = await client.createBot(base, name: 'E2E Bot');
      expect(created.id, isNotEmpty);
      final patched = await client.patchBot(
        base,
        created.id,
        {'title': 'e2e title'},
      );
      expect(patched.id, created.id);

      // Group create + setup + send.
      final group = await client.createGroup(
        base,
        name: 'E2E Room',
        memberIds: [bot.id],
      );
      expect(group.threadId, isNotEmpty);
      await client.finishGroupSetup(
        base,
        group.id,
        defaultResponder: {'kind': 'member', 'botId': bot.id},
      );
      final groups = await client.groups(base);
      expect(groups.any((g) => g.id == group.id), isTrue);
      final gsent = await client.sendGroupMessage(
        base,
        group.id,
        'hello room',
      );
      expect(gsent.text, contains('hello room'));

      // ignore: avoid_print
      print('phase3 live ok');
    } finally {
      client.close();
    }
  });
}
