import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api/client.dart';
import 'billing_service.dart';
import 'paywall_page.dart';

const _chosenKey = 'maximus.plan.chosen';

/// After sign-in, a person stays on the plan list until they pick one.
/// [force] opens it again from the account menu, and that visit can close.
Future<void> askToSubscribe(
  BuildContext context,
  MaximusApi client, {
  bool force = false,
  String? baseUrl,
  String? timeZone,
}) async {
  final prefs = await SharedPreferences.getInstance();
  final chosen = prefs.getBool(_chosenKey) == true;
  if (!force && chosen) return;
  if (!context.mounted) return;
  final billing = BillingService(client: client);
  final picked = await Navigator.of(context).push<bool>(
    MaterialPageRoute<bool>(
      builder: (_) => PaywallPage(
        billing: billing,
        workspaceName: 'Maximus',
        client: client,
        baseUrl: baseUrl,
        timeZone: timeZone,
        required: !force && !chosen,
      ),
    ),
  );
  billing.dispose();
  if (picked == true) await prefs.setBool(_chosenKey, true);
}
