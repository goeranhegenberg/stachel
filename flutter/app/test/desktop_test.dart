// Desktop-Teile der App (docs/release/desktop.md): eigenes URL-Schema stachel:// und die Dateitypen beim Hineinziehen.
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel/desktop.dart';
import 'package:stachel/links.dart';

void main() {
  const base = 'https://stachel.intsode.com';

  test('stachel://<host>/<pfad> ist derselbe Link wie https://<host>/<pfad>', () {
    final links = StachelAppLinks(base);
    expect(links.handle(Uri.parse('stachel://stachel.intsode.com/b/AbCdEf123456')), isTrue);
    expect(links.take(), const BoardAppLink('AbCdEf123456'));
    expect(links.handle(Uri.parse('stachel://stachel.intsode.com/app/b/AbCdEf123456?o=Obj123456789')), isTrue);
    expect(links.take(), const BoardAppLink('AbCdEf123456', 'Obj123456789'));
    // another instance or another scheme: not ours
    expect(links.handle(Uri.parse('stachel://example.org/b/AbCdEf123456')), isFalse);
    expect(links.handle(Uri.parse('other://stachel.intsode.com/b/AbCdEf123456')), isFalse);
  });

  test('stachel:// folgt dem Schema der Instanz (Sandbox über http)', () {
    final links = StachelAppLinks('http://127.0.0.1:8871');
    expect(links.handle(Uri.parse('stachel://127.0.0.1:8871/b/AbCdEf123456')), isTrue);
    expect(links.take(), const BoardAppLink('AbCdEf123456'));
  });

  test('Dateitypen beim Hineinziehen', () {
    expect(droppedMime('Foto.JPG'), 'image/jpeg');
    expect(droppedMime('plan.png'), 'image/png');
    expect(droppedMime('a.webp'), 'image/webp');
    expect(droppedMime('Ablauf.pdf'), 'application/pdf');
    expect(droppedMime('notizen.txt'), 'text/plain');
    expect(droppedMime('README'), 'application/octet-stream');
  });

  test('unter flutter test gilt die App als Handy', () => expect(isDesktop, isFalse));
}
