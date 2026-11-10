import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:in_app_purchase/in_app_purchase.dart';
import 'package:in_app_purchase_platform_interface/in_app_purchase_platform_interface.dart';

import '../api/client.dart';
import '../api/models.dart';
import 'products.dart';

/// The last purchase outcome, for paywall copy.
enum BillingOutcome { none, purchased, restored, cancelled, failed }

/// Phase 8: store purchases (StoreKit / Play Billing) with server-side
/// verification. The purchase stream is the source of truth: every
/// purchased/restored receipt is verified with the control plane and
/// only then completed, so an app killed mid-verify retries the same
/// receipt on the next launch (the server grant is idempotent).
class BillingService extends ChangeNotifier {
  BillingService({required MaximusApi client, InAppPurchasePlatform? store})
    : _client = client, // ignore: prefer_initializing_formals
      _store = store ?? _defaultStore();

  /// The registered store front. Touching the facade once registers the
  /// platform implementation (StoreKit on iOS, Play on Android); tests
  /// inject a fake instead.
  static InAppPurchasePlatform _defaultStore() {
    InAppPurchase.instance;
    return InAppPurchasePlatform.instance;
  }

  final MaximusApi _client;
  final InAppPurchasePlatform _store;
  StreamSubscription<List<PurchaseDetails>>? _sub;

  bool _available = false;
  bool get available => _available;

  List<ProductDetails> _products = const [];
  List<ProductDetails> get products => _products;

  StoreSubscription? _status;
  StoreSubscription? get status => _status;

  bool _busy = false;
  bool get busy => _busy;

  String? _error;
  String? get error => _error;

  BillingOutcome _outcome = BillingOutcome.none;
  BillingOutcome get outcome => _outcome;

  String? _baseUrl;
  String? _accountToken;
  String? _workspace;

  /// Starts listening for purchases. Call once per signed-in workspace.
  void start({
    required String baseUrl,
    required String accountToken,
    required String workspace,
  }) {
    _baseUrl = baseUrl;
    _accountToken = accountToken;
    _workspace = workspace;
    _sub ??= _store.purchaseStream.listen(
      _onPurchases,
      onError: (_) => _fail('The store reported an error.'),
    );
  }

  /// Loads store availability + product details for the paywall.
  Future<void> loadProducts() async {
    _error = null;
    notifyListeners();
    try {
      _available = await _store.isAvailable();
      if (!_available) {
        _products = const [];
        return;
      }
      final response = await _store.queryProductDetails(BillingProducts.all);
      if (response.error != null) {
        _fail(_storeError(response.error!));
        return;
      }
      _products = [...response.productDetails]
        ..sort((a, b) => a.id.compareTo(b.id));
    } catch (_) {
      _fail('The store is unreachable right now.');
    } finally {
      notifyListeners();
    }
  }

  /// Refreshes the server-side subscription state.
  Future<void> refreshStatus() async {
    final baseUrl = _baseUrl;
    final token = _accountToken;
    final workspace = _workspace;
    if (baseUrl == null || token == null || workspace == null) return;
    try {
      _status = await _client.consoleStoreStatus(baseUrl, token, workspace);
      _error = null;
    } on ApiError catch (error) {
      _error = error.message;
    } finally {
      notifyListeners();
    }
  }

  /// Buys a monthly plan through the store sheet.
  Future<void> buy(ProductDetails product) async {
    _error = null;
    _outcome = BillingOutcome.none;
    _busy = true;
    notifyListeners();
    try {
      final ok = await _store.buyNonConsumable(
        purchaseParam: PurchaseParam(productDetails: product),
      );
      if (!ok) _fail('The store refused to start checkout.');
    } catch (_) {
      _fail('The store is unreachable right now.');
    } finally {
      _busy = false;
      notifyListeners();
    }
  }

  /// Restores purchases from the store (reinstalls, new phones).
  Future<void> restore() async {
    _error = null;
    _busy = true;
    notifyListeners();
    try {
      await _store.restorePurchases();
    } catch (_) {
      _fail('The store is unreachable right now.');
    } finally {
      _busy = false;
      notifyListeners();
    }
  }

  Future<void> _onPurchases(List<PurchaseDetails> purchases) async {
    for (final purchase in purchases) {
      switch (purchase.status) {
        case PurchaseStatus.purchased:
        case PurchaseStatus.restored:
          await _verifyAndComplete(purchase);
        case PurchaseStatus.canceled:
          _outcome = BillingOutcome.cancelled;
          notifyListeners();
        case PurchaseStatus.error:
          final error = purchase.error;
          _fail(error == null ? 'The store reported an error.' : _storeError(error));

        case PurchaseStatus.pending:
          break;
      }
      if (purchase.pendingCompletePurchase &&
          purchase.status != PurchaseStatus.purchased &&
          purchase.status != PurchaseStatus.restored) {
        try {
          await _store.completePurchase(purchase);
        } catch (_) {}
      }
    }
  }

  Future<void> _verifyAndComplete(PurchaseDetails purchase) async {
    final baseUrl = _baseUrl;
    final token = _accountToken;
    final workspace = _workspace;
    if (baseUrl == null || token == null || workspace == null) return;
    _busy = true;
    _error = null;
    notifyListeners();
    try {
      final platform = Platform.isAndroid ? 'google' : 'apple';
      final receipt = platform == 'google'
          ? jsonEncode({
              'purchaseToken':
                  purchase.verificationData.serverVerificationData,
              'productId': purchase.productID,
            })
          : purchase.verificationData.serverVerificationData;
      await _client.consoleStoreVerify(
        baseUrl,
        token,
        workspace: workspace,
        platform: platform,
        receipt: receipt,
      );
      _outcome = purchase.status == PurchaseStatus.restored
          ? BillingOutcome.restored
          : BillingOutcome.purchased;
      await refreshStatus();
    } on ApiError catch (error) {
      if (error.status == 409) {
        _fail('This workspace already has a subscription.');
      } else {
        _fail(error.message);
      }
      _outcome = BillingOutcome.failed;
    } finally {
      // Complete only after the server answered: a crash before this
      // redelivers the receipt, and the grant is idempotent.
      if (purchase.pendingCompletePurchase) {
        try {
          await _store.completePurchase(purchase);
        } catch (_) {}
      }
      _busy = false;
      notifyListeners();
    }
  }

  void _fail(String message) {
    _error = message;
    notifyListeners();
  }

  String _storeError(IAPError error) {
    final message = error.message;
    if (message.isNotEmpty) return message;
    return 'The store reported an error.';
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }
}
