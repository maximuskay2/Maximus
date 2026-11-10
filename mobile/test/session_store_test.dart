import 'package:flutter_test/flutter_test.dart';
import 'package:maximus/api/models.dart';
import 'package:maximus/api/session_store.dart';

void main() {
  test('memory store saves, lists, and removes servers', () async {
    final store = MemorySessionStore();
    expect(await store.servers(), isEmpty);
    await store.saveServer(
      const ServerRef(id: 's1', name: 'Home', baseUrl: 'https://h.example'),
    );
    await store.saveServer(
      const ServerRef(id: 's2', name: 'VPS', baseUrl: 'https://v.example'),
    );
    expect((await store.servers()).map((s) => s.id), ['s1', 's2']);
    // Re-save replaces.
    await store.saveServer(
      const ServerRef(
        id: 's1',
        name: 'Home 2',
        baseUrl: 'https://h.example',
      ),
    );
    expect((await store.servers()).map((s) => s.name), ['VPS', 'Home 2']);
    await store.removeServer('s2');
    expect((await store.servers()).map((s) => s.id), ['s1']);
  });

  test('memory store keeps the control-plane URL', () async {
    final store = MemorySessionStore();
    expect(await store.controlPlaneUrl(), isNull);
    await store.saveControlPlaneUrl('http://127.0.0.1:8787');
    expect(await store.controlPlaneUrl(), 'http://127.0.0.1:8787');
    await store.saveControlPlaneUrl(null);
    expect(await store.controlPlaneUrl(), isNull);
  });
}
