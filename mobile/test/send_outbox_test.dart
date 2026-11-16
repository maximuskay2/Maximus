import 'package:flutter_test/flutter_test.dart';
import 'package:maximus/chat/send_outbox.dart';

void main() {
  test('enqueue survives a new SendOutbox on the same map', () async {
    final memory = <String, String>{};
    final first = SendOutbox(memory: memory);
    await first.enqueue(
      const OutboxItem(
        sendId: 'aaaaaaaaaaaaaaaa',
        threadId: 't1',
        botId: 'b1',
        text: 'queued while offline',
      ),
    );
    final second = SendOutbox(memory: memory);
    final pending = await second.pending('t1');
    expect(pending, hasLength(1));
    expect(pending.single.text, 'queued while offline');
    expect(pending.single.sendId, 'aaaaaaaaaaaaaaaa');
    await second.remove('t1', 'aaaaaaaaaaaaaaaa');
    expect(await first.pending('t1'), isEmpty);
  });
}
