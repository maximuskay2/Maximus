import 'dart:async';

import 'package:flutter/material.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../api/thread_cache.dart';
import '../auth/auth_state.dart';
import '../bots/bot_pages.dart';
import '../call/call_page.dart';
import '../chat/drafts.dart';
import '../chat/thread_page.dart';
import 'app_link.dart';
import 'live_activities.dart';

/// Phase 9: opens `maximus://` links from Siri, Shortcuts, and the
/// Action button. Signed-out links wait as [pending] and open after the
/// first server activates — Siri invocations must not die on the
/// welcome screen.
class DeepLinkRouter {
  DeepLinkRouter({required this.auth, required this.live, this.drafts});

  final AuthState auth;
  final LiveActivities live;

  /// Injectable draft store for opened threads (memory in tests).
  final DraftStore? drafts;

  AppLink? pending;

  Future<bool> open(BuildContext context, AppLink link) async {
    final server = auth.active;
    if (server == null) {
      pending = link;
      return false;
    }
    final baseUrl = server.baseUrl;
    switch (link.kind) {
      case AppLinkKind.bots:
        final bots = await _bots(baseUrl);
        if (!context.mounted) return false;
        await Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => _LinkedBotsPage(
              auth: auth,
              client: auth.client,
              baseUrl: baseUrl,
              initial: bots,
              cache: auth.cache,
              serverId: server.id,
            ),
          ),
        );
        return true;
      case AppLinkKind.thread:
      case AppLinkKind.dictate:
        final resolved = await _resolve(
          baseUrl,
          threadId: link.threadId,
          botName: link.botName,
        );
        if (resolved == null) {
          if (context.mounted) _missing(context, 'conversation');
          return false;
        }
        if (!context.mounted) return false;
        await Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => ThreadPage(
              client: auth.client,
              baseUrl: baseUrl,
              bot: resolved.bot,
              thread: resolved.thread,
              groupId: resolved.groupId,
              cache: auth.cache,
              serverId: server.id,
              initialText: link.text,
              autoDictate: link.kind == AppLinkKind.dictate,
              liveActivities: live,
              drafts: drafts,
            ),
          ),
        );
        return true;
      case AppLinkKind.call:
        final resolved = await _resolve(
          baseUrl,
          threadId: link.threadId,
          botName: link.botName,
        );
        if (resolved == null) {
          if (context.mounted) _missing(context, 'bot to call');
          return false;
        }
        if (!context.mounted) return false;
        await Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => CallPage(
              client: auth.client,
              baseUrl: baseUrl,
              bot: resolved.bot,
              thread: resolved.thread,
              liveActivities: live,
            ),
          ),
        );
        return true;
    }
  }

  /// Opens the link that arrived while signed out, if any.
  Future<void> flush(BuildContext context) async {
    final link = pending;
    if (link == null || auth.active == null) return;
    pending = null;
    await open(context, link);
  }

  /// Shares the bot list with Siri suggestions. Best-effort.
  Future<void> syncNames() async {
    final server = auth.active;
    if (server == null) return;
    try {
      await _bots(server.baseUrl);
    } on ApiError {
      // Next open retries; Siri falls back to free text meanwhile.
    }
  }

  Future<List<BotSummary>> _bots(String baseUrl) async {
    final bots = await auth.client.bots(baseUrl);
    unawaited(live.syncBots([for (final b in bots) [b.id, b.name]]));
    return bots;
  }

  /// Resolves a thread id or bot name to an openable conversation.
  /// Mirrors PushDeepLinkPage's bot/task/group walk.
  Future<_Resolved?> _resolve(
    String baseUrl, {
    String? threadId,
    String? botName,
  }) async {
    try {
      final bots = await _bots(baseUrl);
      if (threadId != null && threadId.isNotEmpty) {
        for (final bot in bots) {
          if (bot.threadId == threadId) {
            return _Resolved(
              bot,
              ThreadSummary(
                threadId: threadId,
                title: bot.name,
                createdAt: 0,
              ),
              null,
            );
          }
          for (final task in bot.tasks) {
            if (task.threadId == threadId) {
              return _Resolved(bot, task, null);
            }
          }
        }
        final groups = await auth.client.groups(baseUrl);
        for (final group in groups) {
          if (group.threadId == threadId) {
            return _Resolved(
              BotSummary(
                id: group.id,
                name: group.name,
                title: '',
                description: '',
                threadId: group.threadId,
                notifications: true,
                color: 'ember',
                unread: false,
              ),
              ThreadSummary(
                threadId: group.threadId,
                title: group.name,
                createdAt: 0,
              ),
              group.id,
            );
          }
        }
        return null;
      }
      final bot = botName == null || botName.isEmpty
          ? (bots.isEmpty ? null : bots.first)
          : resolveBotName(bots, botName);
      if (bot == null) return null;
      return _Resolved(
        bot,
        ThreadSummary(threadId: bot.threadId, title: bot.name, createdAt: 0),
        null,
      );
    } on ApiError {
      return null;
    }
  }

  void _missing(BuildContext context, String what) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Could not find that $what.')),
    );
  }
}

/// Matches a Siri-spoken bot name: exact (case-insensitive), then
/// prefix, then substring. Pure for tests.
BotSummary? resolveBotName(List<BotSummary> bots, String query) {
  final needle = query.trim().toLowerCase();
  if (needle.isEmpty || bots.isEmpty) return null;
  for (final bot in bots) {
    if (bot.name.trim().toLowerCase() == needle) return bot;
  }
  for (final bot in bots) {
    if (bot.name.trim().toLowerCase().startsWith(needle)) return bot;
  }
  for (final bot in bots) {
    if (bot.name.trim().toLowerCase().contains(needle)) return bot;
  }
  return null;
}

class _Resolved {
  const _Resolved(this.bot, this.thread, this.groupId);
  final BotSummary bot;
  final ThreadSummary thread;
  final String? groupId;
}

/// Bots list as a pushed page (Siri "open my bots").
class _LinkedBotsPage extends StatefulWidget {
  const _LinkedBotsPage({
    required this.auth,
    required this.client,
    required this.baseUrl,
    required this.initial,
    this.cache,
    this.serverId,
  });

  final AuthState auth;
  final MaximusApi client;
  final String baseUrl;
  final List<BotSummary> initial;
  final ThreadCache? cache;
  final String? serverId;

  @override
  State<_LinkedBotsPage> createState() => _LinkedBotsPageState();
}

class _LinkedBotsPageState extends State<_LinkedBotsPage> {
  late List<BotSummary> _bots = widget.initial;

  Future<void> _refresh() async {
    try {
      final bots = await widget.client.bots(widget.baseUrl);
      if (mounted) setState(() => _bots = bots);
    } on ApiError {
      // Keep the stale list; BotsTab surfaces its own errors.
    }
  }

  @override
  Widget build(BuildContext context) {
    // BotsTab owns its Scaffold + AppBar; wrapping it would double both.
    return BotsTab(auth: widget.auth, bots: _bots, onRefresh: _refresh);
  }
}
