import 'package:flutter_test/flutter_test.dart';
import 'package:maximus/chat/attachment_kind.dart';

void main() {
  test('a png is an image from a Windows path, a Mac path, or a bare name', () {
    for (final sample in [
      attachmentKind(name: r'C:\Users\me\ios logo-1.PNG'),
      attachmentKind(name: 'ios logo-1', path: '/private/var/mobile/ios logo-1.png'),
      attachmentKind(name: 'ios logo-1.png.', extension: 'png'),
    ]) {
      expect(sample?.mime, 'image/png');
      expect(sample?.image, isTrue);
    }
    expect(attachmentKind(name: r'C:\Users\me\ios logo-1.PNG')?.leaf, 'ios logo-1.PNG');
  });

  test('documents and audio use the filename when the system type is missing', () {
    expect(attachmentKind(name: r'D:\docs\Quarterly plan.pdf')?.mime, 'application/pdf');
    expect(attachmentKind(name: 'Voice note.opus')?.image, isFalse);
    expect(attachmentKind(name: 'clip.mp4')?.mime, 'video/mp4');
    expect(attachmentKind(name: 'run.exe'), isNull);
  });
}