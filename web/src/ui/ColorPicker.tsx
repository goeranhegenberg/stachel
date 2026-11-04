// Eigener Farbwähler (Notizen, Formen …): Spektrum (Sättigung × Helligkeit) mit Farbton-Regler, Hex-Eingabe, Vorschau mit
// der Schrift, die die Farbe bekäme (WCAG, `readableInk`), und „zuletzt benutzt“ (je Gerät, `recentColors`). Ohne
// Systemdialog, damit er überall gleich aussieht und offline geht. Die App hat dasselbe (`stachel_board`
// `color_picker.dart`).
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { readableInk } from '../board/colors';
import { colorName } from './a11y';
import { addRecentColor, useRecentColors } from './recentColors';

const HEX6 = /^#[0-9a-f]{6}$/i;

/** `#abc`, `abc`, `#aabbcc`, `aabbcc` → `#aabbcc` (klein); sonst null. */
export function parseHex(input: string): string | null {
  const s = input.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(s)) return `#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`;
  if (/^[0-9a-f]{6}$/.test(s)) return `#${s}`;
  return null;
}

export interface Hsv {
  h: number;
  s: number;
  v: number;
}

export function hexToHsv(hex: string): Hsv {
  const n = HEX6.test(hex) ? parseInt(hex.slice(1), 16) : 0xffffff;
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const f = (k: number) => {
    const kk = (k + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(kk, 4 - kk, 1));
  };
  const to = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0');
  return `#${to(f(5))}${to(f(3))}${to(f(1))}`;
}

/** Felder der zuletzt benutzten Farben (Klick = übernehmen). */
export function RecentSwatches({ onPick, current, label = 'Zuletzt benutzt' }: { onPick: (hex: string) => void; current?: string; label?: string }) {
  const recent = useRecentColors();
  if (!recent.length) return null;
  return (
    <div className="cp-recent" role="group" aria-label={label}>
      {recent.map((c) => (
        <button key={c} className={`swatch swatch--round${c === current ? ' is-active' : ''}`} style={{ background: c }} aria-label={`Zuletzt benutzt: ${colorName(c)}`} title={colorName(c)} onClick={() => onPick(c)} />
      ))}
    </div>
  );
}

/**
 * Der Wähler selbst: Spektrum, Farbton, Hex, Vorschau, Übernehmen. `onPick` bekommt `#rrggbb`; die Farbe wandert in
 * „zuletzt benutzt“.
 */
export function ColorPicker({ value, onPick, onCancel, label = 'Eigene Farbe' }: { value: string; onPick: (hex: string) => void; onCancel?: () => void; label?: string }) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(HEX6.test(value) ? value : '#fff27a'));
  const hex = hsvToHex(hsv);
  const [text, setText] = useState(hex);
  const editing = useRef(false);
  const area = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!editing.current) setText(hex);
  }, [hex]);

  const fromPointer = (e: RPointerEvent<HTMLDivElement>) => {
    const r = area.current!.getBoundingClientRect();
    const s = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const v = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
    setHsv((p) => ({ ...p, s, v }));
  };
  const apply = (c = hex) => {
    addRecentColor(c);
    onPick(c);
  };
  const ink = readableInk(hex);
  return (
    <div className="cp" role="group" aria-label={label} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON' && apply()}>
      <div
        ref={area}
        className="cp-area"
        style={{ background: `hsl(${hsv.h} 100% 50%)` }}
        role="slider"
        tabIndex={0}
        aria-label="Sättigung und Helligkeit"
        aria-valuetext={`Sättigung ${Math.round(hsv.s * 100)} %, Helligkeit ${Math.round(hsv.v * 100)} %`}
        data-testid="cp-area"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          fromPointer(e);
        }}
        onPointerMove={(e) => e.buttons && fromPointer(e)}
        onKeyDown={(e) => {
          const d = e.shiftKey ? 0.1 : 0.02;
          const k: Record<string, [number, number]> = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, d], ArrowDown: [0, -d] };
          const m = k[e.key];
          if (!m) return;
          e.preventDefault();
          setHsv((p) => ({ ...p, s: Math.max(0, Math.min(1, p.s + m[0])), v: Math.max(0, Math.min(1, p.v + m[1])) }));
        }}
      >
        <span className="cp-knob" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }} />
      </div>
      <input
        className="cp-hue"
        type="range"
        min={0}
        max={359}
        value={Math.round(hsv.h)}
        aria-label="Farbton"
        data-testid="cp-hue"
        onChange={(e) => setHsv((p) => ({ ...p, h: Number(e.target.value), s: p.s || 0.6, v: p.v || 0.9 }))}
      />
      <div className="cp-row">
        <span className="cp-preview" style={{ background: hex, color: ink }} aria-hidden="true">
          Aa
        </span>
        <input
          className="cp-hex"
          value={text}
          maxLength={7}
          spellCheck={false}
          aria-label="Farbe als Hex-Wert"
          data-testid="cp-hex"
          onFocus={() => (editing.current = true)}
          onBlur={() => {
            editing.current = false;
            setText(hex);
          }}
          onChange={(e) => {
            setText(e.target.value);
            const p = parseHex(e.target.value);
            if (p) setHsv(hexToHsv(p));
          }}
        />
        <button className="cp-ok" onClick={() => apply()} data-testid="cp-ok">
          Übernehmen
        </button>
      </div>
      {onCancel && (
        <button className="cp-cancel" onClick={onCancel}>
          Zurück zur Palette
        </button>
      )}
    </div>
  );
}

/** „+“ für den eigenen Farbwähler (Regenbogen-Ring). */
export function CustomColorToggle({ open, onClick }: { open: boolean; onClick: () => void }) {
  return <button className={`swatch swatch--round cp-plus${open ? ' is-active' : ''}`} aria-label="Eigene Farbe wählen" title="Eigene Farbe" aria-expanded={open} data-testid="cp-plus" onClick={onClick} />;
}
