import 'dart:async';

import 'package:flutter/material.dart';

import '../api/models.dart';
import '../api/thread_cache.dart';
import '../auth/auth_state.dart';
import '../billing/subscribe_ask.dart';
import '../auth/pair_page.dart';
import '../auth/session_actions.dart';
import '../automations/computer_page.dart';
import '../automations/routines_page.dart';
import '../bots/bot_pages.dart';
import '../chat/thread_page.dart';
import '../home/create_bot_sheet.dart';
import '../phoneapps/phones_page.dart';
import '../phoneapps/poller.dart';
import '../push/push_service.dart';
import '../search/search_page.dart';
import '../settings/account_page.dart';
import '../settings/bot_settings_page.dart';
import '../settings/computer_settings_page.dart';
import '../settings/devices_page.dart';
import '../settings/preferences.dart';
import '../settings/settings_page.dart';
import '../settings/usage_page.dart';
import '../theme/blobs.dart';
import '../theme/tokens.dart';
import '../workspace/console_account.dart';
import '../workspace/workspace_page.dart';

/// Inbox shell: conversations, account sheet, create-bot, search, and tools.
class HomePage extends StatefulWidget {
  const HomePage({
    super.key,
    required this.auth,
    this.push,
    this.phonePoller,
    required this.prefs,
    this.consoleAccount,
  });
  final AuthState auth;

  /// Push controller for the Notifications section; null in previews.
  final PushController? push;

  /// Phone-apps job poller; null in previews.
  final PhoneJobPoller? phonePoller;

  /// On-phone preferences (appearance, haptics, ...).
  final AppPreferences prefs;

  /// Control-plane account for the active server; null in previews.
  final ConsoleAccount? consoleAccount;

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  List<BotSummary> _bots = const [];
  List<GroupSummary> _groups = const [];
  bool _loading = true;
  String? _error;
  final _search = TextEditingController();
  late String _sessionKey;

  String get _currentSessionKey =>
      '${widget.auth.active?.id ?? ''}:${widget.auth.client.sessionToken ?? ''}:${widget.auth.scopes.join(',')}';

  @override
  void initState() {
    super.initState();
    _sessionKey = _currentSessionKey;
    widget.auth.addListener(_onAuth);
    _search.addListener(() {
      if (mounted) setState(() {});
    });
    _load();
  }

  void _onAuth() {
    if (widget.auth.needsSignIn) return;
    final next = _currentSessionKey;
    if (next == _sessionKey) return;
    _sessionKey = next;
    _load();
  }

  @override
  void dispose() {
    widget.auth.removeListener(_onAuth);
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    if (widget.auth.needsSignIn) return;
    final server = widget.auth.active;
    final baseUrl = server?.baseUrl;
    if (server == null || baseUrl == null) {
      setState(() {
        _bots = const [];
        _loading = false;
      });
      return;
    }
    final cache = widget.auth.cache;
    setState(() {
      _loading = true;
      _error = null;
    });
    // Cached bots render instantly; the network refresh follows.
    if (cache != null) {
      final cached = await cache.readBots(server.id);
      if (cached != null && mounted) {
        setState(() {
          _bots = cached;
          _loading = false;
        });
      }
    }
    try {
      final bots = await widget.auth.client.bots(baseUrl);
      await cache?.writeBots(server.id, bots);
      if (mounted) setState(() => _bots = bots);
      try {
        final groups = await widget.auth.client.groups(baseUrl);
        await cache?.writeGroups(server.id, groups);
        if (mounted) setState(() => _groups = groups);
      } on ApiError {
        // Rooms are optional; the inbox still lists bots.
      }
      // Background prefetch so thread opens are instant after restart.
      if (cache != null) {
        unawaited(_prefetch(cache, server.id, baseUrl, bots));
      }
    } on ApiError catch (error) {
      if (error.unauthorized) {
        await widget.auth.sessionEnded();
        return;
      }
      if (_bots.isEmpty && mounted) {
        setState(() => _error = error.message);
      }
    } finally {
      if (mounted) setState(() => _loading = false);
      // A saved server is not an account. The plan list waits until this visit has signed in.
      if (mounted && widget.auth.scopes.isNotEmpty) {
        unawaited(askToSubscribe(context, widget.auth.client, baseUrl: baseUrl, timeZone: widget.prefs.timeZone));
      }
    }
  }

