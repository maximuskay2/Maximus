import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:maximus/api/client.dart';
import 'package:maximus/api/models.dart';
import 'package:maximus/api/thread_cache.dart';

import 'fake_api.dart';

void main() {
  late Directory dir;
  late DiskCache disk;
  late ThreadCache cache;

  setUp(() async {
    dir = await Directory.systemTemp.createTemp('maximus-cache-test');
    disk = await DiskCache.open(dir);
    cache = ThreadCache(disk);
  });

  tearDown(() async {
    try {
      await dir.delete(recursive: true);
    } catch (_) {}
  });

  test('write then read round-trips', () async {
    await disk.writeJson('k', {'a': 1});
    expect(await disk.readJson('k'), {'a': 1});
  });

  test('expired entries read as a miss', () async {
    await disk.writeJson('k', {'a': 1}, ttl: const Duration(milliseconds: 5));
    await Future<void>.delayed(const Duration(milliseconds: 30));
    expect(await disk.readJson('k'), isNull);
  });

  test('corrupt entries read as a miss', () async {
    await File('${dir.path}/k.json').writeAsString('not json{{{');
    expect(await disk.readJson('k'), isNull);
  });

  test('missing entries read as a miss', () async {
    expect(await disk.readJson('nope'), isNull);
  });

  test('LRU eviction keeps the cache under budget', () async {
    final tiny = await DiskCache.open(dir, maxBytes: 300);
    await tiny.writeJson('old', {'pad': 'x' * 200});
    // Make sure mtimes differ so LRU order is deterministic.
    await Future<void>.delayed(const Duration(milliseconds: 20));
    await tiny.writeJson('new', {'pad': 'y' * 200});
    // Eviction runs unawaited; poll for it.
    for (var i = 0; i < 50; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 20));
      if (await tiny.readJson('old') == null) break;
    }
    expect(await tiny.readJson('old'), isNull);
    expect(await tiny.readJson('new'), isNotNull);
  });

  test('reads refresh LRU order', () async {
    final tiny = await DiskCache.open(dir, maxBytes: 400);
    await tiny.writeJson('a', {'pad': 'x' * 150});
    await Future<void>.delayed(const Duration(milliseconds: 20));
    await tiny.writeJson('b', {'pad': 'y' * 150});
    // Touch 'a' so 'b' is evicted first.
    expect(await tiny.readJson('a'), isNotNull);
    await Future<void>.delayed(const Duration(milliseconds: 20));
    await tiny.writeJson('c', {'pad': 'z' * 150});
    for (var i = 0; i < 50; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 20));
      if (await tiny.readJson('b') == null) break;
    }
    expect(await tiny.readJson('a'), isNotNull);
    expect(await tiny.readJson('b'), isNull);
    expect(await tiny.readJson('c'), isNotNull);
  });

  test('thread round-trip preserves messages', () async {
    const page = ThreadMessages(
      messages: [
        ChatMessage(
          id: 'm1',
          role: 'user',
          kind: 'text',
          text: 'hello',
          attachments: [
            MessageAttachment(kind: 'image', path: 'p', mime: 'image/png'),
          ],
          reactions: [MessageReaction(emoji: '👍', by: 'u')],
        ),
      ],
      hasMore: true,
    );
    await cache.writeThread('s1', 't1', page);
    final read = await cache.readThread('s1', 't1');
    expect(read, isNotNull);
    expect(read!.messages, hasLength(1));
    expect(read.messages.first.text, 'hello');
    expect(read.messages.first.attachments, hasLength(1));
    expect(read.messages.first.reactions.first.emoji, '👍');
    expect(read.hasMore, isTrue);
  });

  test('bots and groups round-trip', () async {
    const bots = [
      BotSummary(
        id: 'b1',
        name: 'Chief',
        title: '',
        description: '',
        threadId: 't1',
        notifications: true,
        color: 'ember',
        unread: true,
      ),
    ];
    await cache.writeBots('s1', bots);
    final readBots = await cache.readBots('s1');
    expect(readBots, hasLength(1));
    expect(readBots!.first.name, 'Chief');
    expect(readBots.first.unread, isTrue);

    const groups = [
      GroupSummary(id: 'g1', name: 'Room', threadId: 'tg1'),
    ];
    await cache.writeGroups('s1', groups);
    final readGroups = await cache.readGroups('s1');
    expect(readGroups, hasLength(1));
    expect(readGroups!.first.name, 'Room');
  });

  test('prefetch fetches uncached threads and skips cached ones', () async {
    final fake = FakeApi();
    const bots = [
      BotSummary(
        id: 'b1',
        name: 'A',
        title: '',
        description: '',
        threadId: 't1',
        notifications: true,
        color: 'ember',
        unread: false,
      ),
      BotSummary(
        id: 'b2',
        name: 'B',
        title: '',
        description: '',
        threadId: 't2',
        notifications: true,
        color: 'ember',
        unread: false,
      ),
    ];
    // Pre-cache t2 so only t1 is fetched.
    await cache.writeThread(
      's1',
      't2',
      const ThreadMessages(messages: [], hasMore: false),
    );
    final fetched = await cache.prefetchRecent(
      fake,
      'http://x',
      's1',
      bots,
      const [],
    );
    expect(fetched, 1);
    expect(fake.threadMessageCalls, ['t1']);
    // A second run fetches nothing.
    final again = await cache.prefetchRecent(
      fake,
      'http://x',
      's1',
      bots,
      const [],
    );
    expect(again, 0);
  });

  test('prefetch honors the limit', () async {
    final fake = FakeApi();
    final bots = [
      for (var i = 0; i < 10; i++)
        BotSummary(
          id: 'b$i',
          name: 'B$i',
          title: '',
          description: '',
          threadId: 't$i',
          notifications: true,
          color: 'ember',
          unread: false,
        ),
    ];
    final fetched = await cache.prefetchRecent(
      fake,
      'http://x',
      's1',
      bots,
      const [],
      prefetchLimit: 3,
    );
    expect(fetched, 3);
  });
}
