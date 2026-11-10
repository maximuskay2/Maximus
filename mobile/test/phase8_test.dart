import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:in_app_purchase_platform_interface/in_app_purchase_platform_interface.dart';
import 'package:maximus/api/models.dart';
import 'package:maximus/billing/billing_service.dart';
import 'package:maximus/billing/paywall_page.dart';
import 'package:maximus/billing/products.dart';
import 'package:maximus/billing/subscription_page.dart';
import 'package:maximus/theme/tokens.dart';

import 'fake_api.dart';
import 'fake_iap.dart';

BillingService billingWith(FakeApi api, FakeIAPPlatform store) {
  final billing = BillingService(client: api, store: store);
  billing.start(
    baseUrl: 'https://h.example',
    accountToken: 'acct-1',
    workspace: 'acme',
  );
  return billing;
}

void main() {
  test('product ids map to plans', () {
    expect(BillingProducts.planFor('maximus_plus_monthly'), 'team');
    expect(BillingProducts.planFor('maximus_pro_monthly'), 'business');
    expect(BillingProducts.planFor('bogus'), 'free');
  });

  test('buy verifies the receipt then completes the purchase', () async {
    final store = FakeIAPPlatform.install();
    addTearDown(store.close);
    final api = FakeApi();
    final billing = billingWith(api, store);
    addTearDown(billing.dispose);

    await billing.loadProducts();
    expect(billing.available, isTrue);
    expect(billing.products, hasLength(2));

    await billing.buy(
      billing.products.firstWhere((p) => p.id == 'maximus_plus_monthly'),
    );
    expect(store.bought, ['maximus_plus_monthly']);
    // The store sheet answers asynchronously through the stream.
    store.emitPurchase(productId: 'maximus_plus_monthly');
    await Future<void>.delayed(Duration.zero);
    await Future<void>.delayed(Duration.zero);

    expect(api.storeVerifications.single['platform'], 'apple');
    expect(
      api.storeVerifications.single['receipt'],
      'receipt-jws',
    );
    expect(store.completed, hasLength(1));
    expect(billing.outcome, BillingOutcome.purchased);
  });

  test('restore replays receipts and cancelled stays quiet', () async {
    final store = FakeIAPPlatform.install();
    addTearDown(store.close);
    final api = FakeApi();
    final billing = billingWith(api, store);
    addTearDown(billing.dispose);

    await billing.restore();
    expect(store.restored, isTrue);
    store.emitPurchase(
      productId: 'maximus_pro_monthly',
      status: PurchaseStatus.restored,
    );
    await Future<void>.delayed(Duration.zero);
    await Future<void>.delayed(Duration.zero);
    expect(billing.outcome, BillingOutcome.restored);
    expect(api.storeVerifications, hasLength(1));

    store.emitPurchase(
      productId: 'maximus_pro_monthly',
      status: PurchaseStatus.canceled,
    );
    await Future<void>.delayed(Duration.zero);
    await Future<void>.delayed(Duration.zero);
    expect(billing.outcome, BillingOutcome.cancelled);
    expect(api.storeVerifications, hasLength(1));
  });

  test('failed verification surfaces and still completes', () async {
    final store = FakeIAPPlatform.install();
    addTearDown(store.close);
    final api = FakeApi()..failStoreVerify = true;
    final billing = billingWith(api, store);
    addTearDown(billing.dispose);

    store.emitPurchase(productId: 'maximus_plus_monthly');
    await Future<void>.delayed(Duration.zero);
    await Future<void>.delayed(Duration.zero);
    expect(billing.outcome, BillingOutcome.failed);
    expect(billing.error, isNotEmpty);
    // Completed so the store sheet never nags again; the server
    // stayed ungranted, so retrying re-verifies cleanly.
    expect(store.completed, hasLength(1));
  });

  test('store status refresh reads the server state', () async {
    FakeIAPPlatform.install();
    final api = FakeApi()
      ..storeSubscriptionPayload = const StoreSubscription(
        workspace: 'acme',
        subscribed: true,
        platform: 'apple',
        productId: 'maximus_plus_monthly',
        plan: 'team',
        status: 'active',
        expiresAt: 1790000000000,
      );
    addTearDown(FakeIAPPlatform.install().close);
    final billing = billingWith(api, InAppPurchasePlatform.instance as FakeIAPPlatform);
    addTearDown(billing.dispose);
    await billing.refreshStatus();
    expect(billing.status?.subscribed, isTrue);
    expect(billing.status?.plan, 'team');
  });

  testWidgets('paywall lists plans and buys', (tester) async {
    final store = FakeIAPPlatform.install();
    addTearDown(store.close);
    final billing = billingWith(FakeApi(), store);
    addTearDown(billing.dispose);
    await tester.pumpWidget(
      MaterialApp(
        theme: MaxTokens.light(),
        home: PaywallPage(billing: billing, workspaceName: 'Acme'),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Plus'), findsOneWidget);
    expect(find.text('Pro'), findsOneWidget);

    await tester.tap(find.text('Choose Plus'));
    await tester.pumpAndSettle();
    expect(store.bought, ['maximus_plus_monthly']);
  });

  testWidgets('paywall explains a missing store', (tester) async {
    final store = FakeIAPPlatform.install(available: false);
    addTearDown(store.close);
    final billing = billingWith(FakeApi(), store);
    addTearDown(billing.dispose);
    await tester.pumpWidget(
      MaterialApp(
        theme: MaxTokens.light(),
        home: PaywallPage(billing: billing, workspaceName: 'Acme'),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Store unavailable'), findsOneWidget);
  });

  testWidgets('subscription page shows plan and renewal', (tester) async {
    FakeIAPPlatform.install();
    final api = FakeApi()
      ..storeSubscriptionPayload = const StoreSubscription(
        workspace: 'acme',
        subscribed: true,
        platform: 'apple',
        productId: 'maximus_plus_monthly',
        plan: 'team',
        status: 'active',
        expiresAt: 1790000000000,
      );
    addTearDown(FakeIAPPlatform.install().close);
    final billing = billingWith(api, InAppPurchasePlatform.instance as FakeIAPPlatform);
    addTearDown(billing.dispose);
    await tester.pumpWidget(
      MaterialApp(
        theme: MaxTokens.light(),
        home: SubscriptionPage(billing: billing, workspaceName: 'Acme'),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('team plan'), findsOneWidget);
    expect(find.textContaining('Renews'), findsOneWidget);
    expect(find.text('Manage in the store'), findsOneWidget);
  });

  testWidgets('subscription page shows free with restore', (tester) async {
    FakeIAPPlatform.install();
    final billing = billingWith(FakeApi(), FakeIAPPlatform.install());
    addTearDown(billing.dispose);
    await tester.pumpWidget(
      MaterialApp(
        theme: MaxTokens.light(),
        home: SubscriptionPage(billing: billing, workspaceName: 'Acme'),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Free plan'), findsOneWidget);
    expect(find.text('Restore purchases'), findsOneWidget);
  });
}
