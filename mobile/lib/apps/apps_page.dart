import 'dart:async';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../auth/auth_state.dart';

/// Marketplace of third-party apps and per-bot MCP switches.
///
/// Connect / disconnect uses `/api/connectors/*` (allowed on the phone
/// companion). Adding MCP server commands stays on the computer; this page
/// only toggles which existing servers a bot may use.
class AppsPage extends StatefulWidget {
  const AppsPage({
    super.key,
    required this.auth,
    required this.baseUrl,
    required this.bots,
  });

  final AuthState auth;
  final String baseUrl;
  final List<BotSummary> bots;

  @override
  State<AppsPage> createState() => _AppsPageState();
}

class _AppsPageState extends State<AppsPage> {
  ConnectorCatalog? _catalog;
  Map<String, ConnectorLink> _links = const {};
  bool _loading = true;
  String? _error;
  String _search = '';
  String? _category;
  String? _busySlug;
  String? _mcpBotId;
  List<BotMcpServer> _mcpServers = const [];
  bool _mcpLoading = false;
  String? _mcpError;
  MaximusApi get _client => widget.auth.client;

  List<BotSummary> get _visibleBots => [
        for (final bot in widget.bots)
          if (!bot.defaultBot || bot.name.isNotEmpty) bot,
      ];

  int get _connectedCount => _links.values.where((link) => link.hasActiveAccount).length;

  @override
  void initState() {
    super.initState();
    _mcpBotId = _visibleBots.isEmpty ? null : _visibleBots.first.id;
    unawaited(_reload());
  }

