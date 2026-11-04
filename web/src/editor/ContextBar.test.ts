import { describe, expect, it } from 'vitest';
import { fitCount } from './ContextBar';

describe('Kontextleiste: Überlauf „···“', () => {
  it('alles passt: kein Menü', () => {
    expect(fitCount([40, 100, 80], 220)).toBe(3);
  });
  it('was nicht passt, kommt samt Platz für „···“ ins Menü', () => {
    // 40 + 100 + 50 (···) = 190 ≤ 200, mit dem dritten Eintrag nicht mehr
    expect(fitCount([40, 100, 80], 200)).toBe(2);
    expect(fitCount([40, 100, 80], 120)).toBe(1);
  });
  it('sehr schmal: nur „···“', () => {
    expect(fitCount([300, 20], 100)).toBe(0);
  });
});
