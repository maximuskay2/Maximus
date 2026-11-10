import 'dart:async';

import 'package:in_app_purchase_platform_interface/in_app_purchase_platform_interface.dart';

/// Controllable store front for billing tests. Purchases are emitted
/// manually so tests drive buy → verify → complete deterministically.
class FakeIAPPlatform extends InAppPurchasePlatform {
  FakeIAPPlatform({this.available = true, List<ProductDetails>? products})
    : products = products ?? _defaultProducts;

  static List<ProductDetails> get _defaultProducts => [
    ProductDetails(
      id: 'maximus_plus_monthly',
      title: 'Plus',
      description: 'Plus monthly',
      price: '\$8',
      rawPrice: 8,
      currencyCode: 'USD',
    ),
    ProductDetails(
      id: 'maximus_pro_monthly',
      title: 'Pro',
      description: 'Pro monthly',
      price: '\$20',
      rawPrice: 20,
      currencyCode: 'USD',
    ),
  ];

  bool available;
  List<ProductDetails> products;
  final purchases = StreamController<List<PurchaseDetails>>.broadcast();
  final List<PurchaseDetails> completed = [];
  final List<String> bought = [];
  bool restored = false;
  IAPError? queryError;

  static FakeIAPPlatform install({bool available = true}) {
    final fake = FakeIAPPlatform(available: available);
    InAppPurchasePlatform.instance = fake;
    return fake;
  }

  @override
  Stream<List<PurchaseDetails>> get purchaseStream => purchases.stream;

  @override
  Future<bool> isAvailable() async => available;

  @override
  Future<ProductDetailsResponse> queryProductDetails(
    Set<String> identifiers,
  ) async {
    if (queryError != null) {
      return ProductDetailsResponse(
        productDetails: const [],
        notFoundIDs: identifiers.toList(),
        error: queryError,
      );
    }
    final found = [
      for (final product in products)
        if (identifiers.contains(product.id)) product,
    ];
    return ProductDetailsResponse(
      productDetails: found,
      notFoundIDs: [
        for (final id in identifiers)
          if (found.every((p) => p.id != id)) id,
      ],
    );
  }

  @override
  Future<bool> buyNonConsumable({
    required PurchaseParam purchaseParam,
  }) async {
    bought.add(purchaseParam.productDetails.id);
    return true;
  }

  @override
  @override
  Future<bool> buyConsumable({
    required PurchaseParam purchaseParam,
    bool autoConsume = true,
  }) async => false;

  @override
  Future<void> completePurchase(PurchaseDetails purchase) async {
    purchase.pendingCompletePurchase = false;
    completed.add(purchase);
  }

  @override
  Future<void> restorePurchases({String? applicationUserName}) async {
    restored = true;
  }

  PurchaseDetails emitPurchase({
    required String productId,
    PurchaseStatus status = PurchaseStatus.purchased,
    String receipt = 'receipt-jws',
  }) {
    final purchase = PurchaseDetails(
      productID: productId,
      purchaseID: 'p-$productId',
      transactionDate: DateTime.now().toIso8601String(),
      verificationData: PurchaseVerificationData(
        localVerificationData: receipt,
        serverVerificationData: receipt,
        source: 'app_store',
      ),
      status: status,
    )..pendingCompletePurchase = true;
    purchases.add([purchase]);
    return purchase;
  }

  void close() => purchases.close();
}
