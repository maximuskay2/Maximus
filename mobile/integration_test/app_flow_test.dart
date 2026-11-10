import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:maximus/main.dart' as app;

/// On-device E2E: welcome → pair by live code → home → thread → profile →
/// search. Needs the mobile E2E harness on the host (port 8841); the iOS
/// simulator reaches it at 127.0.0.1. Screenshots leave via the log as
/// base64 `ITSHOT` chunks (the test app is uninstalled after the run).
const _base = 'http://127.0.0.1:8841';

Future<String> _mintCode() async {
  final http = HttpClient();
  try {
    final request = await http.postUrl(Uri.parse('$_base/api/auth/pairing'));
    request.headers.contentType = ContentType.json;
    // Owner scopes: the run covers admin-only create flows too.
    request.write('{"label":"device run","scopes":["client","admin"]}');
    final response = await request.close();
    final body = jsonDecode(await utf8.decoder.bind(response).join())
        as Map<String, Object?>;
    return body['code']! as String;
  } finally {
    http.close();
  }
}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  Future<void> shot(String name) async {
    final bytes = await binding.takeScreenshot(name);
    // The test app is uninstalled after the run, so the PNG leaves via
    // the log in base64 chunks. Decode with: grep ITSHOT run.log.
    final encoded = base64Encode(bytes);
    // ignore: avoid_print
    print('ITSHOT-START:$name');
    for (var i = 0; i < encoded.length; i += 2000) {
      // ignore: avoid_print
      print('ITSHOT:${encoded.substring(i, min(i + 2000, encoded.length))}');
    }
    // ignore: avoid_print
    print('ITSHOT-END:$name');
  }

  testWidgets('full read flow on live data', (tester) async {
    // Keychain survives uninstalls — start every run unpaired.
    await const FlutterSecureStorage().deleteAll();
    app.main();
    await tester.pumpAndSettle(const Duration(seconds: 30));
    expect(find.text('Your proactive AI teammate.'), findsOneWidget);
    await shot('welcome');

    await tester.tap(find.text('Pair a server'));
    await tester.pumpAndSettle();
    expect(find.text('Pair this phone'), findsOneWidget);

    // The URL field is prefilled with the dev harness default; point it
    // at the E2E harness port instead.
    final fields = find.byType(TextField);
    expect(fields, findsNWidgets(2));
    // First TextField is the server address.
    await tester.enterText(fields.first, _base);
    final code = await _mintCode();
    // Second TextField is the pairing code.
    await tester.enterText(fields.at(1), code);
    await tester.tap(find.text('Pair this phone'));
    await tester.pumpAndSettle(const Duration(seconds: 30));
    expect(find.text('Briefing'), findsOneWidget);
    await shot('home');

    // Open the first recent thread.
    final recent = find.byType(ListTile).first;
    await tester.tap(recent);
    await tester.pumpAndSettle(const Duration(seconds: 30));
    await shot('thread');

    // Phase 3: send a message through the composer (optimistic echo).
    const probe = 'hello from the device run';
    await tester.enterText(find.byType(TextField).first, probe);
    await tester.tap(find.byTooltip('Send'));
    await tester.pumpAndSettle(const Duration(seconds: 30));
    expect(find.textContaining(probe), findsWidgets);

    // Phase 3: react to the first message via the emoji sheet.
    await tester.tap(find.byTooltip('React').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('👍').first);
    await tester.pumpAndSettle(const Duration(seconds: 30));
    await shot('thread-reacted');
    await tester.pageBack();
    await tester.pumpAndSettle();

    // Bots tab → first bot → profile → library.
    await tester.tap(find.text('Bots'));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(ListTile).first);
    await tester.pumpAndSettle();
    expect(find.text('Threads'), findsOneWidget);
    await shot('profile');
    await tester.tap(find.text('Library'));
    await tester.pumpAndSettle();
    await shot('library');
    await tester.pageBack();
    await tester.pumpAndSettle();

    // Phase 3: create a room from the Bots tab (create + setup + list).
    // Already on the Bots tab (ambiguous with its AppBar title) — tap the
    // bottom-nav destination explicitly.
    await tester.tap(find.widgetWithText(NavigationDestination, 'Bots'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('New group'));
    await tester.pumpAndSettle();
    expect(find.text('New group chat'), findsOneWidget);
    await tester.enterText(find.byType(TextField).first, 'Device Room');
    await tester.tap(find.byType(CheckboxListTile).first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Create'));
    await tester.pumpAndSettle(const Duration(seconds: 30));
    expect(find.text('Device Room'), findsWidgets);
    await shot('groups');

    // Search tab.
    await tester.tap(find.text('Search'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(SearchBar), 'hello');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pumpAndSettle(const Duration(seconds: 30));
    await shot('search');

    // Phase 6: You tab → Routines → create, pause, delete (harness left clean).
    await tester.tap(find.widgetWithText(NavigationDestination, 'You'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Routines'));
    await tester.pumpAndSettle(const Duration(seconds: 30));
    await shot('routines');
    await tester.tap(find.text('New'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, 'Device routine');
    await tester.enterText(
      find.byType(TextField).at(1),
      'Check in on open work.',
    );
    await tester.tap(find.text('Create'));
    await tester.pumpAndSettle(const Duration(seconds: 30));
    expect(find.text('Device routine'), findsWidgets);
    await tester.tap(find.byTooltip('Details').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Pause'));
    await tester.pumpAndSettle(const Duration(seconds: 30));
    await tester.tap(find.text('Delete'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Delete'));
    await tester.pumpAndSettle(const Duration(seconds: 30));
    expect(find.text('Device routine'), findsNothing);
    // Back out to the You tab (the delete may leave the detail sheet open).
    for (var i = 0; i < 3; i++) {
      if (find.widgetWithText(AppBar, 'Routines').evaluate().isEmpty) break;
      await tester.pageBack();
      await tester.pumpAndSettle();
    }
    // The Automations tiles sit below the fold in a lazy list: scroll
    // them into the tree (ensureVisible cannot find unbuilt tiles).
    await tester.scrollUntilVisible(
      find.text('Watch a browser'),
      300,
    );

    // Phase 6: Watch a browser → first bot → viewer (no session: error state).
    await tester.tap(find.text('Watch a browser'));
    await tester.pumpAndSettle();
    expect(find.text('Whose browser?'), findsOneWidget);
    await tester.tap(find.byType(ListTile).last);
    await tester.pumpAndSettle(const Duration(seconds: 30));
    expect(find.textContaining('\u2019s browser'), findsOneWidget);
    await shot('browser');
    await tester.pageBack();
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(find.text('Phone apps'), 300);

    // Phase 7: Workspace shows the email sign-in (OTP codes arrive by
    // email, so the device run never completes sign-in).
    await tester.scrollUntilVisible(find.text('Workspace'), 300);
    await tester.tap(find.text('Workspace'));
    await tester.pumpAndSettle(const Duration(seconds: 30));
    expect(find.text('Your Maximus workspace'), findsOneWidget);
    await shot('workspace');
    await tester.pageBack();
    await tester.pumpAndSettle();

    // Phase 7: Settings hub + account, devices, usage reads.
    await tester.scrollUntilVisible(find.text('Settings'), 300);
    await tester.tap(find.text('Settings'));
    await tester.pumpAndSettle(const Duration(seconds: 30));
    expect(find.text('Bot computer'), findsOneWidget);
    await shot('settings');
    await tester.tap(find.text('Account'));
    await tester.pumpAndSettle(const Duration(seconds: 30));
    expect(find.text('Phone'), findsOneWidget);
    await tester.pageBack();
    await tester.pumpAndSettle();
    await tester.tap(find.text('Devices'));
    await tester.pumpAndSettle(const Duration(seconds: 30));
    expect(find.text('Phone'), findsWidgets);
    await tester.pageBack();
    await tester.pumpAndSettle();
    await tester.tap(find.text('Usage'));
    await tester.pumpAndSettle(const Duration(seconds: 30));
    expect(find.text('This month'), findsOneWidget);
    await shot('usage');
    await tester.pageBack();
    await tester.pumpAndSettle();
    await tester.pageBack();
    await tester.pumpAndSettle();

    // Phase 6: Phone apps page renders (registration is covered live;
    // the device run never grants OS permissions).
    await tester.tap(find.text('Phone apps'));
    await tester.pumpAndSettle(const Duration(seconds: 30));
    expect(find.text('This phone'), findsOneWidget);
    await shot('phone-apps');
  });
}
