import 'package:flutter/material.dart';
import 'package:in_app_purchase/in_app_purchase.dart';

import 'billing_service.dart';
import 'products.dart';

/// Phase 8: monthly individual plans sold through the store. Web-plan
/// holders never reach this page (the Workspace page only offers the
/// upgrade while every membership is free and no store subscription
/// is active).
class PaywallPage extends StatefulWidget {
  const PaywallPage({
    super.key,
    required this.billing,
    required this.workspaceName,
  });

  final BillingService billing;
  final String workspaceName;

  @override
  State<PaywallPage> createState() => _PaywallPageState();
}

class _PaywallPageState extends State<PaywallPage> {
  @override
  void initState() {
    super.initState();
    widget.billing.loadProducts();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Upgrade')),
      body: ListenableBuilder(
        listenable: widget.billing,
        builder: (context, _) {
          final billing = widget.billing;
          return ListView(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
            children: [
              Text(
                'Maximus for ${widget.workspaceName}',
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: 8),
              const Text(
                'Monthly plans with the AIs included — billed by the '
                'App Store or Google Play, cancel anytime in your '
                'store subscriptions.',
              ),
              const SizedBox(height: 16),
              if (!billing.available && billing.products.isEmpty)
                const Card(
                  child: ListTile(
                    leading: Icon(Icons.store_outlined),
                    title: Text('Store unavailable'),
                    subtitle: Text(
                      'Purchases need the App Store or Google Play on '
                      'this phone.',
                    ),
                  ),
                )
              else if (billing.products.isEmpty)
                const Card(
                  child: ListTile(
                    leading: Icon(Icons.pending_outlined),
                    title: Text('Plans are being set up'),
                    subtitle: Text(
                      'Monthly plans are not for sale yet — check back soon.',
                    ),
                  ),
                )
              else
                for (final product in billing.products)
                  _planCard(context, product),
              if (billing.error != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                    billing.error!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ),
              if (billing.outcome == BillingOutcome.purchased)
                const Padding(
                  padding: EdgeInsets.only(top: 8),
                  child: Text('Welcome aboard — your plan is active.'),
                ),
              const SizedBox(height: 16),
              TextButton(
                onPressed: billing.busy ? null : billing.restore,
                child: const Text('Restore purchases'),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _planCard(BuildContext context, ProductDetails product) {
    final plan = BillingProducts.planFor(product.id);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    product.title,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                Text(
                  '${product.price}/mo',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ],
            ),
            if (product.description.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(product.description),
            ],
            const SizedBox(height: 4),
            Text(
              'Unlocks the $plan plan for this workspace.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: widget.billing.busy
                  ? null
                  : () => _buy(context, product),
              child: Text(
                widget.billing.busy ? 'Working…' : 'Choose ${product.title}',
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _buy(BuildContext context, ProductDetails product) async {
    await widget.billing.buy(product);
    if (context.mounted &&
        widget.billing.outcome == BillingOutcome.purchased) {
      Navigator.of(context).pop(true);
    }
  }
}
