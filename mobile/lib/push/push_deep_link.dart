import 'package:flutter/material.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../api/thread_cache.dart';
import '../chat/thread_page.dart';
import 'push_service.dart';

/// Resolves a push tap's thread id to its conversation, then swaps itself
/// for the thread. Unknown or deleted threads explain instead of hanging.
class PushDeepLinkPage extends StatelessWidget {
  const PushDeepLinkPage({
    super.key,
    required this.client,
    required this.baseUrl,
    required this.tap,
    this.cache,
    this.serverId,
    this.onSessionEnded,
  });

  final MaximusApi client;
  final String baseUrl;
  final PushTap tap;
  final ThreadCache? cache;
  final String? serverId;
  final Future<void> Function()? onSessionEnded;

  Future<Widget> _resolve() async {
    final threadId = tap.threadId;
    if (threadId.isEmpty) return _gone('This update has no conversation.');
    try {
      final bots = await client.bots(baseUrl);
      for (final bot in bots) {
        if (bot.threadId == threadId) {
          return _thread(bot, ThreadSummary(threadId: threadId, title: bot.name, createdAt: 0));
        }
        for (final task in bot.tasks) {
          if (task.threadId == threadId) return _thread(bot, task);
        }
      }
      final groups = await client.groups(baseUrl);
      for (final group in groups) {
        if (group.threadId == threadId) {
          // GroupThreadPage needs auth; rebuild its ThreadPage directly.
          return ThreadPage(
            client: client,
            baseUrl: baseUrl,
            bot: BotSummary(
              id: group.id,
              name: group.name,
              title: '',
              description: '',
              threadId: group.threadId,
              notifications: true,
              color: 'ember',
              unread: false,
            ),
            thread: ThreadSummary(
              threadId: group.threadId,
              title: group.name,
              createdAt: 0,
            ),
            groupId: group.id,
            cache: cache,
            serverId: serverId,
            onSessionEnded: onSessionEnded,
          );
        }
      }
    } on ApiError {
      return _gone('Could not reach the server.');
    }
    return _gone('That conversation is gone.');
  }

  ThreadPage _thread(BotSummary bot, ThreadSummary thread) => ThreadPage(
    client: client,
    baseUrl: baseUrl,
    bot: bot,
    thread: thread,
    cache: cache,
    serverId: serverId,
    onSessionEnded: onSessionEnded,
  );

  Widget _gone(String detail) => Scaffold(
    appBar: AppBar(),
    body: Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.forum_outlined, size: 48),
            const SizedBox(height: 12),
            Text(detail, textAlign: TextAlign.center),
          ],
        ),
      ),
    ),
  );

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<Widget>(
      future: _resolve(),
      builder: (context, snapshot) {
        if (!snapshot.hasData) {
          return const Scaffold(
            body: Center(child: CircularProgressIndicator()),
          );
        }
        return snapshot.data!;
      },
    );
  }
}
