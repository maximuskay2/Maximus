import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maximus/auth/splash_page.dart';
import 'package:maximus/theme/tokens.dart';

void main() {
  testWidgets('SplashPage shows mark and wordmark', (tester) async {
    await tester.pumpWidget(
      MaterialApp(theme: MaxTokens.light(), home: const SplashPage()),
    );
    await tester.pump();
    expect(find.text('Maximus'), findsOneWidget);
    expect(find.byType(Image), findsOneWidget);
    expect(find.text('Your proactive AI teammate'), findsNothing);
    expect(find.text('MaximusBot'), findsNothing);
    await tester.pump(const Duration(milliseconds: 300));
  });

  testWidgets('SplashGate holds then reveals child', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: MaxTokens.light(),
        home: const SplashGate(
          ready: true,
          minDuration: Duration(milliseconds: 400),
          child: Text('ready-child'),
        ),
      ),
    );
    await tester.pump();
    expect(find.text('Maximus'), findsOneWidget);
    expect(find.text('ready-child'), findsNothing);

    await tester.pump(const Duration(milliseconds: 450));
    expect(find.text('ready-child'), findsOneWidget);
    expect(find.text('Maximus'), findsNothing);
  });
}
