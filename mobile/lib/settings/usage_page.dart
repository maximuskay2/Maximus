import 'package:flutter/material.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../auth/auth_state.dart';
import '../auth/session_actions.dart';

/// Phase 7: month token/cost usage grouped by bot.
class UsagePage extends StatefulWidget {
  const UsagePage({
    super.key,
    required this.client,
    required this.baseUrl,
    required this.auth,
  });

  final MaximusApi client;
  final String baseUrl;
  final AuthState auth;

  @override
  State<UsagePage> createState() => _UsagePageState();
}

class _UsagePageState extends State<UsagePage> {
  UsageReport? _report;
  RationWallet? _wallet;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final now = DateTime.now();
      final from =
          '${now.year}-${now.month.toString().padLeft(2, '0')}-01';
      final to =
          '${now.year}-${now.month.toString().padLeft(2, '0')}-'
          '${DateTime(now.year, now.month + 1, 0).day}';
      final report = await widget.client.usageReport(
        widget.baseUrl,
        from: from,
        to: to,
      );
      RationWallet? wallet;
      try {
        wallet = await widget.client.rationWallet(widget.baseUrl);
      } on ApiError {
        wallet = null;
      }
      if (mounted) {
        setState(() {
          _report = report;
          _wallet = wallet;
        });
      }
    } on ApiError catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final report = _report;
    final total = report?.total;
    return Scaffold(
      appBar: AppBar(title: const Text('Usage')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
          ? Center(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(_error!, textAlign: TextAlign.center),
                    const SizedBox(height: 16),
                    SessionActions(auth: widget.auth, baseUrl: widget.baseUrl),
                    const SizedBox(height: 8),
                    TextButton(onPressed: _load, child: const Text('Retry')),
                  ],
                ),
              ),
            )
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
                children: [
                  if (_wallet != null) _rationCard(context, _wallet!),
                  if (total != null)
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'This month',
                              style: Theme.of(context).textTheme.titleMedium,
                            ),
                            const SizedBox(height: 8),
                            Text(
                              _money(total, report!.currency),
                              style: Theme.of(
                                context,
                              ).textTheme.headlineSmall,
                            ),
                            const SizedBox(height: 4),
                            Text(
                              '${total.turns} turns · '
                              '${_tokens(total.input)} in · '
                              '${_tokens(total.output)} out',
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          ],
                        ),
                      ),
                    ),
                  const SizedBox(height: 8),
                  if (report == null || report.groups.isEmpty)
                    const ListTile(
                      title: Text('No usage yet'),
                      subtitle: Text('Chat with a bot to begin.'),
                    )
                  else
                    for (final group in report.groups)
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text(group.label),
                        subtitle: Text(
                          '${group.turns} turns · '
                          '${_tokens(group.input + group.output)} tokens',
                        ),
                        trailing: Text(
                          _money(group, report.currency),
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                      ),
                ],
              ),
            ),
    );
  }

  Widget _rationCard(BuildContext context, RationWallet wallet) {
    final tier = switch (wallet.tier) {
      'byo' => 'Your model',
      'starter' => 'Starter',
      'plus' => 'Plus',
      'pro' => 'Pro',
      _ => 'Free',
    };
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Muse ration', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 4),
            Text(tier),
            const SizedBox(height: 4),
            Text(
              '\$${wallet.leftUsd.toStringAsFixed(4)} left, ${wallet.sparkTokens} Spark tokens',
            ),
            if (wallet.storePriceUsd > 0) ...[
              const SizedBox(height: 4),
              Text('Phone price \$${wallet.storePriceUsd.toStringAsFixed(0)}'),
            ],
            if (wallet.contributorAccepted && wallet.tier == 'free') ...[
              const SizedBox(height: 8),
              Text(
                'Contributor Spark is on. Meta may train on those turns.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
            if (wallet.contributorOffered &&
                !wallet.contributorAccepted &&
                wallet.tier == 'free') ...[
              const SizedBox(height: 8),
              FilledButton(
                onPressed: () async {
                  try {
                    final next = await widget.client.acceptRationContributor(
                      widget.baseUrl,
                      true,
                    );
                    if (mounted) setState(() => _wallet = next);
                  } on ApiError {
                    // The grant stays on standard Spark when the save fails.
                  }
                },
                child: const Text('Use Contributor Spark'),
              ),
            ],
          ],
        ),
      ),
    );
  }

  String _money(UsageGroup group, String? currency) {
    final value = group.billableUsd ?? group.costUsd ?? group.estimatedUsd;
    if (value == null) return '—';
    final symbol = currency == 'USD' || currency == null ? '\$' : '$currency ';
    return '$symbol${value.toStringAsFixed(2)}';
  }

  String _tokens(int count) {
    if (count >= 1000000) return '${(count / 1000000).toStringAsFixed(1)}M';
    if (count >= 1000) return '${(count / 1000).toStringAsFixed(1)}k';
    return '$count';
  }
}
