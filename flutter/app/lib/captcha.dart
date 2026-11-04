import 'dart:convert';
import 'dart:isolate';

import 'package:crypto/crypto.dart';

/// Captcha of the Stachel server (mode `local`, `server/src/captcha.ts`): proof of work in the ALTCHA format. The
/// server hands out `{algorithm: "SHA-256", challenge, salt, maxnumber, signature}`; the number `n` (0…maxnumber) with
/// `hex(SHA-256(salt + "n")) == challenge` has to be found – like the web's worker, here natively in an isolate (no
/// WebView, no third party). The answer is `base64(JSON{algorithm, challenge, number, salt, signature})`.
class CaptchaChallenge {
  const CaptchaChallenge({
    required this.algorithm,
    required this.challenge,
    required this.salt,
    required this.maxNumber,
    required this.signature,
  });

  static CaptchaChallenge? fromJson(Object? j) {
    if (j is! Map) return null;
    final a = j['algorithm'], c = j['challenge'], s = j['salt'], m = j['maxnumber'], sig = j['signature'];
    if (a is! String || c is! String || s is! String || m is! num || sig is! String) return null;
    return CaptchaChallenge(algorithm: a, challenge: c, salt: s, maxNumber: m.toInt(), signature: sig);
  }

  final String algorithm;
  final String challenge;
  final String salt;
  final int maxNumber;
  final String signature;

  /// The payload for the form field `captcha` with the found [number].
  String payload(int number) => base64.encode(
    utf8.encode(
      jsonEncode({
        'algorithm': algorithm,
        'challenge': challenge,
        'number': number,
        'salt': salt,
        'signature': signature,
      }),
    ),
  );
}

/// The number solving [c], null if none in 0…maxnumber (or an unknown algorithm).
int? solveCaptchaSync(CaptchaChallenge c) {
  if (c.algorithm.toUpperCase() != 'SHA-256') return null;
  final want = c.challenge.toLowerCase();
  final salt = utf8.encode(c.salt);
  for (var n = 0; n <= c.maxNumber; n++) {
    final digest = sha256.convert([...salt, ...utf8.encode('$n')]);
    if (digest.toString() == want) return n;
  }
  return null;
}

/// [solveCaptchaSync] in a background isolate (the UI keeps running), returns the form payload or null.
Future<String?> solveCaptcha(CaptchaChallenge c) async {
  final n = await Isolate.run(() => solveCaptchaSync(c));
  return n == null ? null : c.payload(n);
}