  Future<void> _prefetch(
    ThreadCache cache,
    String serverId,
    String baseUrl,
    List<BotSummary> bots,
  ) async {
    try {
      final groups = await widget.auth.client.groups(baseUrl);
      await cache.writeGroups(serverId, groups);
      await cache.prefetchRecent(
        widget.auth.client,
        baseUrl,
        serverId,
        bots,
        groups,
      );
    } catch (_) {
      // Prefetch never fails the home screen.
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Column(
          children: [
            _InboxHeader(
              initial: _initial(widget.auth.active?.name),
              onAccount: _openYou,
              onCreate: _createBot,
            ),
            Expanded(child: _body()),
            _InboxDock(controller: _search, onApps: _openApps),
          ],
        ),
      ),
    );
  }

  Widget _body() {
    if (_loading && _bots.isEmpty && _error == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null || widget.auth.active?.baseUrl == null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.cloud_off_outlined, size: 48),
              const SizedBox(height: 12),
              Text(_error ?? 'No server selected.'),
              const SizedBox(height: 12),
              FilledButton(onPressed: _load, child: const Text('Retry')),
            ],
          ),
        ),
      );
    }
    final query = _search.text.trim().toLowerCase();
    final rows = [
      for (final row in _rows())
        if (query.isEmpty ||
            row.title.toLowerCase().contains(query) ||
            row.preview.toLowerCase().contains(query))
          row,
    ];
    if (rows.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                query.isEmpty ? 'No agents yet.' : 'Nothing matches.',
                style: const TextStyle(color: Color(0xFF8E8E93)),
              ),
              if (query.isEmpty) ...[
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: _createBot,
                  child: const Text('Add an agent'),
                ),
              ],
            ],
          ),
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.builder(
        padding: const EdgeInsets.only(top: 8),
        itemCount: rows.length,
        itemBuilder: (context, index) => _InboxRow(row: rows[index]),
      ),
    );
  }

  List<_InboxItem> _rows() {
    final items = <_InboxItem>[
      for (final bot in _bots) _botRow(bot),
      for (final group in _groups) _groupRow(group),
    ];
    items.sort((a, b) => b.sortAt.compareTo(a.sortAt));
    return items;
  }

  _InboxItem _botRow(BotSummary bot) {
    ThreadSummary? latest;
    for (final task in bot.tasks) {
      if (task.archived) continue;
      final at = task.updatedAt ?? task.createdAt;
      final latestAt = latest == null
          ? -1
          : (latest.updatedAt ?? latest.createdAt);
      if (at >= latestAt) latest = task;
    }
    final preview = latest?.title ??
        (bot.description.isEmpty ? bot.title : bot.description);
    return _InboxItem(
      title: bot.name.isEmpty ? 'Bot' : bot.name,
      preview: preview,
      color: bot.color,
      seed: bot.id,
      sortAt: latest?.updatedAt ?? latest?.createdAt ?? 0,
      unread: bot.unread,
      onTap: () => _openBot(bot, latest),
    );
  }

  _InboxItem _groupRow(GroupSummary group) {
    return _InboxItem(
      title: group.name,
      preview: '${group.memberIds.length} members',
      color: 'blue',
      seed: group.id,
      shape: 'squircle',
      sortAt: 0,
      unread: false,
      onTap: () {
        final baseUrl = widget.auth.active?.baseUrl;
        if (baseUrl == null) return;
        Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => GroupThreadPage(
              auth: widget.auth,
              baseUrl: baseUrl,
              group: group,
            ),
          ),
        );
      },
    );
  }

  void _openBot(BotSummary bot, ThreadSummary? latest) {
    final baseUrl = widget.auth.active?.baseUrl;
    if (baseUrl == null) return;
    final thread = latest ??
        ThreadSummary(
          threadId: bot.mainThreadId ?? bot.threadId,
          title: bot.name,
          createdAt: 0,
        );
    if (thread.threadId.isEmpty) return;
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => ThreadPage(
          client: widget.auth.client,
          baseUrl: baseUrl,
          bot: bot,
          thread: thread,
          botNames: [for (final item in _bots) item.name],
          cache: widget.auth.cache,
          serverId: widget.auth.active?.id,
        ),
      ),
    );
  }

  Future<void> _createBot() async {
    final baseUrl = widget.auth.active?.baseUrl;
    if (baseUrl == null) return;
    final created = await showCreateBotSheet(
      context: context,
      client: widget.auth.client,
      baseUrl: baseUrl,
    );
    if (created) await _load();
  }

  void _openYou() {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _YouTab(
        auth: widget.auth,
        bots: _bots,
        push: widget.push,
        phonePoller: widget.phonePoller,
        prefs: widget.prefs,
        consoleAccount: widget.consoleAccount,
        onBotsChanged: _load,
      ),
    );
  }

  void _openApps() {
    final baseUrl = widget.auth.active?.baseUrl;
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.white,
      builder: (sheet) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(8, 4, 8, 8),
              child: Text(
                'Menu',
                style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
              ),
            ),
            Material(
              color: const Color(0xFFF2F2F7),
              borderRadius: BorderRadius.circular(16),
              clipBehavior: Clip.antiAlias,
              child: Column(
                children: [
            ListTile(
              leading: const Icon(Icons.smart_toy_outlined),
              title: const Text('Bots & rooms'),
              subtitle: const Text('Directory, new group, profiles'),
              onTap: () {
                Navigator.of(sheet).pop();
                Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => BotsTab(
                      auth: widget.auth,
                      bots: _bots,
                      onRefresh: _load,
                    ),
                  ),
                );
              },
            ),
            if (baseUrl != null)
              ListTile(
                leading: const Icon(Icons.schedule_outlined),
                title: const Text('Routines'),
                onTap: () {
                  Navigator.of(sheet).pop();
                  Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => RoutinesPage(
                        auth: widget.auth,
                        baseUrl: baseUrl,
                        bots: _bots,
                      ),
                    ),
                  );
                },
              ),
            if (baseUrl != null)
              ListTile(
                leading: const Icon(Icons.travel_explore_outlined),
                title: const Text('Search messages'),
                onTap: () {
                  Navigator.of(sheet).pop();
                  Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => SearchPage(
                        client: widget.auth.client,
                        baseUrl: baseUrl,
                      ),
                    ),
                  );
                },
              ),
            if (baseUrl != null && widget.phonePoller != null)
              ListTile(
                leading: const Icon(Icons.phone_android_outlined),
                title: const Text('Phone apps'),
                subtitle: const Text('Calendar, contacts, location'),
                onTap: () {
                  Navigator.of(sheet).pop();
                  Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => PhonesPage(
                        auth: widget.auth,
                        baseUrl: baseUrl,
                        poller: widget.phonePoller!,
                        gate: SystemCapabilityGate(),
                      ),
                    ),
                  );
                },
              ),
            if (baseUrl != null && widget.consoleAccount != null)
              ListTile(
                leading: const Icon(Icons.account_balance_outlined),
                title: const Text('Workspace'),
                subtitle: const Text('Seats, spend, and providers'),
                onTap: () {
                  Navigator.of(sheet).pop();
                  Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => WorkspacePage(
                        account: widget.consoleAccount!,
                        baseUrl: baseUrl,
                        prefs: widget.prefs,
                      ),
                    ),
                  );
                },
              ),
            if (baseUrl != null)
              ListTile(
                leading: const Icon(Icons.settings_outlined),
                title: const Text('Settings'),
                onTap: () {
                  Navigator.of(sheet).pop();
                  Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => SettingsPage(
                        auth: widget.auth,
                        baseUrl: baseUrl,
                        serverName: widget.auth.active?.name ?? 'Maximus',
                        bots: _bots,
                        prefs: widget.prefs,
                      ),
                    ),
                  );
                },
              ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _InboxHeader extends StatelessWidget {
  const _InboxHeader({
    required this.initial,
    required this.onAccount,
    required this.onCreate,
  });

  final String initial;
  final VoidCallback onAccount;
  final VoidCallback onCreate;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 6, 16, 4),
      child: Row(
        children: [
          _HeaderButton(onPressed: onAccount, child: _AccountMark(initial: initial)),
          const Spacer(),
          Semantics(
            button: true,
            label: 'Add an agent',
            child: _HeaderButton(
              onPressed: onCreate,
              child: const Icon(Icons.add, size: 22),
            ),
          ),
        ],
      ),
    );
  }
}

