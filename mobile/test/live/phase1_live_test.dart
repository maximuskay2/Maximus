import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:maximus/api/client.dart';
import 'package:maximus/api/session_store.dart';
import 'package:maximus/auth/auth_state.dart';

/// Live E2E for Phase 1 against a real harness. Skips unless both vars set:
///   MAXIMUS_E2E_BASE=http://127.0.0.1:8841 MAXIMUS_E2E_CODE=XXXX-... flutter test test/live/
/// Mint the code with:
///   curl -X POST $MAXIMUS_E2E_BASE/api/auth/pairing -H 'content-type: application/json' -d '{}'
void main() {
  final base = Platform.environment['MAXIMUS_E2E_BASE'];
  final code = Platform.environment['MAXIMUS_E2E_CODE'];

  test('pair by code, then list bots', skip: base == null || code == null, () async {
    final client = MaximusClient();
    try {
      expect(await client.probe(base!), isTrue);
      final auth = AuthState(store: MemorySessionStore(), client: client);
      await auth.load();
      await auth.pair(baseUrl: base, code: code!, label: 'e2e-phone');
      expect(auth.active, isNotNull);
      expect(auth.scopes, isNotEmpty);
      client.setCompanionToken(auth.active?.companionToken);
      final bots = await client.bots(base);
      expect(bots, isNotEmpty);
      // ignore: avoid_print
      print('paired scopes=${auth.scopes} bots=${bots.length}');
    } finally {
      client.close();
    }
  });
}
