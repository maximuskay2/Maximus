import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:in_app_purchase/in_app_purchase.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/client.dart';
import '../api/models.dart';
import 'billing_service.dart';
import 'products.dart';

/// Result popped when the person finishes the plan list.
enum PaywallResult {
  /// Free grant or a Muse (use-our-AI) paid plan.
  muse,

  /// Bring-your-own seat — open engines next.
  byo,
}

/// Monthly plans: Use our AI (Muse) vs Your model (BYO).
class PaywallPage extends StatefulWidget {
  const PaywallPage({
    super.key,
    required this.billing,
    required this.workspaceName,
    this.client,
    this.baseUrl,
    this.timeZone,
    this.required = false,
    this.initialTrack = PaywallTrack.muse,
  });

  final BillingService billing;
  final String workspaceName;
  final MaximusApi? client;
  final String? baseUrl;
  final String? timeZone;

  /// Sign-in leaves this page up until the person picks Free or a paid plan.
  final bool required;

  final PaywallTrack initialTrack;

  @override
  State<PaywallPage> createState() => _PaywallPageState();
}

enum PaywallTrack { muse, byo }

class _PaywallPageState extends State<PaywallPage> {
  List<ConsolePlan> _plans = const [];
  BillingOffer _offer = BillingOffer.usd;
  bool _loadingPlans = true;
  String? _payError;
  String? _paying;
  String? _freeNote;
  bool _freeChosen = false;
  late PaywallTrack _track = widget.initialTrack;

  @override
  void initState() {
    super.initState();
    _loadPlans();
  }

  String get _zone => widget.timeZone ?? DateTime.now().timeZoneName;

  Future<void> _loadPlans() async {
    final client = widget.client;
    final baseUrl = widget.baseUrl;
    if (client == null || baseUrl == null || baseUrl.isEmpty) {
      await widget.billing.loadProducts();
      if (mounted) setState(() => _loadingPlans = false);
      return;
    }
    var hosted = false;
    try {
      final plans = await client.consolePlans(baseUrl);
      final offer = await client.billingOffer(baseUrl, timeZone: _zone);
      hosted = offer.hostedCheckout;
      if (mounted) {
        setState(() {
          _plans = plans;
          _offer = offer;
        });
      }
    } catch (_) {
      /* the store cards still stand when the catalog cannot be read */
    } finally {
      if (!hosted) await widget.billing.loadProducts();
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

  void _finish(PaywallResult result) {
    if (!mounted) return;
    Navigator.of(context).pop(result);
  }

  Future<void> _remember(String choice) async {
    final client = widget.client;
    final baseUrl = widget.baseUrl;
    if (client == null || baseUrl == null || baseUrl.isEmpty) return;
    await client.chooseAccountPlan(baseUrl, choice);
  }

  /// Opens the one free grant. The wallet says when this email or phone already used it.
  Future<void> _chooseFree() async {
    final client = widget.client;
    final baseUrl = widget.baseUrl;
    if (_freeChosen) {
      _finish(PaywallResult.muse);
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
      if (wallet.tier != 'free') {
        await _remember(wallet.tier == 'byo' ? 'byo' : 'muse');
        _finish(wallet.tier == 'byo' ? PaywallResult.byo : PaywallResult.muse);
        return;
      }
      if (wallet.leftUsd <= 0) {
        await _remember('free');
        if (!mounted) return;
        setState(() {
          _freeNote = wallet.grantedUsd <= 0
              ? 'This email or phone already used its free Muse grant.'
              : 'This free Muse grant is used up.';
          _freeChosen = true;
          _paying = null;
        });
        return;
      }
      await _remember('free');
      _finish(PaywallResult.muse);
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
    final provider = _offer.provider;
    if (provider != 'stripe' && provider != 'paystack' && provider != 'bachs') return;
    final gateway = _offer.checkoutLabel;
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
            _payError = 'Sign in with email to pay with $gateway.';
            _paying = null;
          });
        }
        return;
      }
      final checkout = await client.billingCheckout(
        baseUrl,
        provider: provider,
        plan: plan.id,
        customerEmail: email,
        successUrl: '$baseUrl/',
        cancelUrl: '$baseUrl/',
        timeZone: _zone,
      );
      await _remember(plan.bringYourOwn ? 'byo' : 'muse');
      final url = Uri.tryParse(checkout.url);
      if (url == null || !url.hasScheme) {
        throw StateError('$gateway did not return a payment page.');
      }
      await launchUrl(url, mode: LaunchMode.externalApplication);
      _finish(plan.bringYourOwn ? PaywallResult.byo : PaywallResult.muse);
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

