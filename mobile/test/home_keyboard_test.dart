import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maximus/api/models.dart';
import 'package:maximus/api/session_store.dart';
import 'package:maximus/auth/auth_state.dart';
import 'package:maximus/home/home_page.dart';
import 'package:maximus/settings/preferences.dart';
import 'package:maximus/theme/tokens.dart';

import 'fake_api.dart';

void main() {
  testWidgets('tapping a bot row dismisses the home search keyboard', (
    tester,
  ) async {
    final store = MemorySessionStore();
    await store.saveServer(
      const ServerRef(
        id: 'h',
        name: 'Home',
        baseUrl: 'https://h.example',
        companionToken: 'maximus_sess_test',
      ),
    );
    final auth = AuthState(store: store, client: FakeApi());
    await auth.load();

    await tester.pumpWidget(
      MaterialApp(
        theme: MaxTokens.light(),
        home: HomePage(auth: auth, prefs: AppPreferences()),
      ),
    );
    await tester.pump();
    for (var i = 0; i < 20 && find.text('Max').evaluate().isEmpty; i++) {
      await tester.pump(const Duration(milliseconds: 20));
    }
    expect(find.text('Max'), findsWidgets);

    final editable = find.byType(EditableText);
    expect(editable, findsOneWidget);
    final node = tester.widget<EditableText>(editable).focusNode!;

    await tester.tap(find.byType(TextField));
    await tester.pump();
    expect(node.hasFocus, isTrue);

    await tester.tap(find.text('Max').first);
    await tester.pump();
    expect(node.hasFocus, isFalse);
  });
}
