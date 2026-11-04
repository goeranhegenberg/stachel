import { describe, expect, it } from 'vitest';
import { chooseVariant, getImageZoom, markVariantLoaded, notifyImageZoom, setImageZoom, subscribeImageZoom, variantSrc, variantWidth } from './imageVariant';

describe('Bildstufen', () => {
  it('Stufe nach Bildschirmbreite', () => {
    expect(variantWidth(100)).toBe(256);
    expect(variantWidth(256)).toBe(256);
    expect(variantWidth(257)).toBe(1024);
    expect(variantWidth(1024)).toBe(1024);
    expect(variantWidth(1025)).toBe(0);
  });

  it('nur Server-Bilder ohne Parameter bekommen ?w=', () => {
    expect(variantSrc('/api/images/abc', 256)).toBe('/api/images/abc?w=256');
    expect(variantSrc('/api/images/abc', 0)).toBe('/api/images/abc');
    expect(variantSrc('blob:http://x/1', 256)).toBe('blob:http://x/1');
    expect(variantSrc('data:image/png;base64,AA', 1024)).toBe('data:image/png;base64,AA');
    expect(chooseVariant('blob:http://x/1', 10)).toBe(0);
  });

  it('größere geladene Stufe wird weiterverwendet, kleinere nicht neu geholt', () => {
    const src = '/api/images/stufen';
    expect(chooseVariant(src, 100)).toBe(256);
    markVariantLoaded(src, 1024);
    // herausgezoomt: 1024 ist schon da → kein neuer Abruf der 256er
    expect(chooseVariant(src, 100)).toBe(1024);
    expect(chooseVariant(src, 800)).toBe(1024);
    // hineingezoomt: Original wird gebraucht
    expect(chooseVariant(src, 3000)).toBe(0);
    markVariantLoaded(src, 256);
    expect(chooseVariant(src, 100)).toBe(256);
    const big = '/api/images/original';
    markVariantLoaded(big, 0);
    expect(chooseVariant(big, 100)).toBe(0);
  });

  it('Zoom: Setzen im Rendern, Benachrichtigung nur bei Änderung', () => {
    let calls = 0;
    const off = subscribeImageZoom(() => calls++);
    setImageZoom(0.5);
    expect(getImageZoom()).toBe(0.5);
    expect(calls).toBe(0);
    notifyImageZoom();
    notifyImageZoom();
    expect(calls).toBe(1);
    off();
    setImageZoom(2);
    notifyImageZoom();
    expect(calls).toBe(1);
  });
});
