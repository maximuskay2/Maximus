import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:maximus/api/client.dart';
import 'package:maximus/api/models.dart';

/// Live E2E for Phase 7 settings against a real harness. Skips unless:
///   MAXIMUS_E2E_BASE=http://127.0.0.1:8841 flutter test test/live/
/// Uses loopback owner trust. Console (control-plane) tests need a
/// harness started with MAXIMUS_CONTROL_PLANE_URL and prove the
/// fail-closed contracts — OTP codes arrive by email, which a harness
/// cannot read, so authed console flows are covered by fakes.
void main() {
  final base = Platform.environment['MAXIMUS_E2E_BASE'];

  test('session, devices, usage, presence, computer', skip: base == null,
      () async {
    final client = MaximusClient();
    try {
      final session = await client.authSession(base!);
      expect(session.scopes, isNotEmpty);

      // Devices: mint a pairing code, redeem it, see it, revoke it.
      final http = HttpClient();
      final mint = await http.postUrl(
        Uri.parse('$base/api/auth/pairing'),
      );
      mint.headers.contentType = ContentType.json;
      mint.write('{"label":"e2e-phase7-device"}');
      final mintRes = await mint.close();
      final issued =
          jsonDecode(await utf8.decoder.bind(mintRes).join())
              as Map<String, Object?>;
      http.close();
      final paired = await client.pair(
        base,
        code: issued['code']! as String,
        label: 'e2e-phase7-device',
      );
      expect(paired.token, isNotNull);
      var devices = await client.sessions(base);
      expect(
        devices.any((d) => d.label == 'e2e-phase7-device'),
        isTrue,
      );
      final victim = devices.firstWhere(
        (d) => d.label == 'e2e-phase7-device',
      );
      expect(await client.revokeSession(base, victim.id), isTrue);
      devices = await client.sessions(base);
      expect(devices.any((d) => d.id == victim.id), isFalse);
      expect(await client.revokeSession(base, victim.id), isFalse);

      // Usage: this month by bot (may be empty on a fresh harness).
      final now = DateTime.now();
      final month =
          '${now.year}-${now.month.toString().padLeft(2, '0')}';
      final report = await client.usageReport(
        base,
        from: '$month-01',
        to: '$month-${DateTime(now.year, now.month + 1, 0).day}',
      );
      expect(report.groupBy, 'bot');

      // Presence: a phone report is accepted.
      await client.presenceActive(
        base,
        timeZone: 'America/New_York',
        language: 'en',
      );

      // Bot computer: status answers (usually "not set up" here).
      final computer = await client.localComputer(base);
      expect(computer.available, isA<bool>());
      // ignore: avoid_print
      print('phase7 settings live ok (computer=${computer.state})');
    } finally {
      client.close();
    }
  });

  test('console proxy fails closed without a control plane',
      skip: base == null, () async {
    final client = MaximusClient();
    try {
      // The :8841 harness has no MAXIMUS_CONTROL_PLANE_URL: account
      // calls fail, but the public plan catalog is served locally.
      final plans = await client.consolePlans(base!);
      expect(plans, isNotEmpty);
      try {
        await client.consoleOtpStart(base, 'owner@example.test');
        fail('expected otp to fail without a control plane');
      } on ApiError catch (error) {
        expect(error.status == 502 || error.status == 503, isTrue);
      }
      // ignore: avoid_print
      print('phase7 console fail-closed live ok');
    } finally {
      client.close();
    }
  });

  test('console validates email before any control plane call',
      skip: base == null, () async {
    // Needs MAXIMUS_E2E_CONSOLE=http://127.0.0.1:8851 (a harness with
    // MAXIMUS_CONTROL_PLANE_URL=http://127.0.0.1:8787).
    final console = Platform.environment['MAXIMUS_E2E_CONSOLE'];
    if (console == null) return;
    final client = MaximusClient();
    try {
      try {
        await client.consoleOtpStart(console, 'not-an-email');
        fail('expected invalid email to be refused');
      } on ApiError catch (error) {
        expect(error.status, 400);
      }
      // A wrong code never verifies (rate-limited after a few tries;
      // one attempt is safe).
      try {
        await client.consoleOtpVerify(
          console,
          email: 'e2e-phase7@example.test',
          code: '000000',
        );
        fail('expected a wrong code to fail');
      } on ApiError catch (error) {
        expect(error.status == 400 || error.status == 401, isTrue);
      }
      // Authed reads refuse a bogus token.
      try {
        await client.consoleMemberships(console, 'bogus');
        fail('expected a bogus token to fail');
      } on ApiError catch (error) {
        expect(error.status == 401, isTrue);
      }
      // The public plan catalog answers.
      final plans = await client.consolePlans(console);
      expect(plans, isNotEmpty);
      // ignore: avoid_print
      print('phase7 console live ok (${plans.length} plans)');
    } finally {
      client.close();
    }
  });
}
