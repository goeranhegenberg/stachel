// Board-Hintergrund nach den Board-Einstellungen: Muster (Punkte/Linien/leer) und Farbe.
// Der Editor zeichnet das Punktraster inline am .board; wir setzen nur Attribute/Variablen, tools.css übersteuert.
import { useLayoutEffect, useRef } from 'react';
import { clamp } from '../../board/geometry';
import type { SlotProps } from '../../editor/ext/types';
import { DEFAULT_SETTINGS, isDark, useBoardSettings } from './settings';

export function BoardBackground({ api, cam }: SlotProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const s = useBoardSettings(api);
  const custom = s.pattern !== DEFAULT_SETTINGS.pattern || s.color !== DEFAULT_SETTINGS.color;
  const dot = clamp(cam.z * 1.3, 0.9, 1.6);
  useLayoutEffect(() => {
    const board = ref.current?.closest<HTMLElement>('.board');
    if (!board) return;
    if (!custom) {
      board.removeAttribute('data-tools-pattern');
      board.removeAttribute('data-tools-dark');
      return;
    }
    const dark = isDark(s.color);
    board.dataset.toolsPattern = s.pattern;
    if (dark) board.dataset.toolsDark = '';
    else board.removeAttribute('data-tools-dark');
    board.style.setProperty('--tools-bg', s.color);
    board.style.setProperty('--tools-ink', dark ? 'rgba(255,255,255,0.22)' : 'rgba(10,10,10,0.2)');
    board.style.setProperty('--tools-line', dark ? 'rgba(255,255,255,0.08)' : 'rgba(10,10,10,0.07)');
  }, [custom, s.pattern, s.color]);
  useLayoutEffect(() => {
    ref.current?.closest<HTMLElement>('.board')?.style.setProperty('--tools-dot', `${dot}px`);
  }, [dot]);
  return <span ref={ref} hidden data-testid="tools-background" data-pattern={s.pattern} data-color={s.color} />;
}
