// Farbnamen des MCP (palette.ts) passen zu den Notizfarben der Web-App (36, shared/protocol.ts).
import { describe, expect, it } from 'vitest';
import { colorLabel, resolveColor, STICKY_COLORS } from '../src/board/palette';

describe('Farben', () => {
  it('jede Notizfarbe hat einen Namen, Namen lösen auf ihre Notizfarbe auf', () => {
    expect(STICKY_COLORS).toHaveLength(36);
    for (const hex of STICKY_COLORS) {
      const label = colorLabel(hex)!;
      expect(label, hex).not.toBe(hex);
      expect(resolveColor(label.split(' ')[0]!, 'fill'), hex).toBe(hex);
    }
  });

  it('deutsche Namen und Hex', () => {
    expect(resolveColor('Anthrazit', 'fill')).toBe('#2b2b2b');
    expect(resolveColor('königsblau', 'fill')).toBe('#1565c0');
    expect(resolveColor('dunkelgrün', 'fill')).toBe('#1b5e20');
    expect(resolveColor('Ocker', 'fill')).toBe('#8a6a00');
    expect(resolveColor('#ABC', 'fill')).toBe('#aabbcc');
    expect(resolveColor('red', 'ink')).toBe('#c92a2a');
    expect(resolveColor('quietschbunt', 'fill')).toBeNull();
  });
});
