import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maximus/settings/preferences.dart';
import 'package:maximus/api/models.dart';
import 'package:maximus/api/session_store.dart';
import 'package:maximus/auth/auth_state.dart';
import 'package:maximus/auth/forgot_password_page.dart';
import 'package:maximus/auth/signin_page.dart';
import 'package:maximus/auth/welcome_page.dart';
import 'package:maximus/home/home_page.dart';
import 'package:maximus/main.dart';
import 'package:maximus/theme/tokens.dart';

import 'fake_api.dart';

Widget _app(AuthState auth) => MaterialApp(
  theme: MaxTokens.light(),
  home: ListenableBuilder(
    listenable: auth,
    builder: (_, _) => auth.active == null
        ? WelcomePage(auth: auth)
        : HomePage(auth: auth, prefs: AppPreferences()),
  ),
);

void main() {
  testWidgets('welcome shows with no servers, home after pairing', (
    tester,
  ) async {
    final store = MemorySessionStore();
    final auth = AuthState(store: store, client: FakeApi());
    await auth.load();
    await tester.pumpWidget(_app(auth));
    expect(find.text('Sign in'), findsOneWidget);
    expect(find.text('Create account'), findsOneWidget);

    // Simulate a completed pairing through the real load path.
    await store.saveServer(
      const ServerRef(
        id: 'h',
        name: 'Home',
        baseUrl: 'https://h.example',
        companionToken: 'tok',
      ),
    );
    await auth.load();
    await tester.pump();
    await tester.pumpAndSettle();
    expect(find.text('Search'), findsOneWidget);
  });

  testWidgets('sign-in and create account switch on the same screen', (
    tester,
  ) async {
    final auth = AuthState(store: MemorySessionStore(), client: FakeApi());
    await auth.load();
    await tester.pumpWidget(
      MaterialApp(theme: MaxTokens.light(), home: SignInPage(auth: auth)),
    );
    await tester.pumpAndSettle();
    expect(find.text('New here?'), findsOneWidget);
    await tester.tap(find.text('Create account'));
    await tester.pump();
    expect(find.text('Already have an account?'), findsOneWidget);
    expect(find.text('Create account'), findsWidgets);
    await tester.tap(find.text('Sign in'));
    await tester.pump();
    expect(find.text('New here?'), findsOneWidget);
    expect(find.text('Forgot password?'), findsOneWidget);
  });

  testWidgets('forgot password emails a link and saves a new password', (tester) async {
    final api = FakeApi();
    final auth = AuthState(store: MemorySessionStore(), client: api);
    await auth.load();
    await tester.pumpWidget(
      MaterialApp(theme: MaxTokens.light(), home: SignInPage(auth: auth)),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Forgot password?'));
    await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextField, 'Email'), 'ada@example.com');
    await tester.tap(find.text('Email reset link'));
    await tester.pumpAndSettle();
    expect(api.resetEmail, 'ada@example.com');
    expect(find.textContaining('the link is on its way'), findsOneWidget);

    const link = 'https://app.meetnote.cc/reset?token=abc.def';
    expect(passwordResetToken(link), 'abc.def');
    await tester.enterText(find.widgetWithText(TextField, 'Reset link'), link);
    await tester.enterText(find.widgetWithText(TextField, 'New password'), 'brand-new-secret');
    await tester.tap(find.text('Save password'));
    await tester.pumpAndSettle();
    expect(api.resetToken, 'abc.def');
    expect(api.resetPasswordValue, 'brand-new-secret');
    expect(find.text('Back to sign in'), findsOneWidget);
  });

  testWidgets('MaximusApp gates on load then shows welcome', (tester) async {
    final auth = AuthState(store: MemorySessionStore(), client: FakeApi());
    await auth.load();
    await tester.pumpWidget(MaximusApp(auth: auth));
    await tester.pumpAndSettle();
    expect(find.text('Your proactive AI teammate.'), findsOneWidget);
  });

  testWidgets('load refreshes scopes from the live session', (tester) async {
    final store = MemorySessionStore();
    await store.saveServer(
      const ServerRef(
        id: 'h',
        name: 'Home',
        baseUrl: 'https://h.example',
        companionToken: 'tok',
      ),
    );
    final auth = AuthState(store: store, client: FakeApi());
    await auth.load();
    expect(auth.isAdmin, isTrue);
    expect(auth.scopes, containsAll(['admin', 'client']));
  });
}
