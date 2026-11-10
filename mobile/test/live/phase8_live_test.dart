import 'package:flutter_test/flutter_test.dart';
import 'package:maximus/api/client.dart';
import 'package:maximus/api/models.dart';
import 'dart:io';

/// Live E2E for Phase 8 billing. Needs a console harness:
///   MAXIMUS_E2E_CONSOLE=http://127.0.0.1:8851 flutter test test/live/
/// Real purchases need store products + owner credentials, which no
/// harness has — so live proves the fail-closed contracts, while the
/// worker suite (7 tests) and fakes prove the grant flow end to end.
void main() {
  final console = Platform.environment['MAXIMUS_E2E_CONSOLE'];

  test('store verify fails closed without owner credentials',
      skip: console == null, () async {
    final base = console!;
    final client = MaximusClient();
    try {
      // No account token at all: the proxy refuses first.
      try {
        await client.consoleStoreStatus(base, 'bogus', 'acme');
        fail('expected a bogus token to fail');
      } on ApiError catch (error) {
        expect(error.status == 401 || error.status == 404, isTrue);
      }
      // Even well-formed verify calls fail: the worker has no
      // App Store / Play credentials in dev.
      try {
        await client.consoleStoreVerify(
          base,
          'bogus',
          workspace: 'acme',
          platform: 'apple',
          receipt: 'tx-1',
        );
        fail('expected verify to fail closed');
      } on ApiError catch (error) {
        expect(
          error.status == 401 ||
              error.status == 404 ||
              error.status == 503,
          isTrue,
          reason: 'status=${error.status}',
        );
      }
      // ignore: avoid_print
      print('phase8 billing fail-closed live ok');
    } finally {
      client.close();
    }
  });

  test('store webhooks fail closed', skip: console == null, () async {
    // The webhooks live on the worker, not the server proxy: derive
    // the worker base from the harness control-plane URL.
    final worker = Platform.environment['MAXIMUS_E2E_WORKER'] ??
        'http://127.0.0.1:8787';
    final http = HttpClient();
    try {
      Future<int> post(String path, Object body) async {
        final req = await http.postUrl(Uri.parse('$worker$path'));
        req.headers.contentType = ContentType.json;
        req.write(body is String ? body : 'null');
        final res = await req.close();
        await res.drain();
        return res.statusCode;
      }

      // No credentials configured in dev: 503, never a grant.
      expect(await post('/api/billing/webhook/apple', '{}'), 503);
      expect(
        await post('/api/billing/webhook/google?secret=x', '{}'),
        503,
      );
      // ignore: avoid_print
      print('phase8 webhooks fail-closed live ok');
    } finally {
      http.close();
    }
  });
}
