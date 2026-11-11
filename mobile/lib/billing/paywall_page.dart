import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:in_app_purchase/in_app_purchase.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/client.dart';
import '../api/models.dart';
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
    this.client,
    this.baseUrl,
    this.timeZone,
    this.required = false,
  });

  final BillingService billing;
  final String workspaceName;
  final MaximusApi? client;
  final String? baseUrl;
  final String? timeZone;

  /// Sign-in leaves this page up until the person picks Free or a paid plan.
  final bool required;

  @override
  State<PaywallPage> createState() => _PaywallPageState();
}

class _PaywallPageState extends State<PaywallPage> {
  List<ConsolePlan> _plans = const [];
  BillingOffer _offer = BillingOffer.usd;
  bool _loadingPlans = true;
  String? _payError;
  String? _paying;
  String? _freeNote;
  bool _freeChosen = false;

  @override
  void initState() {
    super.initState();
    widget.billing.loadProducts();
    _loadPlans();
  }

  String get _zone => widget.timeZone ?? DateTime.now().timeZoneName;

  Future<void> _loadPlans() async {
    final client = widget.client;
    final baseUrl = widget.baseUrl;
    if (client == null || baseUrl == null || baseUrl.isEmpty) {
      if (mounted) setState(() => _loadingPlans = false);
      return;
    }
    try {
      final plans = await client.consolePlans(baseUrl);
      final offer = await client.billingOffer(baseUrl, timeZone: _zone);
      if (mounted) {
        setState(() {
          _plans = plans;
          _offer = offer;
        });
      }
    } catch (_) {
      /* the store cards still stand when the catalog cannot be read */
    } finally {
      if (mounted) setState(() => _loadingPlans = false);
    }
  }

  Future<String?> _installId() async {
    try {
      return await const FlutterSecureStorage().read(key: 'maximus.phone.install');
    } catch (_) {
      return null;
    }
  }

  void _chosen() {
    if (!mounted) return;
    Navigator.of(context).pop(true);
  }

  /// Opens the one free grant. The wallet says when this email or phone already used it.
  Future<void> _chooseFree() async {
    final client = widget.client;
    final baseUrl = widget.baseUrl;
    if (_freeChosen) {
      _chosen();
      return;
    }
    if (client == null || baseUrl == null || baseUrl.isEmpty) return;
    setState(() {
      _paying = 'free';
      _payError = null;
    });
    try {
      final wallet = await client.rationWallet(baseUrl, installId: await _installId());
      if (!mounted) return;
      if (wallet.leftUsd <= 0) {
        setState(() {
          _freeNote = wallet.grantedUsd <= 0
              ? 'This email or phone already used its free Muse grant.'
              : 'This free Muse grant is used up.';
          _freeChosen = true;
          _paying = null;
        });
        return;
      }
      _chosen();
    } catch (error) {
      if (mounted) setState(() => _payError = '$error');
    } finally {
      if (mounted && _paying == 'free') setState(() => _paying = null);
    }
  }

  Future<void> _pay(ConsolePlan plan) async {
    final client = widget.client;
    final baseUrl = widget.baseUrl;
    if (client == null || baseUrl == null) return;
    setState(() {
      _paying = plan.id;
      _payError = null;
    });
    try {
      final session = await client.authSession(baseUrl);
      final email = session.email;
      if (email == null || email.isEmpty) {
        if (mounted) {
          setState(() {
            _payError = 'Sign in with email to pay with Paystack.';
            _paying = null;
          });
        }
        return;
      }
      final checkout = await client.billingCheckout(
        baseUrl,
        plan: plan.id,
        customerEmail: email,
        successUrl: '$baseUrl/',
        cancelUrl: '$baseUrl/',
        timeZone: _zone,
      );
      final url = Uri.tryParse(checkout.url);
      if (url == null || !url.hasScheme) {
        throw StateError('Paystack did not return a payment page.');
      }
      await launchUrl(url, mode: LaunchMode.externalApplication);
      _chosen();
    } catch (error) {
      if (mounted) setState(() => _payError = '$error');
    } finally {
      if (mounted) setState(() => _paying = null);
    }
  }

  bool _soldInStore(ConsolePlan plan) {
    return widget.billing.products.any((product) {
      if (plan.id == 'plus' && product.id == BillingProducts.plusMonthly) return true;
      if (plan.id == 'pro' && product.id == BillingProducts.proMonthly) return true;
      return product.title.toLowerCase() == plan.name.toLowerCase();
    });
  }

