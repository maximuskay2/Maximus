import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../billing/billing_service.dart';
import '../billing/paywall_page.dart';
import '../billing/subscription_page.dart';
import '../engines/engines_page.dart';
import '../settings/preferences.dart';
import 'console_account.dart';

/// The billing workspace behind a paired server: email sign-in,
/// workspace switcher, month spend, seats + invites, provider modes.
class WorkspacePage extends StatefulWidget {
  const WorkspacePage({
    super.key,
    required this.account,
    required this.baseUrl,
    required this.prefs,
  });

  final ConsoleAccount account;
  final String baseUrl;
  final AppPreferences prefs;

  @override
  State<WorkspacePage> createState() => _WorkspacePageState();
}

class _WorkspacePageState extends State<WorkspacePage> {
  final _email = TextEditingController();
  final _code = TextEditingController();
  bool _codeSent = false;
  bool _busy = false;

  ConsoleMembership? _workspace;
  BillingService? _billing;
  WorkspaceSpend? _spend;
  WorkspaceSeats? _seats;
  List<WorkspaceProvider> _providers = const [];
  bool _loading = false;
  String? _error;

  MaximusApi get _client => widget.account.client;

  @override
  void initState() {
    super.initState();
    widget.account.addListener(_onAccount);
    _pickWorkspace();
  }

  @override
  void dispose() {
    _billing?.dispose();
    widget.account.removeListener(_onAccount);
    _email.dispose();
    _code.dispose();
    super.dispose();
  }

  void _onAccount() {
    if (!mounted) return;
    setState(_pickWorkspace);
    if (widget.account.signedIn && _workspace != null) _load();
  }

  String? _billingFor;

  void _pickWorkspace() {
    final memberships = widget.account.memberships;
    if (memberships.isEmpty) {
      _workspace = null;
      return;
    }
    final remembered = widget.prefs.workspace;
    _workspace = memberships.cast<ConsoleMembership?>().firstWhere(
      (m) => m!.workspace == remembered,
      orElse: () => memberships.first,
    );
    final workspace = _workspace;
    final token = widget.account.token;
    final key = workspace == null || token == null
        ? null
        : '${workspace.workspace}:$token';
    if (key != _billingFor) {
      _billing?.dispose();
      _billing = null;
      _billingFor = key;
      if (workspace != null && token != null) {
        _billing = BillingService(client: _client)
          ..start(
            baseUrl: widget.baseUrl,
            accountToken: token,
            workspace: workspace.workspace,
          )
          ..refreshStatus();
      }
    }
  }

