/// Phase 8: App Store / Play product ids for monthly individual plans.
///
/// OWNER: create these exact ids in App Store Connect and Play Console
/// (auto-renewable subscriptions, one month) and mirror them in
/// `cloudflare/control-plane/src/store-billing.ts` (STORE_PRODUCT_PLANS).
/// Until the products exist in the stores, the paywall reports the
/// store as unavailable instead of selling anything.
class BillingProducts {
  BillingProducts._();

  /// Plus → the team seat, at the Plus Muse ration from Admin → Rates.
  static const plusMonthly = 'maximus_plus_monthly';

  /// Pro → the business seat, at the Pro Muse ration from Admin → Rates.
  static const proMonthly = 'maximus_pro_monthly';

  static const all = {plusMonthly, proMonthly};

  static String planFor(String productId) => switch (productId) {
    plusMonthly => 'team',
    proMonthly => 'business',
    _ => 'free',
  };
}
