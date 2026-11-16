import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api/client.dart';
import '../engines/engines_page.dart';
import 'billing_service.dart';
import 'paywall_page.dart';

const _chosenKey = 'maximus.plan.chosen';

/// After sign-in, a person stays on the plan list until they pick one.
/// [force] opens it again from the account menu, and that visit can close.
/// A BYO pick opens [EnginesPage] so they can connect their own key next.
Future<void> askToSubscribe(
  BuildContext context,
  MaximusApi client, {
  bool force = false,
  String? baseUrl,
  String? timeZone,
  PaywallTrack initialTrack = PaywallTrack.muse,
}) async {
  final prefs = await SharedPreferences.getInstance();
  final chosen = prefs.getBool(_chosenKey) == true;
  final onAccount = !force && baseUrl != null && baseUrl.isNotEmpty
      ? await _chosenOnAccount(client, baseUrl)
      : false;
  if (!force && (chosen || onAccount)) {
    if (onAccount && !chosen) await prefs.setBool(_chosenKey, true);
    return;
  }
  if (!context.mounted) return;
  final billing = BillingService(client: client);
  final picked = await Navigator.of(context).push<PaywallResult>(
    MaterialPageRoute<PaywallResult>(
      builder: (_) => PaywallPage(
        billing: billing,
        workspaceName: 'Maximus',
        client: client,
        baseUrl: baseUrl,
        timeZone: timeZone,
        required: !force && !chosen,
        initialTrack: initialTrack,
      ),
    ),
  );
  billing.dispose();
  if (picked == null) return;
  await prefs.setBool(_chosenKey, true);
  if (!context.mounted) return;
  if (picked == PaywallResult.byo && baseUrl != null && baseUrl.isNotEmpty) {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => EnginesPage(client: client, baseUrl: baseUrl),
      ),
    );
  }
}

Future<bool> _chosenOnAccount(MaximusApi client, String baseUrl) async {
  try {
    final plan = await client.accountPlan(baseUrl);
    final choice = plan.choice;
    return choice != null && choice.isNotEmpty;
  } catch (_) {
    return false;
  }
}
