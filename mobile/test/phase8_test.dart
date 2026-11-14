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

  testWidgets('paywall lists Muse plans and buys', (tester) async {
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
    expect(find.text('Use our AI'), findsWidgets);
    expect(find.text('Plus'), findsOneWidget);
    expect(find.text('Pro'), findsOneWidget);

    await tester.tap(find.text('Choose Plus'));
    await tester.pumpAndSettle();
    expect(store.bought, ['maximus_plus_monthly']);
  });

  testWidgets('paywall shows the free grant when the store is down', (tester) async {
    final store = FakeIAPPlatform.install(available: false);
    addTearDown(store.close);
    final api = FakeApi()
      ..plansPayload = const [
        ConsolePlan(
          id: 'free',
          name: 'Free',
          blurb: 'A one-time Muse grant on our key.',
          baseUsd: 0,
          allowanceUsd: 0.012,
          entitlements: ['gateway'],
          features: ['Once per account'],
        ),
        ConsolePlan(
          id: 'plus',
          name: 'Plus',
          blurb: 'Includes Muse.',
          baseUsd: 19,
          allowanceUsd: 8,
          entitlements: ['billing', 'gateway'],
          features: ['muse-spark-1.3'],
        ),
        ConsolePlan(
          id: 'byo',
          name: 'Your model',
          blurb: 'Bring your own LLM key.',
          baseUsd: 9,
          allowanceUsd: 0,
          entitlements: ['billing'],
          features: ['Your provider bills the tokens'],
        ),
      ];
    final billing = billingWith(api, store);
    addTearDown(billing.dispose);
    await tester.pumpWidget(
      MaterialApp(
        theme: MaxTokens.light(),
        home: PaywallPage(
          billing: billing,
          workspaceName: 'Acme',
          client: api,
          baseUrl: 'https://h.example',
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Free'), findsWidgets);
    expect(find.text('\$0.012 of Muse, once'), findsOneWidget);
    expect(find.text('Plus'), findsOneWidget);
    expect(find.text('\$19/mo'), findsOneWidget);
    expect(find.text('Your model'), findsWidgets);
    await tester.tap(find.text('Your model').last);
    await tester.pumpAndSettle();
    expect(find.text('Bring your own LLM key.'), findsOneWidget);
    expect(find.text('\$9/mo'), findsOneWidget);
  });

  testWidgets('paywall shows naira and Paystack for Nigeria', (tester) async {
    final store = FakeIAPPlatform.install(available: false);
    addTearDown(store.close);
    final api = FakeApi()
      ..offerPayload = const BillingOffer(currency: 'NGN', provider: 'paystack', ngnPerUsd: 1600)
      ..plansPayload = const [
        ConsolePlan(
          id: 'plus',
          name: 'Plus',
          blurb: 'Includes Muse.',
          baseUsd: 19,
          allowanceUsd: 8,
          entitlements: ['billing', 'gateway'],
          features: [],
        ),
        ConsolePlan(
          id: 'byo',
          name: 'Your model',
          blurb: 'Bring your own LLM key.',
          baseUsd: 9,
          allowanceUsd: 0,
          entitlements: ['billing'],
          features: [],
        ),
      ];
    final billing = billingWith(api, store);
    addTearDown(billing.dispose);
    await tester.pumpWidget(
      MaterialApp(
        theme: MaxTokens.light(),
        home: PaywallPage(
          billing: billing,
          workspaceName: 'Acme',
          client: api,
          baseUrl: 'https://h.example',
          timeZone: 'WAT',
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('₦30,400/mo'), findsOneWidget);
    await tester.tap(find.text('Pay with Paystack'));
    await tester.pumpAndSettle();
    expect(api.checkoutWrites.single['provider'], 'paystack');
    expect(api.checkoutWrites.single['plan'], 'plus');
    expect(api.checkoutWrites.single['customerEmail'], 'owner@example.test');
    expect(api.checkoutWrites.single['timeZone'], 'WAT');

    await tester.tap(find.text('Your model').last);
    await tester.pumpAndSettle();
    expect(find.text('₦14,400/mo'), findsOneWidget);
    await tester.tap(find.text('Pay with Paystack'));
    await tester.pumpAndSettle();
    expect(api.checkoutWrites.last['plan'], 'byo');
  });

  testWidgets('paywall pays with Bachs when that is the offer', (tester) async {
    final store = FakeIAPPlatform.install(available: false);
    addTearDown(store.close);
    final api = FakeApi()
      ..offerPayload = const BillingOffer(currency: 'USD', provider: 'bachs', ngnPerUsd: 1600)
      ..checkoutUrl = 'https://checkout.bachs.io/ref'
      ..plansPayload = const [
        ConsolePlan(
          id: 'plus',
          name: 'Plus',
          blurb: 'Includes Muse.',
          baseUsd: 19,
          allowanceUsd: 8,
          entitlements: ['billing', 'gateway'],
          features: [],
        ),
        ConsolePlan(
          id: 'byo',
          name: 'Your model',
          blurb: 'Bring your own LLM key.',
          baseUsd: 9,
          allowanceUsd: 0,
          entitlements: ['billing'],
          features: [],
        ),
      ];
    final billing = billingWith(api, store);
    addTearDown(billing.dispose);
    await tester.pumpWidget(
      MaterialApp(
        theme: MaxTokens.light(),
        home: PaywallPage(
          billing: billing,
          workspaceName: 'Acme',
          client: api,
          baseUrl: 'https://h.example',
          timeZone: 'UTC',
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('\$19/mo'), findsOneWidget);
    await tester.tap(find.text('Pay with Bachs'));
    await tester.pumpAndSettle();
    expect(api.checkoutWrites.single['provider'], 'bachs');
    expect(api.checkoutWrites.single['plan'], 'plus');

    await tester.tap(find.text('Your model').last);
    await tester.pumpAndSettle();
    expect(find.text('\$9/mo'), findsOneWidget);
    await tester.tap(find.text('Pay with Bachs'));
    await tester.pumpAndSettle();
    expect(api.checkoutWrites.last['provider'], 'bachs');
    expect(api.checkoutWrites.last['plan'], 'byo');
    expect(find.textContaining('StoreKit'), findsNothing);
    expect(find.text('Restore purchases'), findsNothing);
  });

  testWidgets('a paid plan starts checkout when the card itself is tapped', (tester) async {
    final store = FakeIAPPlatform.install(available: false);
    addTearDown(store.close);
    final api = FakeApi()
      ..offerPayload = const BillingOffer(currency: 'USD', provider: 'stripe', ngnPerUsd: 1600)
      ..plansPayload = const [
        ConsolePlan(
          id: 'plus',
          name: 'Plus',
          blurb: 'Includes Muse.',
          baseUsd: 19,
          allowanceUsd: 8,
          entitlements: ['billing', 'gateway'],
          features: [],
        ),
      ];
    final billing = billingWith(api, store);
    addTearDown(billing.dispose);
    await tester.pumpWidget(
      MaterialApp(
        theme: MaxTokens.light(),
        home: PaywallPage(
          billing: billing,
          workspaceName: 'Acme',
          client: api,
          baseUrl: 'https://h.example',
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Pay with Stripe'), findsOneWidget);
    await tester.tap(find.text('Plus'));
    await tester.pumpAndSettle();
    expect(api.checkoutWrites.single['provider'], 'stripe');
    expect(api.checkoutWrites.single['plan'], 'plus');
  });

  test('a StoreKit platform failure leaves the store unavailable', () async {
    final store = FakeIAPPlatform.install();
    addTearDown(store.close);
    store.queryError = IAPError(
      source: 'app_store',
      code: 'storekit_no_response',
      message: 'StoreKit: Failed to get response from platform.',
    );
    final billing = billingWith(FakeApi(), store);
    addTearDown(billing.dispose);
    await billing.loadProducts();
    expect(billing.error, isNull);
    expect(billing.available, isFalse);
    expect(billing.products, isEmpty);
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
