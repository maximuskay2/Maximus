import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import 'billing_service.dart';

/// Phase 8: the workspace's store subscription state — plan, renewal,
/// and management (the store owns cancel/refund; we deep-link there).
class SubscriptionPage extends StatefulWidget {
  const SubscriptionPage({
    super.key,
    required this.billing,
    required this.workspaceName,
  });

  final BillingService billing;
  final String workspaceName;

  @override
  State<SubscriptionPage> createState() => _SubscriptionPageState();
}

class _SubscriptionPageState extends State<SubscriptionPage> {
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    widget.billing.refreshStatus().whenComplete(() {
      if (mounted) setState(() => _loading = false);
    });
  }

  Future<void> _manage() async {
    // Apple and Google both manage subscriptions outside the app.
    final url = Theme.of(context).platform == TargetPlatform.android
        ? Uri.parse('https://play.google.com/store/account/subscriptions')
        : Uri.parse('https://apps.apple.com/account/subscriptions');
    await launchUrl(url, mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Subscription')),
      body: ListenableBuilder(
        listenable: widget.billing,
        builder: (context, _) {
          if (_loading && widget.billing.status == null) {
            return const Center(child: CircularProgressIndicator());
          }
          final status = widget.billing.status;
          final subscribed = status?.subscribed ?? false;
          return RefreshIndicator(
            onRefresh: widget.billing.refreshStatus,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
              children: [
                Text(
                  widget.workspaceName,
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
                const SizedBox(height: 12),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          subscribed
                              ? '${status!.plan ?? 'Paid'} plan'
                              : 'Free plan',
                          style: Theme.of(
                            context,
                          ).textTheme.titleLarge,
                        ),
                        const SizedBox(height: 4),
                        Text(
                          !subscribed
                              ? 'No store subscription on this workspace.'
                              : status!.status == 'grace'
                              ? 'Past due — update payment in the store to keep the plan.'
                              : status.expiresAt == null
                              ? 'Billed by ${status.platform == 'google' ? 'Google Play' : 'the App Store'}.'
                              : 'Renews ${DateTime.fromMillisecondsSinceEpoch(status.expiresAt!).toLocal().toString().split(' ').first}.',
                        ),
                      ],
                    ),
                  ),
                ),
                if (widget.billing.error != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(
                      widget.billing.error!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ),
                const SizedBox(height: 12),
                if (subscribed)
                  OutlinedButton(
                    onPressed: _manage,
                    child: const Text('Manage in the store'),
                  ),
                TextButton(
                  onPressed: widget.billing.busy
                      ? null
                      : widget.billing.restore,
                  child: const Text('Restore purchases'),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}