  List<ConsolePlan> _catalogFor(PaywallTrack track, bool hosted) {
    final filtered = _plans.where((plan) {
      if (track == PaywallTrack.byo) return plan.bringYourOwn;
      return plan.useOurAi;
    });
    if (hosted) return filtered.toList();
    return filtered.where((plan) => !_soldInStore(plan)).toList();
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
            final hosted = _offer.hostedCheckout;
            final catalog = _catalogFor(_track, hosted);
            return ListView(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
              children: [
                Text(
                  _track == PaywallTrack.muse ? 'Use our AI' : 'Your model',
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
                const SizedBox(height: 8),
                Text(
                  _track == PaywallTrack.muse
                      ? 'Muse on our key — free grant or a monthly allowance for ${widget.workspaceName}.'
                      : 'Bring your own LLM key. The monthly fee is for the app; your provider bills the tokens.',
                  style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                ),
                const SizedBox(height: 16),
                SegmentedButton<PaywallTrack>(
                  segments: const [
                    ButtonSegment(
                      value: PaywallTrack.muse,
                      label: Text('Use our AI'),
                      icon: Icon(Icons.auto_awesome_outlined),
                    ),
                    ButtonSegment(
                      value: PaywallTrack.byo,
                      label: Text('Your model'),
                      icon: Icon(Icons.key_outlined),
                    ),
                  ],
                  selected: {_track},
                  onSelectionChanged: (next) {
                    if (next.isEmpty) return;
                    setState(() => _track = next.first);
                  },
                ),
                const SizedBox(height: 16),
                if (_loadingPlans)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 12),
                    child: Center(child: CircularProgressIndicator()),
                  ),
                for (final plan in catalog) _catalogCard(context, plan),
                if (!hosted && _track == PaywallTrack.muse)
                  for (final product in billing.products) _planCard(context, product),
                if (!_loadingPlans &&
                    catalog.isEmpty &&
                    (_track == PaywallTrack.byo ||
                        (billing.products.isEmpty && !billing.available)))
                  Card(
                    child: ListTile(
                      leading: Icon(
                        _track == PaywallTrack.byo
                            ? Icons.key_outlined
                            : Icons.store_outlined,
                      ),
                      title: Text(
                        _track == PaywallTrack.byo
                            ? 'Your model plan'
                            : 'Store unavailable',
                      ),
                      subtitle: Text(
                        _track == PaywallTrack.byo
                            ? 'Subscribe on the web, then connect your key here.'
                            : 'Purchases need the App Store or Google Play on this phone.',
                      ),
                    ),
                  )
                else if (!_loadingPlans &&
                    catalog.isEmpty &&
                    billing.products.isEmpty &&
                    _track == PaywallTrack.muse)
                  const Card(
                    child: ListTile(
                      leading: Icon(Icons.pending_outlined),
                      title: Text('Plans are being set up'),
                      subtitle: Text(
                        'Monthly plans are not for sale yet — check back soon.',
                      ),
                    ),
                  ),
                if (!hosted &&
                    _track == PaywallTrack.byo &&
                    catalog.any((plan) => plan.baseUsd > 0) &&
                    widget.baseUrl != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: FilledButton(
                      onPressed: () {
                        final plan = catalog.firstWhere((row) => row.baseUsd > 0);
                        _pay(plan);
                      },
                      child: Text('Pay with ${_offer.checkoutLabel}'),
                    ),
                  ),
                if (!hosted && billing.error != null)
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
                if (!hosted) ...[
                  const SizedBox(height: 16),
                  TextButton(
                    onPressed: billing.busy ? null : billing.restore,
                    child: const Text('Restore purchases'),
                  ),
                ],
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
    final choose = free
        ? (_paying == 'free' ? null : _chooseFree)
        : (_paying == plan.id ? null : () => _pay(plan));
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: InkWell(
        onTap: choose,
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
                  child: Text(
                    feature,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
                  ),
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
            ] else if (plan.baseUsd > 0) ...[
              const SizedBox(height: 12),
              FilledButton(
                onPressed: _paying == plan.id ? null : () => _pay(plan),
                child: Text(
                  _paying == plan.id
                      ? 'Opening ${_offer.checkoutLabel}…'
                      : 'Pay with ${_offer.checkoutLabel}',
                ),
              ),
            ],
          ],
        ),
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
      Navigator.of(context).pop(PaywallResult.muse);
    }
  }
}