  String _naira(int amount) {
    final digits = amount.toString();
    final out = StringBuffer('₦');
    for (var i = 0; i < digits.length; i++) {
      if (i > 0 && (digits.length - i) % 3 == 0) out.write(',');
      out.write(digits[i]);
    }
    return out.toString();
  }

  String _price(ConsolePlan plan) {
    if (plan.baseUsd <= 0) return 'Free';
    if (_offer.paystack) return '${_naira((plan.baseUsd * _offer.ngnPerUsd).round())}/mo';
    return '${_money(plan.baseUsd)}/mo';
  }

  String _money(double amount) {
    if (amount == amount.roundToDouble()) return '\$${amount.toStringAsFixed(0)}';
    var text = amount.toStringAsFixed(4);
    text = text.replaceFirst(RegExp(r'0+$'), '').replaceFirst(RegExp(r'\.$'), '');
    return '\$$text';
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: !widget.required,
      child: Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: !widget.required,
        title: Text(widget.required ? 'Choose a plan' : 'Upgrade'),
      ),
      body: ListenableBuilder(
        listenable: widget.billing,
        builder: (context, _) {
          final billing = widget.billing;
          final paystack = _offer.paystack;
          final catalog = paystack ? _plans : _plans.where((plan) => !_soldInStore(plan)).toList();
          return ListView(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
            children: [
              Text('Plans', style: Theme.of(context).textTheme.headlineSmall),
              const SizedBox(height: 8),
              Text(
                'Free includes the Muse grant set on this server. '
                'Paid plans are monthly for ${widget.workspaceName}.',
                style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 16),
              if (_loadingPlans)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 12),
                  child: Center(child: CircularProgressIndicator()),
                ),
              for (final plan in catalog) _catalogCard(context, plan),
              if (!paystack)
                for (final product in billing.products) _planCard(context, product),
              if (!_loadingPlans && catalog.isEmpty && billing.products.isEmpty && !billing.available)
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
              else if (!_loadingPlans && catalog.isEmpty && billing.products.isEmpty)
                const Card(
                  child: ListTile(
                    leading: Icon(Icons.pending_outlined),
                    title: Text('Plans are being set up'),
                    subtitle: Text(
                      'Monthly plans are not for sale yet — check back soon.',
                    ),
                  ),
                ),
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
              if (_payError != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                    _payError!,
                    style: TextStyle(color: Theme.of(context).colorScheme.error),
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
    ),
    );
  }

  Widget _catalogCard(BuildContext context, ConsolePlan plan) {
    final scheme = Theme.of(context).colorScheme;
    final free = plan.baseUsd <= 0 && plan.id == 'free';
    final price = free ? 'Free' : _price(plan);
    final grant = plan.id == 'free' && plan.allowanceUsd > 0
        ? '${_money(plan.allowanceUsd)} of Muse, once'
        : plan.allowanceUsd > 0
        ? '${_money(plan.allowanceUsd)} of Muse each month'
        : plan.blurb;
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(child: Text(plan.name, style: Theme.of(context).textTheme.titleMedium)),
                Text(price, style: Theme.of(context).textTheme.titleMedium?.copyWith(color: scheme.primary)),
              ],
            ),
            if (grant.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(grant, style: Theme.of(context).textTheme.bodyMedium),
            ],
            if (plan.features.isNotEmpty) ...[
              const SizedBox(height: 8),
              for (final feature in plan.features)
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Text(feature, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant)),
                ),
            ],
            if (_freeNote != null && free) ...[
              const SizedBox(height: 12),
              Text(_freeNote!, style: Theme.of(context).textTheme.bodyMedium),
            ],
            if (free) ...[
              const SizedBox(height: 12),
              FilledButton(
                onPressed: _paying == 'free' ? null : _chooseFree,
                child: Text(_paying == 'free' ? 'Opening…' : _freeChosen ? 'Continue' : 'Use free'),
              ),
            ] else if (_offer.paystack && plan.baseUsd > 0) ...[
              const SizedBox(height: 12),
              FilledButton(
                onPressed: _paying == plan.id ? null : () => _pay(plan),
                child: Text(_paying == plan.id ? 'Opening Paystack…' : 'Pay with Paystack'),
              ),
            ],
          ],
        ),
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