  Future<void> _load() async {
    final token = widget.account.token;
    final workspace = _workspace;
    if (token == null || workspace == null) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final spend = await _client.consoleSpend(
        widget.baseUrl,
        token,
        workspace.workspace,
      );
      List<WorkspaceProvider> providers = const [];
      WorkspaceSeats? seats;
      try {
        providers = await _client.consoleProviders(
          widget.baseUrl,
          token,
          workspace.workspace,
        );
      } on ApiError {
        providers = const [];
      }
      if (workspace.admin) {
        try {
          seats = await _client.consoleSeats(
            widget.baseUrl,
            token,
            workspace.workspace,
          );
        } on ApiError {
          seats = null;
        }
      }
      if (mounted) {
        setState(() {
          _spend = spend;
          _providers = providers;
          _seats = seats;
        });
      }
    } on ApiError catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _sendCode() async {
    final email = _email.text.trim();
    if (!email.contains('@')) {
      setState(() => _error = 'Enter a valid email address.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    await widget.account.startSignIn(email);
    if (mounted) {
      setState(() {
        _busy = false;
        _codeSent = widget.account.error == null;
        _error = widget.account.error;
      });
    }
  }

  Future<void> _verify() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final ok = await widget.account.verifyCode(_email.text, _code.text);
    if (mounted) {
      setState(() {
        _busy = false;
        _error = widget.account.error;
      });
      if (ok) _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Workspace')),
      body: !widget.account.signedIn
          ? _signIn(context)
          : _loading && _spend == null
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: () async {
                await widget.account.refreshMemberships();
                await _load();
              },
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
                children: [
                  if (_error != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Text(
                        _error!,
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.error,
                        ),
                      ),
                    ),
                  _switcher(context),
                  const SizedBox(height: 12),
                  _subscriptionRow(context),
                  _spendCard(context),
                  const SizedBox(height: 12),
                  _seatsSection(context),
                  const SizedBox(height: 12),
                  _providersSection(context),
                  const SizedBox(height: 12),
                  TextButton(
                    onPressed: _busy
                        ? null
                        : () async {
                            await widget.account.signOut();
                            if (context.mounted) {
                              setState(() {
                                _spend = null;
                                _seats = null;
                                _providers = const [];
                                _codeSent = false;
                                _code.clear();
                              });
                            }
                          },
                    child: Text(
                      'Sign out ${widget.account.email ?? ''}'.trim(),
                    ),
                  ),
                ],
              ),
            ),
    );
  }

  Widget _signIn(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 24, 20, 32),
      children: [
        Text(
          'Your Maximus workspace',
          style: Theme.of(context).textTheme.headlineSmall,
        ),
        const SizedBox(height: 8),
        const Text(
          'Seats, month spend, and which AIs your bots may use. '
          'Sign in with the email that owns the workspace.',
        ),
        const SizedBox(height: 20),
        TextField(
          controller: _email,
          keyboardType: TextInputType.emailAddress,
          autocorrect: false,
          decoration: const InputDecoration(labelText: 'Email'),
          onSubmitted: (_) => _sendCode(),
        ),
        if (_codeSent) ...[
          const SizedBox(height: 12),
          TextField(
            controller: _code,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(
              labelText: 'Code from the email',
            ),
            onSubmitted: (_) => _verify(),
          ),
        ],
        if (_error != null || widget.account.error != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              _error ?? widget.account.error ?? '',
              style: TextStyle(
                color: Theme.of(context).colorScheme.error,
              ),
            ),
          ),
        const SizedBox(height: 16),
        FilledButton(
          onPressed: _busy ? null : (_codeSent ? _verify : _sendCode),
          child: Text(
            _busy
                ? 'Working…'
                : _codeSent
                ? 'Verify code'
                : 'Email me a code',
          ),
        ),
      ],
    );
  }

  Widget _switcher(BuildContext context) {
    final memberships = widget.account.memberships;
    if (memberships.length < 2) {
      final current = _workspace;
      if (current == null) return const SizedBox.shrink();
      return ListTile(
        contentPadding: EdgeInsets.zero,
        title: Text(
          current.displayName,
          style: Theme.of(context).textTheme.titleLarge,
        ),
        subtitle: Text('${current.plan} · ${current.role}'),
      );
    }
    return DropdownButtonFormField<String>(
      initialValue: _workspace?.workspace,
      decoration: const InputDecoration(labelText: 'Workspace'),
      items: [
        for (final m in memberships)
          DropdownMenuItem(
            value: m.workspace,
            child: Text('${m.displayName} (${m.plan})'),
          ),
      ],
      onChanged: (id) {
        if (id == null) return;
        widget.prefs.setWorkspace(id);
        setState(_pickWorkspace);
        _load();
      },
    );
  }

  Widget _subscriptionRow(BuildContext context) {
    final billing = _billing;
    final workspace = _workspace;
    if (billing == null || workspace == null) {
      return const SizedBox.shrink();
    }
    return ListenableBuilder(
      listenable: billing,
      builder: (context, _) {
        final subscribed = billing.status?.subscribed ?? false;
        final paid = workspace.plan != 'free';
        // Web-plan holders never see the paywall; the store
        // subscription screen is for store subscribers only.
        if (paid && !subscribed) return const SizedBox.shrink();
        return ListTile(
          contentPadding: EdgeInsets.zero,
          leading: Icon(
            subscribed ? Icons.workspace_premium_outlined : Icons.upgrade_outlined,
          ),
          title: Text(subscribed ? 'Subscription' : 'Upgrade to paid'),
          subtitle: Text(
            subscribed
                ? '${billing.status?.plan ?? 'Paid'} · billed by the store'
                : 'Use our AI or bring your own',
          ),
          trailing: const Icon(Icons.chevron_right_outlined),
          onTap: () async {
            if (subscribed) {
              await Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => SubscriptionPage(
                    billing: billing,
                    workspaceName: workspace.displayName,
                  ),
                ),
              );
              return;
            }
            final result = await Navigator.of(context).push<PaywallResult>(
              MaterialPageRoute(
                builder: (_) => PaywallPage(
                  billing: billing,
                  workspaceName: workspace.displayName,
                  client: _client,
                  baseUrl: widget.baseUrl,
                  timeZone: widget.prefs.timeZone,
                ),
              ),
            );
            if (!context.mounted) return;
            if (result == PaywallResult.byo) {
              await Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => EnginesPage(
                    client: _client,
                    baseUrl: widget.baseUrl,
                  ),
                ),
              );
            }
          },
        );
      },
    );
  }

  Widget _spendCard(BuildContext context) {
    final spend = _spend;
    if (spend == null) return const SizedBox.shrink();
    final allowance = spend.allowance;
    final pct = allowance == null || allowance <= 0
        ? 0.0
        : (spend.spent / allowance).clamp(0.0, 1.0);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Spend · ${spend.period}', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            Text(
              '\$${spend.spent.toStringAsFixed(2)}'
              '${allowance == null ? '' : ' of \$${allowance.toStringAsFixed(2)}'}',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            if (allowance != null) ...[
              const SizedBox(height: 8),
              LinearProgressIndicator(value: pct),
              const SizedBox(height: 4),
              Text(
                spend.overage > 0
                    ? '\$${spend.overage.toStringAsFixed(2)} over allowance'
                    : '\$${(spend.remaining ?? 0).toStringAsFixed(2)} left',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _seatsSection(BuildContext context) {
    final workspace = _workspace;
    final seats = _seats;
    if (workspace == null) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                'Seats',
                style: Theme.of(context).textTheme.titleMedium,
              ),
            ),
            if (workspace.admin)
              TextButton(
                onPressed: _busy ? null : () => _inviteSheet(context),
                child: const Text('Invite'),
              ),
          ],
        ),
        if (!workspace.admin)
          const Text('Only admins see seats and invites.')
        else if (seats == null)
          const Text('Seats did not load — pull to retry.')
        else ...[
          for (final member in seats.roster)
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(member.name ?? member.email),
              subtitle: Text('${member.email} · ${member.role}'),
              trailing: member.role == 'admin'
                  ? null
                  : IconButton(
                      icon: const Icon(Icons.person_remove_outlined),
                      tooltip: 'Remove',
                      onPressed: () => _removeMember(context, member),
                    ),
            ),
          for (final invite in seats.invites)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.mail_outline),
              title: Text(invite.email),
              subtitle: Text('Invited · ${invite.role}'),
              trailing: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  IconButton(
                    icon: const Icon(Icons.copy_outlined),
                    tooltip: 'Copy invite',
                    onPressed: () => _copyInvite(context, invite),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close_outlined),
                    tooltip: 'Revoke',
                    onPressed: () => _revokeInvite(context, invite),
                  ),
                ],
              ),
            ),
          if (seats.roster.isEmpty && seats.invites.isEmpty)
            const Text('Nobody yet — invite the team.'),
        ],
      ],
    );
  }

  Widget _providersSection(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text('AIs', style: Theme.of(context).textTheme.titleMedium),
            ),
            TextButton(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => EnginesPage(
                    client: _client,
                    baseUrl: widget.baseUrl,
                  ),
                ),
              ),
              child: const Text('Connect'),
            ),
          ],
        ),
        const Text('Which AIs this workspace\u2019s bots may use.'),
        const SizedBox(height: 4),
        if (_providers.isEmpty)
          const Text('No provider modes reported.')
        else
          for (final provider in _providers)
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(provider.id),
              subtitle: Text(
                '${_modeLabel(provider.mode)}'
                '${provider.reason == null ? '' : ' · ${provider.reason}'}',
              ),
              trailing: DropdownButton<String>(
                value: provider.mode,
                items: const [
                  DropdownMenuItem(value: 'bundled', child: Text('Bundled')),
                  DropdownMenuItem(value: 'byo', child: Text('Own key')),
                  DropdownMenuItem(value: 'off', child: Text('Off')),
                ],
                onChanged: (_workspace?.admin ?? false)
                    ? (mode) => _setProviderMode(provider, mode)
                    : null,
              ),
            ),
      ],
    );
  }

  String _modeLabel(String mode) => switch (mode) {
    'bundled' => 'Maximus key',
    'byo' => 'Your own key',
    _ => 'Off',
  };

  Future<void> _setProviderMode(
    WorkspaceProvider provider,
    String? mode,
  ) async {
    if (mode == null || mode == provider.mode) return;
    final token = widget.account.token;
    final workspace = _workspace;
    if (token == null || workspace == null) return;
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _busy = true);
    try {
      final updated = await _client.consoleSetProvider(
        widget.baseUrl,
        token,
        workspace.workspace,
        provider.id,
        {'mode': mode},
      );
      if (mounted) setState(() => _providers = updated);
    } on ApiError catch (error) {
      if (mounted) {
        messenger.showSnackBar(SnackBar(content: Text(error.message)));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _inviteSheet(BuildContext context) async {
    final messenger = ScaffoldMessenger.of(context);
    final email = TextEditingController();
    String role = 'member';
    final send = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (sheet) => Padding(
        padding: EdgeInsets.fromLTRB(
          20,
          20,
          20,
          20 + MediaQuery.of(sheet).viewInsets.bottom,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'Invite to ${_workspace?.displayName ?? 'workspace'}',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 12),
            TextField(
              controller: email,
              autofocus: true,
              keyboardType: TextInputType.emailAddress,
              decoration: const InputDecoration(labelText: 'Email'),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: role,
              decoration: const InputDecoration(labelText: 'Role'),
              items: const [
                DropdownMenuItem(
                  value: 'member',
                  child: Text('Member'),
                ),
                DropdownMenuItem(value: 'admin', child: Text('Admin')),
              ],
              onChanged: (value) => role = value ?? 'member',
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: () => Navigator.of(sheet).pop(true),
              child: const Text('Send invite'),
            ),
          ],
        ),
      ),
    );
    if (send != true || !mounted) return;
    final token = widget.account.token;
    final workspace = _workspace;
    if (token == null || workspace == null) return;
    try {
      final sent = await _client.consoleInviteSend(
        widget.baseUrl,
        token,
        workspace: workspace.workspace,
        email: email.text.trim(),
        role: role,
      );
      if (mounted) {
        await Clipboard.setData(ClipboardData(text: sent.token));
        messenger.showSnackBar(
          const SnackBar(
            content: Text('Invite sent — accept token copied.'),
          ),
        );
        _load();
      }
    } on ApiError catch (error) {
      if (mounted) {
        messenger.showSnackBar(SnackBar(content: Text(error.message)));
      }
    }
  }

  Future<void> _removeMember(
    BuildContext context,
    WorkspaceMember member,
  ) async {
    final token = widget.account.token;
    final workspace = _workspace;
    if (token == null || workspace == null) return;
    final messenger = ScaffoldMessenger.of(context);
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Remove ${member.email}?'),
        content: const Text('They lose this workspace immediately.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Keep'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (confirm != true || !mounted) return;
    try {
      await _client.consoleInviteRevoke(
        widget.baseUrl,
        token,
        workspace: workspace.workspace,
        userId: member.userId,
      );
      _load();
    } on ApiError catch (error) {
      if (mounted) {
        messenger.showSnackBar(SnackBar(content: Text(error.message)));
      }
    }
  }

  Future<void> _revokeInvite(
    BuildContext context,
    ConsoleInvite invite,
  ) async {
    final token = widget.account.token;
    final workspace = _workspace;
    if (token == null || workspace == null) return;
    final messenger = ScaffoldMessenger.of(context);
    try {
      await _client.consoleInviteRevoke(
        widget.baseUrl,
        token,
        workspace: workspace.workspace,
        inviteId: invite.id,
      );
      _load();
    } on ApiError catch (error) {
      if (mounted) {
        messenger.showSnackBar(SnackBar(content: Text(error.message)));
      }
    }
  }

  Future<void> _copyInvite(
    BuildContext context,
    ConsoleInvite invite,
  ) async {
    await Clipboard.setData(ClipboardData(text: invite.id));
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Invite id copied.')),
      );
    }
  }
}
