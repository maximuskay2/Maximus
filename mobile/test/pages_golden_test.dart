import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maximus/settings/preferences.dart';
import 'package:maximus/api/client.dart';
import 'package:maximus/api/models.dart';
import 'package:maximus/api/session_store.dart';
import 'package:maximus/auth/auth_state.dart';
import 'package:maximus/auth/signin_page.dart';
import 'fake_api.dart';
import 'package:maximus/auth/welcome_page.dart';
import 'package:maximus/home/home_page.dart';
import 'package:maximus/theme/tokens.dart';

Future<AuthState> _authWith({bool paired = false}) async {
  final store = MemorySessionStore();
  if (paired) {
    await store.saveServer(
      const ServerRef(id: 'h', name: 'Home', baseUrl: 'https://h.example'),
    );
  }
  final auth = AuthState(store: store, client: MaximusClient());
  await auth.load();
  return auth;
}

Future<void> _pump(WidgetTester tester, Widget page) async {
  await tester.binding.setSurfaceSize(const Size(390, 844));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(MaterialApp(theme: MaxTokens.light(), home: page));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('welcome golden', (tester) async {
    await _pump(tester, WelcomePage(auth: await _authWith()));
    await expectLater(
      find.byType(WelcomePage),
      matchesGoldenFile('goldens/welcome.png'),
    );
  });

  testWidgets('sign-in golden', (tester) async {
    final auth = AuthState(store: MemorySessionStore(), client: FakeApi());
    await auth.load();
    await _pump(tester, SignInPage(auth: auth));
    await expectLater(
      find.byType(SignInPage),
      matchesGoldenFile('goldens/signin.png'),
    );
  });

  testWidgets('home golden', (tester) async {
    await _pump(tester, HomePage(auth: await _authWith(paired: true), prefs: AppPreferences()));
    await expectLater(
      find.byType(HomePage),
      matchesGoldenFile('goldens/home.png'),
    );
  });
}
