import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel/captcha.dart';
import 'package:stachel/links.dart';

const base = 'https://stachel.intsode.com';
const token = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd';

void main() {
  group('App-Links', () {
    test('Board, Objekt, Bestätigen, Zurücksetzen', () {
      expect(appLinkFrom(Uri.parse('$base/b/fest'), base), const BoardAppLink('fest'));
      expect(appLinkFrom(Uri.parse('$base/b/fest/?o=n_1'), base), const BoardAppLink('fest', 'n_1'));
      expect(appLinkFrom(Uri.parse('$base/?b=fest&o=n_1'), base), const BoardAppLink('fest', 'n_1'));
      expect(appLinkFrom(Uri.parse('$base/verify/$token'), base), const VerifyAppLink(token));
      expect(appLinkFrom(Uri.parse('$base/reset/$token'), base), const ResetAppLink(token));
      expect(appLinkFrom(Uri.parse('$base/?verify=$token'), base), const VerifyAppLink(token));
      expect(appLinkFrom(Uri.parse('$base/?reset=$token'), base), const ResetAppLink(token));
    });

    test('unter dem Pfad der Web-App (/app, STACHEL_BASE_PATH) genauso', () {
      expect(appLinkFrom(Uri.parse('$base/app/b/fest'), base), const BoardAppLink('fest'));
      expect(appLinkFrom(Uri.parse('$base/app/b/fest?o=n_1'), base), const BoardAppLink('fest', 'n_1'));
      expect(appLinkFrom(Uri.parse('$base/app/?b=fest&o=n_1'), base), const BoardAppLink('fest', 'n_1'));
      expect(appLinkFrom(Uri.parse('$base/app/verify/$token'), base), const VerifyAppLink(token));
      expect(appLinkFrom(Uri.parse('$base/app/reset/$token'), base), const ResetAppLink(token));
      expect(appLinkFrom(Uri.parse('$base/app/?verify=$token'), base), const VerifyAppLink(token));
      expect(appLinkFromText('Bitte bestätigen: $base/app/verify/$token.', base), const VerifyAppLink(token));
      for (final u in ['$base/app', '$base/app/', '$base/app/app/b/fest', '$base/andere/b/fest', '$base/app/irgendwas']) {
        expect(appLinkFrom(Uri.parse(u), base), isNull, reason: u);
      }
    });

    test('fremde Hosts, Tricks und kaputte Werte zählen nicht', () {
      for (final u in [
        'https://stachel.intsode.com.evil.de/b/fest',
        'https://evil@stachel.intsode.com/b/fest',
        'http://stachel.intsode.com/b/fest',
        'https://stachel.intsode.com:8443/b/fest',
        'https://board.example.org/b/fest',
        '$base/b/f%20e',
        '$base/verify/kurz',
        '$base/qr/abcdefghij',
        '$base/?b=fest&offline=1',
        '$base/?b=a&b=b',
        '$base/irgendwas',
      ]) {
        expect(appLinkFrom(Uri.parse(u), base), isNull, reason: u);
      }
      // a broken object is dropped, the board still opens
      expect(appLinkFrom(Uri.parse('$base/b/fest?o=a%20b'), base), const BoardAppLink('fest'));
    });

    test('Link aus Mail-Text (Satzzeichen am Ende egal)', () {
      expect(appLinkFromText('Hallo, bitte bestätige: $base/verify/$token.\nDanke', base), const VerifyAppLink(token));
      expect(appLinkFromText('<$base/reset/$token>', base), const ResetAppLink(token));
      expect(appLinkFromText('nix', base), isNull);
    });

    test('StachelAppLinks merkt sich den letzten Link bis take()', () {
      final l = StachelAppLinks(base);
      expect(l.handle(Uri.parse('https://example.org/b/x')), isFalse);
      expect(l.handle(Uri.parse('$base/b/fest')), isTrue);
      expect(l.take(), const BoardAppLink('fest'));
      expect(l.take(), isNull);
    });
  });

  group('Captcha (ALTCHA, SHA-256-Proof-of-Work wie der Web-Worker)', () {
    const salt = 'abc123?expires=9999999999';
    final challenge = sha256.convert(utf8.encode('${salt}4711')).toString();
    final c = CaptchaChallenge(
      algorithm: 'SHA-256',
      challenge: challenge,
      salt: salt,
      maxNumber: 10000,
      signature: 'f' * 64,
    );

    test('findet die Zahl und baut die Antwort wie der Server sie prüft', () async {
      expect(solveCaptchaSync(c), 4711);
      final payload = await solveCaptcha(c);
      final j = jsonDecode(utf8.decode(base64.decode(payload!))) as Map;
      expect(j, {'algorithm': 'SHA-256', 'challenge': challenge, 'number': 4711, 'salt': salt, 'signature': 'f' * 64});
    });

    test('keine Lösung im Bereich bzw. fremdes Verfahren → null', () {
      expect(
        solveCaptchaSync(
          CaptchaChallenge(algorithm: 'SHA-256', challenge: challenge, salt: salt, maxNumber: 100, signature: ''),
        ),
        isNull,
      );
      expect(
        solveCaptchaSync(
          CaptchaChallenge(algorithm: 'SHA-1', challenge: challenge, salt: salt, maxNumber: 10000, signature: ''),
        ),
        isNull,
      );
      expect(CaptchaChallenge.fromJson({'algorithm': 'SHA-256'}), isNull);
    });
  });
}
