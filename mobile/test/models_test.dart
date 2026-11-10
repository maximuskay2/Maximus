import 'package:flutter_test/flutter_test.dart';
import 'package:maximus/api/models.dart';

void main() {
  test('BotSummary tolerates missing optionals', () {
    final bot = BotSummary.fromJson({'id': 'b1'});
    expect(bot.id, 'b1');
    expect(bot.name, '');
    expect(bot.notifications, isTrue);
    expect(bot.unread, isFalse);
    expect(bot.avatarUrl, isNull);
  });

  test('ChatMessage decodes attachments and drops malformed ones', () {
    final message = ChatMessage.fromJson({
      'id': 'm1',
      'role': 'bot',
      'kind': 'text',
      'text': 'hi',
      'attachments': [
        {'kind': 'image', 'path': '/a.png', 'mime': 'image/png'},
        {'kind': 'audio', 'path': '/v.mp3', 'mime': 'audio/mpeg',
          'durationMs': 1200, 'text': 'hello'},
        {'kind': 'image'}, // malformed: dropped
        'junk', // dropped
      ],
      'card': {'options': []},
    });
    expect(message.attachments, hasLength(2));
    expect(message.attachments.first.kind, 'image');
    expect(message.attachments[1].durationMs, 1200);
    expect(message.hasCard, isTrue);
  });

  test('ServerRef round-trips through JSON', () {
    const server = ServerRef(
      id: 's1',
      name: 'Home',
      baseUrl: 'https://home.example',
      companionToken: 'tok',
    );
    final back = ServerRef.fromJson(server.toJson());
    expect(back.id, 's1');
    expect(back.companionToken, 'tok');
  });

  test('ApiError classifies statuses', () {
    expect(const ApiError(401, 'x').unauthorized, isTrue);
    expect(const ApiError(403, 'x').forbidden, isTrue);
    expect(const ApiError(429, 'x').rateLimited, isTrue);
    expect(const ApiError(500, 'x').unauthorized, isFalse);
  });
}
