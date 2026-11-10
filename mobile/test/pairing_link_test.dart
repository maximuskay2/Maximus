import 'package:flutter_test/flutter_test.dart';
import 'package:maximus/auth/pairing_link.dart';

void main() {
  test('parses a server link', () {
    final parsed = ParsedPairing.tryParse(
      'https://maus.example.com/pair#code=RR8Y-BLR6-H939',
    )!;
    expect(parsed.serverUrl, 'https://maus.example.com');
    expect(parsed.code, 'RR8Y-BLR6-H939');
  });

  test('parses a bare code with and without dashes', () {
    expect(
      ParsedPairing.tryParse('rr8y-blr6-h939')!.code,
      'RR8Y-BLR6-H939',
    );
    expect(
      ParsedPairing.tryParse('RR8YBLR6H939')!.code,
      'RR8Y-BLR6-H939',
    );
    expect(ParsedPairing.tryParse('123456')!.code, '123456');
  });

  test('parses a native link with an https address', () {
    final parsed = ParsedPairing.tryParse(
      'maximus://pair?address=https%3A%2F%2Fmaus.example.com'
      '&token=maximus_pair_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      '&code=123456&name=Home',
    )!;
    expect(parsed.serverUrl, 'https://maus.example.com');
    expect(parsed.code, '123456');
    expect(parsed.name, 'Home');
  });

  test('rejects junk', () {
    expect(ParsedPairing.tryParse(''), isNull);
    expect(ParsedPairing.tryParse('hello world'), isNull);
    expect(ParsedPairing.tryParse('https://x.example/pair'), isNull);
    expect(
      ParsedPairing.tryParse('https://x.example/pair#code=nope'),
      isNull,
    );
    expect(ParsedPairing.tryParse('maximus://pair'), isNull);
  });
}