class _HeaderButton extends StatelessWidget {
  const _HeaderButton({required this.onPressed, required this.child});

  final VoidCallback onPressed;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFFF2F2F7),
      shape: const CircleBorder(),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onPressed,
        child: SizedBox.square(
          dimension: 40,
          child: Center(child: child),
        ),
      ),
    );
  }
}

class _AccountMark extends StatelessWidget {
  const _AccountMark({required this.initial});
  final String initial;

  @override
  Widget build(BuildContext context) {
    return SizedBox.square(
      dimension: 28,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Container(
            alignment: Alignment.center,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(color: const Color(0xFFE5E5EA)),
            ),
            child: Text(
              initial,
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
            ),
          ),
          const Positioned(
            right: -1,
            bottom: -1,
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: Color(0xFF0A84FF),
                shape: BoxShape.circle,
              ),
              child: SizedBox.square(dimension: 8),
            ),
          ),
        ],
      ),
    );
  }
}

class _InboxDock extends StatelessWidget {
  const _InboxDock({required this.controller, required this.onApps});

  final TextEditingController controller;
  final VoidCallback onApps;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 6, 16, 8),
      child: Row(
        children: [
          Material(
            color: const Color(0xFFF2F2F7),
            borderRadius: BorderRadius.circular(14),
            child: InkWell(
              borderRadius: BorderRadius.circular(14),
              onTap: onApps,
              child: const SizedBox(
                width: 44,
                height: 44,
                child: Icon(Icons.grid_view_rounded, size: 20),
              ),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: TextField(
              controller: controller,
              decoration: InputDecoration(
                hintText: 'Search',
                prefixIcon: const Icon(Icons.search, size: 20),
                filled: true,
                fillColor: const Color(0xFFF2F2F7),
                isDense: true,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(22),
                  borderSide: BorderSide.none,
                ),
                contentPadding: const EdgeInsets.symmetric(vertical: 12),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _InboxItem {
  const _InboxItem({
    required this.title,
    required this.preview,
    required this.color,
    required this.seed,
    required this.sortAt,
    required this.unread,
    required this.onTap,
    this.shape,
  });

  final String title;
  final String preview;
  final String color;
  final String seed;
  final String? shape;
  final int sortAt;
  final bool unread;
  final VoidCallback onTap;
}

class _InboxRow extends StatelessWidget {
  const _InboxRow({required this.row});
  final _InboxItem row;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: row.onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        child: Row(
          children: [
            BotBlob(color: row.color, seed: row.seed, shape: row.shape, size: 52),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    row.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w700,
                      letterSpacing: -0.2,
                    ),
                  ),
                  if (row.preview.isNotEmpty)
                    Text(
                      row.preview,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 15,
                        color: Color(0xFF8E8E93),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  _clock(row.sortAt),
                  style: const TextStyle(fontSize: 13, color: Color(0xFF8E8E93)),
                ),
                const SizedBox(height: 6),
                if (row.unread)
                  const DecoratedBox(
                    decoration: BoxDecoration(
                      color: Color(0xFF0A84FF),
                      shape: BoxShape.circle,
                    ),
                    child: SizedBox.square(dimension: 10),
                  )
                else
                  const SizedBox.square(dimension: 10),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

String _initial(String? name) {
  final trimmed = (name ?? '').trim();
  if (trimmed.isEmpty) return 'M';
  return trimmed[0].toUpperCase();
}

String _clock(int ms) {
  if (ms <= 0) return '';
  final dt = DateTime.fromMillisecondsSinceEpoch(ms);
  final hour = dt.hour % 12 == 0 ? 12 : dt.hour % 12;
  final minute = dt.minute.toString().padLeft(2, '0');
  final suffix = dt.hour >= 12 ? 'PM' : 'AM';
  final now = DateTime.now();
  final sameDay =
      dt.year == now.year && dt.month == now.month && dt.day == now.day;
  if (sameDay) return '$hour:$minute $suffix';
  return '${dt.month}/${dt.day}';
}

/// Account tab: server switcher, pairing, sign-out. Full settings in Phase 7.
class _YouTab extends StatefulWidget {
  const _YouTab({
    required this.auth,
    required this.bots,
    required this.push,
    required this.phonePoller,
    required this.prefs,
    required this.consoleAccount,
    required this.onBotsChanged,
  });

  final AuthState auth;
  final List<BotSummary> bots;
  final PushController? push;
  final PhoneJobPoller? phonePoller;
  final AppPreferences prefs;
  final ConsoleAccount? consoleAccount;
  final Future<void> Function() onBotsChanged;

  @override
  State<_YouTab> createState() => _YouTabState();
}

class _YouTabState extends State<_YouTab> {
  /// Per-bot notification overrides flipped this session (bot id → on).
  final Map<String, bool> _muted = {};

  bool _botOn(BotSummary bot) => _muted[bot.id] ?? bot.notifications;

  Future<void> _flipBot(BotSummary bot, bool on) async {
    final baseUrl = widget.auth.active?.baseUrl;
    if (baseUrl == null) return;
    setState(() => _muted[bot.id] = on);
    try {
      await widget.auth.client.patchBot(baseUrl, bot.id, {'notifications': on});
      await widget.onBotsChanged();
    } on ApiError catch (error) {
      if (mounted) {
        setState(() => _muted.remove(bot.id));
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.message)));
      }
    }
  }

  Future<void> _pickBotForBrowser(
    BuildContext context,
    AuthState auth,
    ServerRef active,
  ) async {
    if (widget.bots.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Add a bot first.')),
      );
      return;
    }
    final bot = await showModalBottomSheet<BotSummary>(
      context: context,
      builder: (sheet) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(8, 4, 8, 8),
              child: Text(
                'Whose browser?',
                style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
              ),
            ),
            Material(
              color: const Color(0xFFF2F2F7),
              borderRadius: BorderRadius.circular(16),
              clipBehavior: Clip.antiAlias,
              child: Column(
                children: [
                  for (final candidate in widget.bots)
                    ListTile(
                      leading: const Icon(Icons.smart_toy_outlined),
                      title: Text(candidate.name),
                      onTap: () => Navigator.of(sheet).pop(candidate),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
    if (bot == null || !context.mounted) return;
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => ComputerPage(
          client: auth.client,
          baseUrl: active.baseUrl,
          bot: bot,
          thread: ThreadSummary(
            threadId: bot.threadId,
            title: bot.name,
            createdAt: 0,
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = widget.auth;
    final active = auth.active;
    final height = MediaQuery.sizeOf(context).height * 0.94;
    return Align(
      alignment: Alignment.bottomCenter,
      child: Container(
        height: height,
        decoration: const BoxDecoration(
          color: Color(0xFFF2F2F7),
          borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        ),
        child: ListenableBuilder(
          listenable: widget.prefs,
          builder: (context, _) => Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: Material(
                    color: Colors.white,
                    shape: const CircleBorder(),
                    child: InkWell(
                      customBorder: const CircleBorder(),
                      onTap: () => Navigator.of(context).pop(),
                      child: const SizedBox.square(
                        dimension: 36,
                        child: Icon(Icons.close, size: 18),
                      ),
                    ),
                  ),
                ),
              ),
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 28),
                  children: [
                    _sheetCard(children: [
                      _sheetRow(
                        title: active?.name ?? 'No server',
                        subtitle: active == null
                            ? 'Sign in to begin.'
                            : active.baseUrl,
                        leading: _AccountMark(initial: _initial(active?.name)),
                        onTap: active == null
                            ? null
                            : () => _push(AccountPage(
                                auth: auth,
                                baseUrl: active.baseUrl,
                                serverName: active.name,
                              )),
                      ),
                      if (active != null)
                        _sheetRow(
                          title: auth.scopes.isEmpty ? 'Sign in' : 'Sign out',
                          onTap: auth.scopes.isEmpty
                              ? () => openSignIn(
                                  context,
                                  auth,
                                  baseUrl: active.baseUrl,
                                )
                              : () => signOutOfActiveServer(context, auth),
                        ),
                      if (active != null)
                        _sheetRow(
                          title: 'Subscribe',
                          onTap: () => askToSubscribe(
                            context,
                            auth.client,
                            force: true,
                            baseUrl: active.baseUrl,
                            timeZone: widget.prefs.timeZone,
                          ),
                        ),
                      if (active != null)
                        _sheetRow(
                          title: 'Usage',
                          onTap: () => _push(UsagePage(
                            client: auth.client,
                            baseUrl: active.baseUrl,
                            auth: auth,
                          )),
                        ),
                      _sheetRow(
                        title: 'Subscription',
                        onTap: active == null
                            ? null
                            : () => widget.consoleAccount == null
                                ? _push(SettingsPage(
                                    auth: auth,
                                    baseUrl: active.baseUrl,
                                    serverName: active.name,
                                    bots: widget.bots,
                                    prefs: widget.prefs,
                                  ))
                                : _push(WorkspacePage(
                                    account: widget.consoleAccount!,
                                    baseUrl: active.baseUrl,
                                    prefs: widget.prefs,
                                  )),
                      ),
                      _sheetRow(
                        title: 'Vault',
                        subtitle: 'Logins and contact info bots can ask to use',
                        onTap: () => _openVault(context),
                      ),
                    ]),
                    const SizedBox(height: 12),
                    _sheetCard(children: [
                      _sheetRow(
                        title: 'Connect apps',
                        subtitle: 'Phone tools, and the apps this server already has',
                        onTap: active == null || widget.phonePoller == null
                            ? null
                            : () => _push(PhonesPage(
                                auth: auth,
                                baseUrl: active.baseUrl,
                                poller: widget.phonePoller!,
                                gate: SystemCapabilityGate(),
                              )),
                      ),
                    ]),
                    const SizedBox(height: 18),
                    const Padding(
                      padding: EdgeInsets.only(left: 8, bottom: 8),
                      child: Text(
                        'Bot',
                        style: TextStyle(
                          fontSize: 13,
                          color: Color(0xFF8E8E93),
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    _sheetCard(children: [
                      _sheetRow(
                        title: 'Add an agent',
                        subtitle: 'Name one and it shows up in your chats',
                        onTap: active == null
                            ? null
                            : () async {
                                final created = await showCreateBotSheet(
                                  context: context,
                                  client: auth.client,
                                  baseUrl: active.baseUrl,
                                );
                                if (created) await widget.onBotsChanged();
                              },
                      ),
                      _sheetRow(
                        title: 'Permissions',
                        onTap: () => _openPermissions(context),
                      ),
                      SwitchListTile(
                        contentPadding: const EdgeInsets.symmetric(horizontal: 16),
                        title: const Text('Set time zone automatically'),
                        subtitle: const Text(
                          "Your bot's computer follows this device's time zone.",
                        ),
                        value: widget.prefs.timeZone == null,
                        onChanged: active == null
                            ? null
                            : (on) => _setAutoZone(active.baseUrl, on),
                      ),
                      _sheetRow(
                        title: 'Time zone',
                        trailing: widget.prefs.timeZone ??
                            DateTime.now().timeZoneName,
                        onTap: active == null
                            ? null
                            : () => _pickZone(context, active.baseUrl),
                      ),
                      if (active != null)
                        _sheetRow(
                          title: 'Bot computer',
                          onTap: () => _push(BotComputerPage(
                            client: auth.client,
                            baseUrl: active.baseUrl,
                            bots: widget.bots,
                          )),
                        ),
                      if (active != null)
                        _sheetRow(
                          title: 'Manage your devices',
                          onTap: () => _push(DevicesPage(
                            client: auth.client,
                            baseUrl: active.baseUrl,
                          )),
                        ),
                    ]),
                    const SizedBox(height: 18),
                    const Padding(
                      padding: EdgeInsets.only(left: 8, bottom: 8),
                      child: Text(
                        'More',
                        style: TextStyle(
                          fontSize: 13,
                          color: Color(0xFF8E8E93),
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    _sheetCard(children: [
                      _PushPhoneRow(push: widget.push),
                      _PushGlobalRow(auth: auth),
                      for (final bot in widget.bots)
                        SwitchListTile(
                          contentPadding:
                              const EdgeInsets.symmetric(horizontal: 16),
                          title: Text(bot.name),
                          subtitle: Text(
                            _botOn(bot)
                                ? 'This phone buzzes for ${bot.name}'
                                : 'Muted on this phone',
                          ),
                          value: _botOn(bot),
                          onChanged: (on) => _flipBot(bot, on),
                        ),
                      if (active != null)
                        _sheetRow(
                          title: 'Routines',
                          onTap: () => _push(RoutinesPage(
                            auth: auth,
                            baseUrl: active.baseUrl,
                            bots: widget.bots,
                          )),
                        ),
                      if (active != null)
                        _sheetRow(
                          title: 'Watch a browser',
                          subtitle: 'Take over for passwords and 2FA',
                          onTap: () => _pickBotForBrowser(context, auth, active),
                        ),
                      _sheetRow(
                        title: 'Pair another server',
                        onTap: () => _push(PairPage(auth: auth)),
                      ),
                      if (active != null)
                        _sheetRow(
                          title: 'Settings',
                          onTap: () => _push(SettingsPage(
                            auth: auth,
                            baseUrl: active.baseUrl,
                            serverName: active.name,
                            bots: widget.bots,
                            prefs: widget.prefs,
                          )),
                        ),
                      _sheetRow(
                        title: 'Remove this server',
                        onTap: active == null
                            ? null
                            : () => auth.removeServer(active.id),
                      ),
                    ]),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _push(Widget page) {
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => page));
  }

  Future<void> _setAutoZone(String baseUrl, bool automatic) async {
    await widget.prefs.setTimeZone(automatic ? null : 'UTC');
    try {
      await widget.auth.client.presenceActive(
        baseUrl,
        timeZone: widget.prefs.timeZone ?? DateTime.now().timeZoneName,
        language: widget.prefs.language,
      );
    } on ApiError {
      // The next foreground report retries.
    }
  }

  Future<void> _pickZone(BuildContext context, String baseUrl) async {
    const zones = [
      'UTC',
      'Africa/Lagos',
      'Europe/London',
      'America/New_York',
      'America/Los_Angeles',
      'Asia/Tokyo',
    ];
    final picked = await showModalBottomSheet<String>(
      context: context,
      builder: (sheet) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(8, 4, 8, 8),
              child: Text(
                'Time zone',
                style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
              ),
            ),
            Material(
              color: const Color(0xFFF2F2F7),
              borderRadius: BorderRadius.circular(16),
              clipBehavior: Clip.antiAlias,
              child: Column(
                children: [
                  for (final zone in zones)
                    ListTile(
                      title: Text(zone),
                      trailing: widget.prefs.timeZone == zone
                          ? const Icon(Icons.check, color: MaxTokens.ember)
                          : null,
                      onTap: () => Navigator.of(sheet).pop(zone),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
    if (picked == null) return;
    await widget.prefs.setTimeZone(picked);
    try {
      await widget.auth.client.presenceActive(
        baseUrl,
        timeZone: picked,
        language: widget.prefs.language,
      );
    } on ApiError {
      // Best-effort.
    }
  }

  Future<void> _openPermissions(BuildContext context) async {
    final baseUrl = widget.auth.active?.baseUrl;
    if (baseUrl == null || widget.bots.isEmpty) return;
    final bot = await showModalBottomSheet<BotSummary>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (sheet) => _PermissionSheet(bots: widget.bots),
    );
    if (bot == null || !context.mounted) return;
    _push(BotSettingsPage(
      client: widget.auth.client,
      baseUrl: baseUrl,
      bot: bot,
    ));
  }

  void _openVault(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (sheet) => _VaultSheet(
        onPermissions: () {
          Navigator.of(sheet).pop();
          _openPermissions(context);
        },
      ),
    );
  }

  Widget _sheetCard({required List<Widget> children}) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(16),
      clipBehavior: Clip.antiAlias,
      child: Column(children: children),
    );
  }

  Widget _sheetRow({
    required String title,
    String? subtitle,
    Widget? leading,
    String? trailing,
    VoidCallback? onTap,
  }) {
    return ListTile(
      leading: leading,
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: subtitle == null ? null : Text(subtitle),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (trailing != null)
            Text(trailing, style: const TextStyle(color: Color(0xFF8E8E93))),
          const Icon(Icons.chevron_right, color: Color(0xFFC7C7CC)),
        ],
      ),
      onTap: onTap,
    );
  }
}

class _VaultSheet extends StatelessWidget {
  const _VaultSheet({required this.onPermissions});

  final VoidCallback onPermissions;

  @override
  Widget build(BuildContext context) {
    return _PopupSheet(
      title: 'Vault',
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const _PopupMark(icon: Icons.lock_outline),
          const SizedBox(height: 8),
          const Text(
            'Logins stay on this server. A bot asks before it uses one, and you answer in the chat.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 15, height: 1.35, color: Color(0xFF3A3A3C)),
          ),
          const SizedBox(height: 18),
          const _PopupGroup(children: [
            _PopupFact(
              icon: Icons.dns_outlined,
              title: 'Kept on the server',
              detail: 'Nothing is stored on this phone.',
            ),
            _PopupFact(
              icon: Icons.front_hand_outlined,
              title: 'Asks first',
              detail: 'A bot cannot use a login on its own.',
            ),
            _PopupFact(
              icon: Icons.chat_bubble_outline,
              title: 'You answer in chat',
              detail: 'Allow it once, or keep it for later.',
            ),
          ]),
          const SizedBox(height: 18),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              style: FilledButton.styleFrom(
                backgroundColor: MaxTokens.ember,
                foregroundColor: Colors.white,
                shape: const StadiumBorder(),
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
              onPressed: onPermissions,
              child: const Text('Bot permissions'),
            ),
          ),
        ],
      ),
    );
  }
}

class _PermissionSheet extends StatelessWidget {
  const _PermissionSheet({required this.bots});

  final List<BotSummary> bots;

  String _mode(String? mode) => switch (mode) {
    'ask' => 'Asks before every step',
    'edits' => 'Edits freely, asks for the rest',
    'auto' => 'Reviews its own steps',
    'custom' => 'A custom permission set',
    _ => 'Full access',
  };

  @override
  Widget build(BuildContext context) {
    return _PopupSheet(
      title: 'Permissions',
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Choose a bot. This sets how often it has to ask.',
            style: TextStyle(fontSize: 15, color: Color(0xFF8E8E93)),
          ),
          const SizedBox(height: 14),
          _PopupGroup(
            children: [
              for (final bot in bots)
                ListTile(
                  leading: BotBlob(
                    color: bot.color,
                    seed: bot.id,
                    size: 36,
                  ),
                  title: Text(
                    bot.name,
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  subtitle: Text(_mode(bot.approvalMode)),
                  trailing: const Icon(Icons.chevron_right, color: Color(0xFFC7C7CC)),
                  onTap: () => Navigator.of(context).pop(bot),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _PopupSheet extends StatelessWidget {
  const _PopupSheet({required this.title, required this.child});

  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.bottomCenter,
      child: Container(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(context).height * 0.86,
        ),
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        ),
        child: SafeArea(
          top: false,
          child: ListView(
            shrinkWrap: true,
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 16),
            children: [
              Row(
                children: [
                  _PopupClose(onPressed: () => Navigator.of(context).pop()),
                  Expanded(
                    child: Text(
                      title,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  const SizedBox(width: 36),
                ],
              ),
              const SizedBox(height: 18),
              child,
            ],
          ),
        ),
      ),
    );
  }
}

class _PopupClose extends StatelessWidget {
  const _PopupClose({required this.onPressed});

  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFFF2F2F7),
      shape: const CircleBorder(),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onPressed,
        child: const SizedBox.square(
          dimension: 36,
          child: Icon(Icons.close, size: 18),
        ),
      ),
    );
  }
}

class _PopupMark extends StatelessWidget {
  const _PopupMark({required this.icon});

  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 72,
      height: 72,
      decoration: const BoxDecoration(
        color: Color(0xFFF2F2F7),
        shape: BoxShape.circle,
      ),
      child: Icon(icon, size: 32, color: const Color(0xFF1C1C1E)),
    );
  }
}

class _PopupGroup extends StatelessWidget {
  const _PopupGroup({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFFF2F2F7),
      borderRadius: BorderRadius.circular(16),
      clipBehavior: Clip.antiAlias,
      child: Column(children: children),
    );
  }
}

class _PopupFact extends StatelessWidget {
  const _PopupFact({
    required this.icon,
    required this.title,
    required this.detail,
  });

  final IconData icon;
  final String title;
  final String detail;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(icon, color: const Color(0xFF1C1C1E)),
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text(detail),
    );
  }
}

/// This phone's push state: an Enable row until permission is granted,
/// then a quiet status line naming the registered phone.
class _PushPhoneRow extends StatelessWidget {
  const _PushPhoneRow({required this.push});
  final PushController? push;

  @override
  Widget build(BuildContext context) {
    final controller = push;
    if (controller == null) return const SizedBox.shrink();
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) {
        switch (controller.state) {
          case PushState.prompt:
            return ListTile(
              leading: const Icon(Icons.notifications_active_outlined),
              title: const Text('Turn on push'),
              subtitle: const Text('Approvals and mentions find this phone'),
              trailing: const Icon(Icons.chevron_right),
              onTap: controller.enable,
            );
          case PushState.on:
          case PushState.off:
            return ListTile(
              leading: const Icon(Icons.phone_android_outlined),
              title: const Text('This phone'),
              subtitle: Text(
                controller.fingerprint == null
                    ? 'Registered for push'
                    : 'Registered for push ···${controller.fingerprint}',
              ),
            );
          case PushState.denied:
            return const ListTile(
              leading: Icon(Icons.notifications_off_outlined),
              title: Text('Push denied'),
              subtitle: Text('Allow notifications in Settings to turn it on'),
            );
          case PushState.unavailable:
            return const ListTile(
              leading: Icon(Icons.cloud_off_outlined),
              title: Text('Push unavailable'),
              subtitle: Text('The server has no push credentials yet'),
            );
          case PushState.idle:
            return const SizedBox.shrink();
        }
      },
    );
  }
}

/// The server's global push switch (owners flip it; paired members see it).
class _PushGlobalRow extends StatefulWidget {
  const _PushGlobalRow({required this.auth});
  final AuthState auth;

  @override
  State<_PushGlobalRow> createState() => _PushGlobalRowState();
}

class _PushGlobalRowState extends State<_PushGlobalRow> {
  bool? _enabled;
  bool? _configured;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final baseUrl = widget.auth.active?.baseUrl;
    if (baseUrl == null) return;
    try {
      final status = await widget.auth.client.pushStatus(baseUrl);
      if (mounted) {
        setState(() {
          _enabled = status.enabled;
          _configured = status.configured;
        });
      }
    } on ApiError {
      // Chat-only members cannot read push status; the row stays hidden.
    }
  }

  Future<void> _flip(bool on) async {
    final baseUrl = widget.auth.active?.baseUrl;
    if (baseUrl == null) return;
    setState(() => _enabled = on);
    try {
      final next = await widget.auth.client.setPushEnabled(baseUrl, on);
      if (mounted) setState(() => _enabled = next);
    } on ApiError catch (error) {
      if (mounted) {
        setState(() => _enabled = !on);
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.message)));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_enabled == null) return const SizedBox.shrink();
    return SwitchListTile(
      secondary: const Icon(Icons.notifications_outlined),
      title: const Text('Push notifications'),
      subtitle: Text(
        _configured == false
            ? 'Not set up on this server yet'
            : _enabled!
            ? 'On for every bot'
            : 'Paused for every bot',
      ),
      value: _enabled!,
      onChanged: widget.auth.isAdmin ? _flip : null,
    );
  }
}
