// „In der {App} öffnen“ auf dem Handy (Modus org, Anmeldung ohne Passwort, Vertrag §2 „App-Links“).
// Der Anmelde-Link `{PUBLIC_URL}/qr/<code>` ist ein App-Link der App der Organisation. Chrome öffnet App-Links aber
// nicht, wenn man schon auf derselben Domain ist – deshalb auf Android ein `intent://`-Link mit dem App-Paket
// (`orgAndroidPackage` aus /api/instance, ohne Paket kein Knopf): Mit App
// öffnet sich die App und bestätigt den Code, ohne App (oder zu alt) lädt Chrome die Rückfall-Seite
// `/qr/<code>?handy=1`, die erklärt, warum, und zur Passwort-Anmeldung führt.
// iOS: Safari übernimmt Universal Links auf derselben Domain ebenfalls nicht, und intent:// gibt es dort nicht –
// also kein Knopf, sondern Passwort-Anmeldung (bei gängigen Whiteboards am Handy genauso).

export type MobilePlatform = 'android' | 'ios' | 'other';

export function mobilePlatform(ua = navigator.userAgent, touchPoints = navigator.maxTouchPoints ?? 0): MobilePlatform {
  if (/Android/i.test(ua)) return 'android';
  // iPadOS meldet sich als „Macintosh“, hat aber Touch
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && touchPoints > 1)) return 'ios';
  return 'other';
}

/** Link für den Knopf „In der App öffnen“ oder null (Knopf ausblenden; Android nur mit App-Paket). */
export function appOpenUrl(pairingUrl: string, platform: MobilePlatform, androidPackage: string | null): string | null {
  if (platform === 'ios') return null;
  if (platform === 'android' && !androidPackage) return null;
  if (platform !== 'android') return pairingUrl;
  let u: URL;
  try {
    u = new URL(pairingUrl);
  } catch {
    return pairingUrl;
  }
  const fallback = new URL(u.href);
  fallback.searchParams.set('handy', '1');
  return `intent://${u.host}${u.pathname}#Intent;scheme=${u.protocol.replace(':', '')};package=${androidPackage};S.browser_fallback_url=${encodeURIComponent(fallback.href)};end`;
}