  Future<void> _reload() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final catalog = await _client.connectorCatalog(widget.baseUrl);
      final links = catalog.configured
          ? await _client.connectorConnections(widget.baseUrl)
          : const <String, ConnectorLink>{};
      if (!mounted) return;
      setState(() {
        _catalog = catalog;
        _links = links;
        _loading = false;
      });
      if (_mcpBotId != null) unawaited(_loadMcp(_mcpBotId!));
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = '$error';
        _loading = false;
      });
    }
  }

  Future<void> _loadMcp(String botId) async {
    setState(() {
      _mcpLoading = true;
      _mcpError = null;
      _mcpBotId = botId;
    });
    try {
      final servers = await _client.botMcpServers(widget.baseUrl, botId);
      if (!mounted) return;
      setState(() {
        _mcpServers = servers;
        _mcpLoading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _mcpServers = const [];
        _mcpError = '$error';
        _mcpLoading = false;
      });
    }
  }

  List<String> get _categories {
    final counts = <String, int>{};
    for (final card in _catalog?.cards ?? const <ConnectorToolkit>[]) {
      for (final category in card.categories.toSet()) {
        counts[category] = (counts[category] ?? 0) + 1;
      }
    }
    final ranked = counts.entries.toList()
      ..sort((a, b) => b.value != a.value ? b.value.compareTo(a.value) : a.key.compareTo(b.key));
    return [for (final entry in ranked) entry.key];
  }

  List<ConnectorToolkit> get _filtered {
    final query = _search.trim().toLowerCase();
    return [
      for (final card in _catalog?.cards ?? const <ConnectorToolkit>[])
        if ((_category == null || card.categories.contains(_category)) &&
            (query.isEmpty ||
                card.label.toLowerCase().contains(query) ||
                card.blurb.toLowerCase().contains(query) ||
                card.slug.toLowerCase().contains(query)))
          card,
    ];
  }

  Future<void> _connect(ConnectorToolkit card) async {
    setState(() => _busySlug = card.slug);
    try {
      final url = await _client.connectorAuthorize(widget.baseUrl, card.slug);
      final uri = Uri.tryParse(url);
      if (uri == null || !(await canLaunchUrl(uri))) {
        throw ApiError(200, 'Could not open the sign-in page');
      }
      await launchUrl(uri, mode: LaunchMode.externalApplication);
      for (var attempt = 0; attempt < 15; attempt += 1) {
        await Future<void>.delayed(const Duration(seconds: 2));
        if (!mounted) return;
        final links = await _client.connectorConnections(widget.baseUrl);
        final link = links[card.slug];
        if (link != null && link.hasActiveAccount) {
          setState(() => _links = links);
          break;
        }
        if (attempt == 14) setState(() => _links = links);
      }
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('$error')),
      );
    } finally {
      if (mounted) setState(() => _busySlug = null);
    }
  }

  Future<void> _disconnect(ConnectorToolkit card, ConnectorLink link) async {
    ConnectorAccount? account;
    for (final item in link.accounts) {
      if (item.active) {
        account = item;
        break;
      }
    }
    account ??= link.accounts.isEmpty ? null : link.accounts.first;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialog) => AlertDialog(
        title: Text('Disconnect ${card.label}?'),
        content: Text(
          account?.alias == null
              ? 'Bots will lose access to this app until you connect it again.'
              : 'Remove “${account!.alias}” from ${card.label}?',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialog, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(dialog, true), child: const Text('Disconnect')),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _busySlug = card.slug);
    try {
      await _client.connectorDisconnect(
        widget.baseUrl,
        card.slug,
        accountId: account?.id,
      );
      final links = await _client.connectorConnections(widget.baseUrl);
      if (!mounted) return;
      setState(() => _links = links);
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('$error')),
      );
    } finally {
      if (mounted) setState(() => _busySlug = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final catalog = _catalog;
    final setupNeeded = catalog != null && !catalog.configured;

    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        title: const Text('Apps'),
        actions: [
          if (_connectedCount > 0)
            Center(
              child: Padding(
                padding: const EdgeInsets.only(right: 4),
                child: Text(
                  '$_connectedCount connected',
                  style: TextStyle(color: Colors.grey.shade700, fontSize: 13),
                ),
              ),
            ),
          IconButton(
            tooltip: 'Refresh',
            onPressed: _loading ? null : _reload,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _reload,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
                children: [
                  Text(
                    'Connect an app once. Then choose which bots may use it.',
                    style: TextStyle(color: Colors.grey.shade700, fontSize: 14),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    _Notice(tone: _NoticeTone.error, text: _error!),
                  ],
                  if (setupNeeded) ...[
                    const SizedBox(height: 12),
                    const _Notice(
                      tone: _NoticeTone.info,
                      text:
                          'Connected apps are not set up on this server yet. On the computer or web app, open Apps (or Settings → API keys for a self-host Composio key). Until the server is configured, Connect stays off on every client.',
                    ),
                  ],
                  const SizedBox(height: 16),
                  TextField(
                    decoration: InputDecoration(
                      hintText: 'Search apps',
                      prefixIcon: const Icon(Icons.search),
                      filled: true,
                      fillColor: const Color(0xFFF2F2F7),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                        borderSide: BorderSide.none,
                      ),
                    ),
                    onChanged: (value) => setState(() => _search = value),
                  ),
                  const SizedBox(height: 12),
                  SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      children: [
                        _CategoryChip(
                          label: 'All',
                          selected: _category == null,
                          onTap: () => setState(() => _category = null),
                        ),
                        for (final category in _categories.take(6))
                          _CategoryChip(
                            label: _titleCase(category),
                            selected: _category == category,
                            onTap: () => setState(() => _category = category),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 20),
                  if (_filtered.isEmpty)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 24),
                      child: Text(
                        setupNeeded
                            ? 'No apps to show until connected apps are set up on the computer.'
                            : 'No apps match this search.',
                        style: TextStyle(color: Colors.grey.shade600),
                      ),
                    )
                  else
                    for (final card in _filtered) ...[
                      _AppTile(
                        card: card,
                        link: _links[card.slug],
                        busy: _busySlug == card.slug,
                        enabled: catalog?.configured == true,
                        onConnect: () {
                          unawaited(_connect(card));
                        },
                        onDisconnect: () {
                          final link = _links[card.slug];
                          if (link != null) unawaited(_disconnect(card, link));
                        },
                      ),
                      const SizedBox(height: 8),
                    ],
                  const SizedBox(height: 28),
                  Text(
                    'Your MCP servers',
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'Add and sign in to MCP servers in Apps on your computer or web app. Connect for Gmail and other apps works here; MCP add/sign-in stays on the computer.',
                    style: TextStyle(color: Colors.grey.shade700, fontSize: 13),
                  ),
                  const SizedBox(height: 12),
                  if (_visibleBots.isEmpty)
                    Text(
                      'Create a bot first to see its MCP servers.',
                      style: TextStyle(color: Colors.grey.shade600),
                    )
                  else ...[
                    DropdownButtonFormField<String>(
                      initialValue: _mcpBotId,
                      decoration: InputDecoration(
                        labelText: 'Bot',
                        filled: true,
                        fillColor: const Color(0xFFF2F2F7),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide: BorderSide.none,
                        ),
                      ),
                      items: [
                        for (final bot in _visibleBots)
                          DropdownMenuItem(
                            value: bot.id,
                            child: Text(bot.name.isEmpty ? bot.id : bot.name),
                          ),
                      ],
                      onChanged: (value) {
                        if (value != null) unawaited(_loadMcp(value));
                      },
                    ),
                    const SizedBox(height: 12),
                    if (_mcpLoading)
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 16),
                        child: Center(child: CircularProgressIndicator()),
                      )
                    else if (_mcpError != null)
                      _Notice(tone: _NoticeTone.error, text: _mcpError!)
                    else if (_mcpServers.isEmpty)
                      Text(
                        'No MCP servers on this computer yet.',
                        style: TextStyle(color: Colors.grey.shade600),
                      )
                    else
                      for (final server in _mcpServers)
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: Icon(
                            server.on && server.enabled && !server.offFor
                                ? Icons.check_circle
                                : Icons.dns_outlined,
                            color: server.on && server.enabled && !server.offFor
                                ? const Color(0xFF2E7D32)
                                : Colors.grey,
                          ),
                          title: Text(server.name),
                          subtitle: Text(
                            server.offFor
                                ? 'Does not start for this bot'
                                : server.enabled
                                    ? (server.on
                                        ? 'On for this bot'
                                        : 'Off for this bot')
                                    : 'Disabled in MCP settings',
                          ),
                        ),
                  ],
                ],
              ),
            ),
    );
  }
}

