import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

import 'client.dart';
import 'models.dart';

/// Disk-backed JSON cache with per-entry TTL and LRU byte-budget eviction.
///
/// One file per key under the app support directory (`maximus-cache/`).
/// Readers use stale-while-revalidate: a hit renders instantly, then the
/// network refresh overwrites the entry. Corrupt or expired entries read
/// as a miss and are deleted lazily.
class DiskCache {
  DiskCache._(this._dir, {this.maxBytes = 32 * 1024 * 1024});

  final Directory _dir;
  final int maxBytes;

  static DiskCache? _shared;

  /// Shared cache in the app support directory.
  static Future<DiskCache> shared() async {
    final existing = _shared;
    if (existing != null) return existing;
    final support = await getApplicationSupportDirectory();
    final cache = await open(Directory('${support.path}/maximus-cache'));
    _shared = cache;
    return cache;
  }

  /// Open a cache at an explicit directory (tests, custom roots).
  static Future<DiskCache> open(Directory dir, {int? maxBytes}) async {
    await dir.create(recursive: true);
    return DiskCache._(dir, maxBytes: maxBytes ?? 32 * 1024 * 1024);
  }

  static final _safe = RegExp(r'[^A-Za-z0-9._-]');

  String _fileName(String key) {
    final cleaned = key.replaceAll(_safe, '_');
    if (cleaned.length <= 120) return '$cleaned.json';
    // Long keys (query strings): hash to keep filenames bounded.
    var hash = 0;
    for (final unit in key.codeUnits) {
      hash = ((hash << 5) - hash + unit) & 0x7fffffff;
    }
    return '${cleaned.substring(0, 100)}_$hash.json';
  }

  File _file(String key) => File('${_dir.path}/${_fileName(key)}');

  /// Read a fresh entry, or null on miss/expiry/corruption.
  Future<Object?> readJson(String key) async {
    final file = _file(key);
    try {
      final raw = await file.readAsString();
      final decoded = jsonDecode(raw);
      if (decoded is! Map<String, Object?>) {
        await file.delete();
        return null;
      }
      final expiresAt = (decoded['expiresAt'] as num?)?.toInt();
      if (expiresAt == null ||
          DateTime.now().millisecondsSinceEpoch > expiresAt) {
        await file.delete();
        return null;
      }
      // Touch for LRU ordering.
      final now = DateTime.now();
      await file.setLastModified(now);
      return decoded['value'];
    } catch (_) {
      return null;
    }
  }

  /// Store [value] (must be JSON-encodable) with a TTL.
  Future<void> writeJson(
    String key,
    Object? value, {
    Duration ttl = const Duration(minutes: 15),
  }) async {
    final file = _file(key);
    final envelope = {
      'expiresAt':
          DateTime.now().add(ttl).millisecondsSinceEpoch,
      'value': value,
    };
    try {
      await file.writeAsString(jsonEncode(envelope), flush: true);
      unawaited(_evictIfNeeded());
    } catch (_) {
      // Cache writes never fail the caller.
    }
  }

  Future<void> invalidate(String key) async {
    try {
      await _file(key).delete();
    } catch (_) {}
  }

  Future<void> _evictIfNeeded() async {
    try {
      final entries = <_Entry>[];
      await for (final entity in _dir.list()) {
        if (entity is! File || !entity.path.endsWith('.json')) continue;
        final stat = await entity.stat();
        entries.add(_Entry(entity, stat.size, stat.modified));
      }
      var total = entries.fold<int>(0, (sum, e) => sum + e.bytes);
      if (total <= maxBytes) return;
      entries.sort((a, b) => a.modified.compareTo(b.modified));
      for (final entry in entries) {
        if (total <= maxBytes) break;
        try {
          await entry.file.delete();
          total -= entry.bytes;
        } catch (_) {}
      }
    } catch (_) {}
  }
}

class _Entry {
  const _Entry(this.file, this.bytes, this.modified);
  final File file;
  final int bytes;
  final DateTime modified;
}

/// Typed cache keys + prefetch policy for threads.
///
/// Policy: after the bot list loads, prefetch the newest message page of
/// the [prefetchLimit] most recently touched bot threads plus room threads,
/// skipping entries that are already cached fresh. Bounded and sequential
/// so a cold start never floods the server.
class ThreadCache {
  ThreadCache(this.disk);

  final DiskCache disk;

  static const botsTtl = Duration(minutes: 5);
  static const groupsTtl = Duration(minutes: 5);
  static const threadTtl = Duration(minutes: 30);

  String threadKey(String serverId, String threadId) =>
      'thread:$serverId:$threadId';
  String botsKey(String serverId) => 'bots:$serverId';
  String groupsKey(String serverId) => 'groups:$serverId';

  Future<List<BotSummary>?> readBots(String serverId) async {
    final raw = await disk.readJson(botsKey(serverId));
    if (raw is! List) return null;
    try {
      return [
        for (final item in raw)
          if (item is Map<String, Object?>) BotSummary.fromJson(item),
      ];
    } catch (_) {
      return null;
    }
  }

  Future<void> writeBots(String serverId, List<BotSummary> bots) =>
      disk.writeJson(
        botsKey(serverId),
        [for (final b in bots) b.toJson()],
        ttl: botsTtl,
      );

  Future<List<GroupSummary>?> readGroups(String serverId) async {
    final raw = await disk.readJson(groupsKey(serverId));
    if (raw is! List) return null;
    try {
      return [
        for (final item in raw)
          if (item is Map<String, Object?>)
            ?GroupSummary.fromJson(item),
      ];
    } catch (_) {
      return null;
    }
  }

  Future<void> writeGroups(String serverId, List<GroupSummary> groups) =>
      disk.writeJson(
        groupsKey(serverId),
        [for (final g in groups) g.toJson()],
        ttl: groupsTtl,
      );

  Future<ThreadMessages?> readThread(
    String serverId,
    String threadId,
  ) async {
    final raw = await disk.readJson(threadKey(serverId, threadId));
    if (raw is! Map<String, Object?>) return null;
    try {
      final messages = raw['messages'];
      if (messages is! List) return null;
      return ThreadMessages(
        messages: [
          for (final item in messages)
            if (item is Map<String, Object?>) ChatMessage.fromJson(item),
        ],
        hasMore: (raw['hasMore'] as bool?) ?? false,
      );
    } catch (_) {
      return null;
    }
  }

  Future<void> writeThread(
    String serverId,
    String threadId,
    ThreadMessages page,
  ) =>
      disk.writeJson(
        threadKey(serverId, threadId),
        {
          'messages': [for (final m in page.messages) m.toJson()],
          'hasMore': page.hasMore,
        },
        ttl: threadTtl,
      );

  /// Prefetch newest pages for the most recently touched threads.
  Future<int> prefetchRecent(
    MaximusApi client,
    String baseUrl,
    String serverId,
    List<BotSummary> bots,
    List<GroupSummary> groups, {
    int prefetchLimit = 6,
  }) async {
    final threadIds = <String>[
      for (final bot in bots)
        if (bot.threadId.isNotEmpty) bot.threadId,
      for (final group in groups)
        if (group.threadId.isNotEmpty) group.threadId,
    ];
    var fetched = 0;
    for (final threadId in threadIds.take(prefetchLimit)) {
      if (await readThread(serverId, threadId) != null) continue;
      try {
        final page = await client.threadMessages(baseUrl, threadId);
        await writeThread(serverId, threadId, page);
        fetched++;
      } catch (_) {
        // Prefetch is best-effort; a later open pulls fresh.
      }
    }
    return fetched;
  }
}
