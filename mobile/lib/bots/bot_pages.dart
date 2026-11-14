import 'package:flutter/material.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../api/thread_cache.dart';
import '../auth/auth_state.dart';
import '../chat/thread_page.dart';
import '../home/create_bot_sheet.dart';

/// Bot profile: threads with pin/archive swipe, Library, notification state.
class BotProfilePage extends StatefulWidget {
  const BotProfilePage({
    super.key,
    required this.client,
    required this.baseUrl,
    required this.bot,
    this.canEdit = false,
    this.onChanged,
    this.cache,
    this.serverId,
    this.onSessionEnded,
  });

  final MaximusApi client;
  final String baseUrl;
  final BotSummary bot;

  /// Disk cache passthrough for opened threads (both set to enable).
  final ThreadCache? cache;
  final String? serverId;
  final Future<void> Function()? onSessionEnded;

  /// Owner-only: shows the edit action. The server has no bot-delete
  /// endpoint — archive a thread to remove a conversation.
  final bool canEdit;
  final void Function(BotSummary bot)? onChanged;

  @override
  State<BotProfilePage> createState() => _BotProfilePageState();
}

class _BotProfilePageState extends State<BotProfilePage>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs = TabController(length: 2, vsync: this);
  late List<ThreadSummary> _threads;
  final List<_LibraryItem> _library = [];
  bool _libraryLoading = false;

  @override
  void initState() {
    super.initState();
    _threads = [
      for (final task in widget.bot.tasks)
        if (!task.archived) task,
    ]..sort(_byPinThenRecency);
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  static int _byPinThenRecency(ThreadSummary a, ThreadSummary b) {
    if (a.pinned != b.pinned) return a.pinned ? -1 : 1;
    return (b.updatedAt ?? b.createdAt).compareTo(a.updatedAt ?? a.createdAt);
  }

  Future<void> _patch(ThreadSummary thread, Map<String, Object?> patch) async {
    try {
      await widget.client.patchTask(
        widget.baseUrl,
        widget.bot.id,
        thread.threadId,
        patch,
      );
    } on ApiError catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.message)));
      }
      return;
    }
    setState(() {
      _threads = [
        for (final task in _threads)
          if (task.threadId == thread.threadId)
            ThreadSummary(
              threadId: task.threadId,
              title: task.title,
              createdAt: task.createdAt,
              updatedAt: task.updatedAt,
              pinned: patch['pinned'] as bool? ?? task.pinned,
              archived: patch.containsKey('archivedAt'),
            )
          else
            task,
      ].where((task) => !task.archived).toList()..sort(_byPinThenRecency);
    });
  }

  Future<void> _loadLibrary() async {
    if (_libraryLoading) return;
    setState(() => _libraryLoading = true);
    try {
      final items = <_LibraryItem>[];
      for (final thread in _threads.take(5)) {
        try {
          final page = await widget.client.threadMessages(
            widget.baseUrl,
            thread.threadId,
          );
          for (final message in page.messages) {
            if (message.publishedPage != null) {
              items.add(
                _LibraryItem(
                  page: message.publishedPage,
                  threadTitle: thread.title,
                ),
              );
            }
            for (final attachment in message.attachments) {
              items.add(
                _LibraryItem(
                  attachment: attachment,
                  threadTitle: thread.title,
                ),
              );
            }
          }
        } on ApiError {
          // One unreadable thread must not hide the rest.
        }
      }
      if (mounted) {
        setState(() {
          _library
            ..clear()
            ..addAll(items);
        });
      }
    } finally {
      if (mounted) setState(() => _libraryLoading = false);
    }
  }

  void _openThread(ThreadSummary thread) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => ThreadPage(
          client: widget.client,
          baseUrl: widget.baseUrl,
          bot: widget.bot,
          thread: thread,
          cache: widget.cache,
          serverId: widget.serverId,
          onSessionEnded: widget.onSessionEnded,
        ),
      ),
    );
  }

  Future<void> _edit() async {
    final name = TextEditingController(text: widget.bot.name);
    final title = TextEditingController(text: widget.bot.title);
    final description = TextEditingController(
      text: widget.bot.description,
    );
    final save = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => Padding(
        padding: EdgeInsets.only(
          left: 20,
          right: 20,
          top: 20,
          bottom: MediaQuery.of(context).viewInsets.bottom + 20,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'Edit bot',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 12),
            TextField(
              controller: name,
              decoration: const InputDecoration(labelText: 'Name'),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: title,
              decoration: const InputDecoration(labelText: 'Title'),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: description,
              decoration: const InputDecoration(labelText: 'Description'),
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: () => Navigator.of(context).pop(true),
                child: const Text('Save'),
              ),
            ),
          ],
        ),
      ),
    );
    if (save != true || !mounted) return;
    try {
      final updated = await widget.client.patchBot(
        widget.baseUrl,
        widget.bot.id,
        {
          'name': name.text.trim(),
          'title': title.text.trim(),
          'description': description.text.trim(),
        },
      );
      widget.onChanged?.call(updated);
      if (mounted) setState(() {});
    } on ApiError catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.message)));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final bot = widget.bot;
    return Scaffold(
      appBar: AppBar(
        title: Text(bot.name),
        actions: [
          if (widget.canEdit)
            IconButton(
              icon: const Icon(Icons.edit_outlined),
              tooltip: 'Edit bot',
              onPressed: _edit,
            ),
        ],
      ),
      body: Column(
        children: [
          ListTile(
            leading: CircleAvatar(
              backgroundColor: Theme.of(context).colorScheme.primary,
              child: Text(
                bot.name.isEmpty ? '?' : bot.name[0],
                style: TextStyle(
                  color: Theme.of(context).colorScheme.onPrimary,
                ),
              ),
            ),
            title: Text(bot.title.isEmpty ? bot.name : bot.title),
            subtitle: Text(
              bot.description.isEmpty ? 'No description' : bot.description,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
            trailing: Icon(
              bot.notifications
                  ? Icons.notifications_outlined
                  : Icons.notifications_off_outlined,
            ),
          ),
          TabBar(
            controller: _tabs,
            onTap: (index) {
              if (index == 1 && _library.isEmpty) _loadLibrary();
            },
            tabs: const [Tab(text: 'Threads'), Tab(text: 'Library')],
          ),
          Expanded(
            child: TabBarView(
              controller: _tabs,
              children: [
                _threads.isEmpty
                    ? const _EmptyThreads()
                    : RefreshIndicator(
                        onRefresh: () async => setState(() {}),
                        child: ListView.builder(
                          itemCount: _threads.length,
                          itemBuilder: (context, index) {
                            final thread = _threads[index];
                            return Dismissible(
                              key: ValueKey(thread.threadId),
                              background: Container(
                                color: Theme.of(
                                  context,
                                ).colorScheme.primaryContainer,
                                alignment: Alignment.centerLeft,
                                padding: const EdgeInsets.only(left: 20),
                                child: Icon(
                                  thread.pinned
                                      ? Icons.push_pin_outlined
                                      : Icons.push_pin,
                                ),
                              ),
                              secondaryBackground: Container(
                                color: Theme.of(
                                  context,
                                ).colorScheme.errorContainer,
                                alignment: Alignment.centerRight,
                                padding: const EdgeInsets.only(right: 20),
                                child: const Icon(Icons.archive_outlined),
                              ),
                              confirmDismiss: (direction) async {
                                if (direction ==
                                    DismissDirection.startToEnd) {
                                  await _patch(thread, {
                                    'pinned': !thread.pinned,
                                  });
                                } else {
                                  await _patch(thread, {
                                    'archivedAt':
                                        DateTime.now().millisecondsSinceEpoch,
                                  });
                                }
                                return false; // list updates via state
                              },
                              child: ListTile(
                                leading: thread.pinned
                                    ? const Icon(Icons.push_pin, size: 18)
                                    : null,
                                title: Text(thread.title),
                                subtitle: Text(
                                  _recency(thread),
                                  maxLines: 1,
                                ),
                                onTap: () => _openThread(thread),
                              ),
                            );
                          },
                        ),
                      ),
                _LibraryView(
                  items: _library,
                  loading: _libraryLoading,
                  onReload: _loadLibrary,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  static String _recency(ThreadSummary thread) {
    final at = thread.updatedAt ?? thread.createdAt;
    if (at <= 0) return 'no activity yet';
    final age = DateTime.now().difference(
      DateTime.fromMillisecondsSinceEpoch(at),
    );
    if (age.inMinutes < 1) return 'just now';
    if (age.inHours < 1) return '${age.inMinutes}m ago';
    if (age.inDays < 1) return '${age.inHours}h ago';
    return '${age.inDays}d ago';
  }
}

class _EmptyThreads extends StatelessWidget {
  const _EmptyThreads();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.forum_outlined,
              size: 48,
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
            const SizedBox(height: 12),
            Text(
              'No conversations yet',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 4),
            Text(
              'New threads appear here after the first message.',
              style: TextStyle(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _LibraryItem {
  const _LibraryItem({
    this.attachment,
    this.page,
    required this.threadTitle,
  });

  final MessageAttachment? attachment;
  final PublishedPage? page;
  final String threadTitle;

  String get title =>
      page?.title ??
      attachment?.name ??
      attachment?.mime ??
      'Item';
}

class _LibraryView extends StatelessWidget {
  const _LibraryView({
    required this.items,
    required this.loading,
    required this.onReload,
  });

  final List<_LibraryItem> items;
  final bool loading;
  final VoidCallback onReload;

  @override
  Widget build(BuildContext context) {
    if (loading && items.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (items.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.photo_library_outlined,
                size: 48,
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
              const SizedBox(height: 12),
              Text(
                'Nothing saved yet',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 4),
              Text(
                'Pages, images, files, and voice notes from recent threads land here.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 12),
              OutlinedButton(onPressed: onReload, child: const Text('Reload')),
            ],
          ),
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: () async => onReload(),
      child: ListView.builder(
        itemCount: items.length,
        itemBuilder: (context, index) {
          final item = items[index];
          final attachment = item.attachment;
          final page = item.page;
          return ListTile(
            leading: Icon(
              page != null
                  ? Icons.link_outlined
                  : switch (attachment?.kind) {
                      'image' => Icons.image_outlined,
                      'audio' => Icons.audio_file_outlined,
                      _ => Icons.insert_drive_file_outlined,
                    },
            ),
            title: Text(
              item.title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            subtitle: Text(
              page != null
                  ? '${page.state} · ${item.threadTitle}'
                  : item.threadTitle,
            ),
          );
        },
      ),
    );
  }
}

/// Shows the active server's bots; used by the Bots tab.
class BotListBody extends StatelessWidget {
  const BotListBody({
    super.key,
    required this.auth,
    required this.bots,
    required this.onRefresh,
  });

  final AuthState auth;
  final List<BotSummary> bots;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) {
    final baseUrl = auth.active?.baseUrl;
    if (baseUrl == null) return const Center(child: Text('No server.'));
    if (bots.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.smart_toy_outlined,
                size: 48,
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
              const SizedBox(height: 12),
              Text(
                'No bots on this server',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 4),
              Text(
                'Create your first bot from the computer, then pull to refresh.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView.builder(
        itemCount: bots.length,
        itemBuilder: (context, index) {
          final bot = bots[index];
          return ListTile(
            leading: CircleAvatar(
              backgroundColor: bot.unread
                  ? Theme.of(context).colorScheme.primary
                  : Theme.of(context).colorScheme.surfaceContainerHighest,
              child: Text(
                bot.name.isEmpty ? '?' : bot.name[0],
                style: TextStyle(
                  color: bot.unread
                      ? Theme.of(context).colorScheme.onPrimary
                      : Theme.of(context).colorScheme.onSurface,
                ),
              ),
            ),
            title: Text(bot.name),
            subtitle: Text(
              bot.title.isEmpty ? bot.description : bot.title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            trailing: bot.unread
                ? Icon(
                    Icons.circle,
                    size: 12,
                    color: Theme.of(context).colorScheme.primary,
                  )
                : null,
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) => BotProfilePage(
                  client: auth.client,
                  baseUrl: baseUrl,
                  bot: bot,
                  canEdit: auth.isAdmin,
                  onChanged: (_) => onRefresh(),
                  cache: auth.cache,
                  serverId: auth.active?.id,
                  onSessionEnded: auth.sessionEnded,
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

/// Bots tab: bot list + rooms + create actions (owner-only).
class BotsTab extends StatefulWidget {
  const BotsTab({
    super.key,
    required this.auth,
    required this.bots,
    required this.onRefresh,
  });

  final AuthState auth;
  final List<BotSummary> bots;
  final Future<void> Function() onRefresh;

  @override
  State<BotsTab> createState() => _BotsTabState();
}

class _BotsTabState extends State<BotsTab> {
  List<GroupSummary> _groups = const [];
  bool _loadingGroups = false;

  @override
  void initState() {
    super.initState();
    _loadGroups();
  }

  Future<void> _loadGroups() async {
    final server = widget.auth.active;
    final baseUrl = server?.baseUrl;
    if (server == null || baseUrl == null) return;
    final cache = widget.auth.cache;
    setState(() => _loadingGroups = true);
    if (cache != null) {
      final cached = await cache.readGroups(server.id);
      if (cached != null && mounted) setState(() => _groups = cached);
    }
    try {
      final groups = await widget.auth.client.groups(baseUrl);
      await cache?.writeGroups(server.id, groups);
      if (mounted) setState(() => _groups = groups);
    } on ApiError {
      // Rooms are optional; the bot list still works.
    } finally {
      if (mounted) setState(() => _loadingGroups = false);
    }
  }

  Future<void> _createBot() async {
    final baseUrl = widget.auth.active?.baseUrl;
    if (baseUrl == null) return;
    final created = await showCreateBotSheet(
      context: context,
      client: widget.auth.client,
      baseUrl: baseUrl,
    );
    if (created && mounted) await widget.onRefresh();
  }

  Future<void> _createGroup() async {
    final baseUrl = widget.auth.active?.baseUrl;
    if (baseUrl == null) return;
    final name = TextEditingController();
    final selected = <String>{};
    final create = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => StatefulBuilder(
        builder: (_, setSheet) => Padding(
          padding: EdgeInsets.only(
            left: 20,
            right: 20,
            top: 20,
            bottom: MediaQuery.of(sheetContext).viewInsets.bottom + 20,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                'New group chat',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 12),
              TextField(
                controller: name,
                decoration: const InputDecoration(labelText: 'Name'),
              ),
              const SizedBox(height: 8),
              ConstrainedBox(
                constraints: const BoxConstraints(maxHeight: 240),
                child: ListView(
                  shrinkWrap: true,
                  children: [
                    for (final bot in widget.bots)
                      CheckboxListTile(
                        value: selected.contains(bot.id),
                        onChanged: (on) => setSheet(
                          () => on == true
                              ? selected.add(bot.id)
                              : selected.remove(bot.id),
                        ),
                        title: Text(bot.name),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 8),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: selected.isEmpty
                      ? null
                      : () => Navigator.of(context).pop(true),
                  child: const Text('Create'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
    if (create != true || !mounted) return;
    try {
      final group = await widget.auth.client.createGroup(
        baseUrl,
        name: name.text.trim().isEmpty ? null : name.text.trim(),
        memberIds: selected.toList(),
      );
      // Finish room setup so the first message can be sent.
      final members = selected.toList();
      await widget.auth.client.finishGroupSetup(
        baseUrl,
        group.id,
        skip: members.isEmpty,
        defaultResponder: members.isEmpty
            ? null
            : {'kind': 'member', 'botId': members.first},
      );
      await _loadGroups();
    } on ApiError catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.message)));
      }
    }
  }

  void _openGroup(GroupSummary group) {
    final baseUrl = widget.auth.active?.baseUrl;
    if (baseUrl == null) return;
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => GroupThreadPage(
          auth: widget.auth,
          baseUrl: baseUrl,
          group: group,
          memberNames: [
            for (final bot in widget.bots)
              if (group.memberIds.contains(bot.id)) bot.name,
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Bots')),
      body: Column(
        children: [
          Expanded(
            child: BotListBody(
              auth: widget.auth,
              bots: widget.bots,
              onRefresh: widget.onRefresh,
            ),
          ),
          if (_loadingGroups)
            const LinearProgressIndicator()
          else if (_groups.isNotEmpty)
            Flexible(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Divider(height: 1),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: Text(
                        'Rooms',
                        style: Theme.of(context).textTheme.titleSmall,
                      ),
                    ),
                  ),
                  Flexible(
                    child: ListView(
                      shrinkWrap: true,
                      children: [
                        for (final group in _groups)
                          ListTile(
                            leading: const Icon(Icons.forum_outlined),
                            title: Text(group.name),
                            subtitle: Text(
                              '${group.memberIds.length} members',
                            ),
                            onTap: () => _openGroup(group),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
      floatingActionButton: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          FloatingActionButton.extended(
            heroTag: 'new-bot',
            onPressed: _createBot,
            icon: const Icon(Icons.smart_toy_outlined),
            label: const Text('New agent'),
          ),
          if (widget.auth.isAdmin) ...[
            const SizedBox(height: 8),
            FloatingActionButton.extended(
              heroTag: 'new-group',
              onPressed: _createGroup,
              icon: const Icon(Icons.group_add_outlined),
              label: const Text('New group'),
            ),
          ],
        ],
      ),
    );
  }
}

/// Room thread: ThreadPage with group send + member mentions.
class GroupThreadPage extends StatelessWidget {
  const GroupThreadPage({
    super.key,
    required this.auth,
    required this.baseUrl,
    required this.group,
    this.memberNames = const [],
  });

  final AuthState auth;
  final String baseUrl;
  final GroupSummary group;

  /// Display names for `@` mentions (plus `@everyone` in the composer).
  final List<String> memberNames;

  @override
  Widget build(BuildContext context) {
    return ThreadPage(
      client: auth.client,
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
      botNames: memberNames,
      cache: auth.cache,
      serverId: auth.active?.id,
      onSessionEnded: auth.sessionEnded,
    );
  }
}