String _titleCase(String value) {
  if (value.isEmpty) return value;
  return value
      .split(' ')
      .map((part) => part.isEmpty ? part : '${part[0].toUpperCase()}${part.substring(1)}')
      .join(' ');
}

enum _NoticeTone { info, error }

class _Notice extends StatelessWidget {
  const _Notice({required this.tone, required this.text});

  final _NoticeTone tone;
  final String text;

  @override
  Widget build(BuildContext context) {
    final error = tone == _NoticeTone.error;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: error ? const Color(0xFFFFEBEE) : const Color(0xFFF2F2F7),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        text,
        style: TextStyle(
          color: error ? const Color(0xFFB71C1C) : Colors.grey.shade800,
          fontSize: 13,
        ),
      ),
    );
  }
}

class _CategoryChip extends StatelessWidget {
  const _CategoryChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: ChoiceChip(
        label: Text(label),
        selected: selected,
        onSelected: (_) => onTap(),
      ),
    );
  }
}

class _AppTile extends StatelessWidget {
  const _AppTile({
    required this.card,
    required this.link,
    required this.busy,
    required this.enabled,
    required this.onConnect,
    required this.onDisconnect,
  });

  final ConnectorToolkit card;
  final ConnectorLink? link;
  final bool busy;
  final bool enabled;
  final VoidCallback onConnect;
  final VoidCallback onDisconnect;

  @override
  Widget build(BuildContext context) {
    final connected = link?.hasActiveAccount == true;
    String? accountLabel;
    for (final account in link?.accounts ?? const <ConnectorAccount>[]) {
      if (account.active) {
        accountLabel = account.alias ?? account.id;
        break;
      }
    }

    return Material(
      color: const Color(0xFFF2F2F7),
      borderRadius: BorderRadius.circular(14),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
        child: Row(
          children: [
            _AppLogo(logo: card.logo, label: card.label),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Flexible(
                        child: Text(
                          card.label,
                          style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
                        ),
                      ),
                      if (connected) ...[
                        const SizedBox(width: 6),
                        const Icon(Icons.check_circle, size: 16, color: Color(0xFF2E7D32)),
                      ],
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text(
                    accountLabel ?? card.blurb,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: Colors.grey.shade700, fontSize: 13),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            if (busy)
              const SizedBox(
                width: 28,
                height: 28,
                child: Padding(
                  padding: EdgeInsets.all(4),
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              )
            else if (connected)
              IconButton(
                tooltip: 'Disconnect',
                onPressed: enabled ? onDisconnect : null,
                icon: const Icon(Icons.more_horiz),
              )
            else
              TextButton(
                onPressed: enabled ? onConnect : null,
                child: const Text('Connect'),
              ),
          ],
        ),
      ),
    );
  }
}

class _AppLogo extends StatelessWidget {
  const _AppLogo({required this.logo, required this.label});

  final String? logo;
  final String label;

  @override
  Widget build(BuildContext context) {
    final uri = logo == null ? null : Uri.tryParse(logo!);
    return ClipRRect(
      borderRadius: BorderRadius.circular(10),
      child: Container(
        width: 40,
        height: 40,
        color: Colors.white,
        alignment: Alignment.center,
        child: uri == null
            ? Text(
                label.isEmpty ? '?' : label[0].toUpperCase(),
                style: const TextStyle(fontWeight: FontWeight.w700),
              )
            : Image.network(
                uri.toString(),
                width: 40,
                height: 40,
                fit: BoxFit.cover,
                errorBuilder: (_, _, _) => Text(
                  label.isEmpty ? '?' : label[0].toUpperCase(),
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
              ),
      ),
    );
  }
}
