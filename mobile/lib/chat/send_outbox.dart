import 'dart:convert';
import 'dart:math';

import 'package:flutter/widgets.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api/models.dart';

String newSendId() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
}

class OutboxItem {
  const OutboxItem({
    required this.sendId,
    required this.threadId,
    required this.botId,
    required this.text,
    this.groupId,
    this.replyToId,
    this.attachments = const [],
  });

  final String sendId;
  final String threadId;
  final String botId;
  final String? groupId;
  final String text;
  final String? replyToId;
  final List<UploadedAttachment> attachments;

  Map<String, Object?> toJson() => {
    'sendId': sendId,
    'threadId': threadId,
    'botId': botId,
    if (groupId != null) 'groupId': groupId,
    'text': text,
    if (replyToId != null) 'replyToId': replyToId,
    'attachments': [
      for (final a in attachments)
        {'path': a.path, 'mime': a.mime, 'bytes': a.bytes},
    ],
  };

  static OutboxItem? tryFrom(Map<String, Object?> json) {
    final sendId = json['sendId'];
    final threadId = json['threadId'];
    final botId = json['botId'];
    final text = json['text'];
    if (sendId is! String || sendId.length < 16) return null;
    if (threadId is! String || botId is! String || text is! String) return null;
    final raw = json['attachments'];
    return OutboxItem(
      sendId: sendId,
      threadId: threadId,
      botId: botId,
      groupId: json['groupId'] as String?,
      text: text,
      replyToId: json['replyToId'] as String?,
      attachments: [
        for (final item in raw is List ? raw : const [])
          if (item is Map) UploadedAttachment.fromJson(Map<String, Object?>.from(item)),
      ],
    );
  }
}

/// Durable unsent chat lines. Same sendId is reused until the server accepts.
class SendOutbox {
  SendOutbox({Map<String, String>? memory}) : _memory = memory ?? (_test ? <String, String>{} : null);

  final Map<String, String>? _memory;

  static bool get _test =>
      WidgetsBinding.instance.runtimeType.toString().contains('Test');

  static String _key(String threadId) => 'maximus.outbox.$threadId';

  Future<List<OutboxItem>> pending(String threadId) async {
    final raw = await _read(_key(threadId));
    if (raw == null || raw.isEmpty) return const [];
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! List) return const [];
      return [
        for (final item in decoded)
          if (item is Map) ?OutboxItem.tryFrom(Map<String, Object?>.from(item)),
      ];
    } catch (_) {
      return const [];
    }
  }

  Future<void> enqueue(OutboxItem item) async {
    final next = [
      for (final existing in await pending(item.threadId))
        if (existing.sendId != item.sendId) existing,
      item,
    ];
    await _write(_key(item.threadId), jsonEncode([for (final row in next) row.toJson()]));
  }

  Future<void> remove(String threadId, String sendId) async {
    final next = [
      for (final existing in await pending(threadId))
        if (existing.sendId != sendId) existing,
    ];
    if (next.isEmpty) {
      await _clear(_key(threadId));
      return;
    }
    await _write(_key(threadId), jsonEncode([for (final row in next) row.toJson()]));
  }

  Future<String?> _read(String key) async {
    if (_memory != null) return _memory[key];
    try {
      return (await SharedPreferences.getInstance()).getString(key);
    } catch (_) {
      return null;
    }
  }

  Future<void> _write(String key, String value) async {
    if (_memory != null) {
      _memory[key] = value;
      return;
    }
    try {
      await (await SharedPreferences.getInstance()).setString(key, value);
    } catch (_) {}
  }

  Future<void> _clear(String key) async {
    if (_memory != null) {
      _memory.remove(key);
      return;
    }
    try {
      await (await SharedPreferences.getInstance()).remove(key);
    } catch (_) {}
  }
}
